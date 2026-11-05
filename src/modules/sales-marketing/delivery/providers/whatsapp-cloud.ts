import { createHmac } from "crypto";
import { MARKETING_PROVIDERS } from "../delivery-registry";
import { classifyHttp, normalizePhone, parseJson, request, safeEqual, str, TEST_TIMEOUT_MS } from "./http";
import type { MarketingProviderAdapter, NormalizedProviderEvent, ParsedProviderEvent, SendOutcome } from "./provider-contract";

/**
 * WhatsApp Business Cloud API (Meta Graph). Marketing messages are sent as
 * Meta-approved templates (name + language from the CRM template version;
 * merge fields become the body's positional parameters). Our delivery id
 * travels as `biz_opaque_callback_data` and comes back on status callbacks.
 * Callbacks are verified with X-Hub-Signature-256 (HMAC-SHA256 of the raw
 * body with the app secret). NOT live-verified in this build.
 */

const GRAPH = "https://graph.facebook.com";

const STATUS_MAP: Record<string, NormalizedProviderEvent> = { sent: "SENT", delivered: "DELIVERED", read: "DELIVERED", failed: "FAILED" };

/** Graph error codes worth special handling (https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes). */
const THROTTLE_CODES = new Set([4, 80007, 130429, 131048, 131056]);
const AUTH_CODES = new Set([0, 190, 10, 200]);

function version(config: Record<string, string | number>) {
  const v = str(config.apiVersion);
  return /^v\d{1,2}\.\d$/.test(v) ? v : "v21.0";
}

export const whatsappCloudAdapter: MarketingProviderAdapter = {
  key: "WHATSAPP_CLOUD",
  capabilities: MARKETING_PROVIDERS.WHATSAPP_CLOUD.capabilities,
  validateConfig(config, secrets) {
    const errors: Record<string, string> = {};
    if (!/^\d{5,25}$/.test(str(config.phoneNumberId))) errors.phoneNumberId = "Enter the numeric phone number ID from Meta.";
    if (str(config.businessAccountId) && !/^\d{5,25}$/.test(str(config.businessAccountId))) errors.businessAccountId = "Digits only.";
    if (str(config.apiVersion) && !/^v\d{1,2}\.\d$/.test(str(config.apiVersion))) errors.apiVersion = "Like v21.0.";
    if (str(config.defaultCountryCode) && !/^\d{1,4}$/.test(str(config.defaultCountryCode))) errors.defaultCountryCode = "Digits only, e.g. 91.";
    if (!secrets.accessToken) errors.accessToken = "Enter the access token.";
    if (!secrets.appSecret) errors.appSecret = "Enter the app secret (needed to verify callbacks).";
    if (!secrets.verifyToken || secrets.verifyToken.length < 8) errors.verifyToken = "Enter a verify token of at least 8 characters.";
    return errors;
  },
  normalizeDestination: (raw, config) => normalizePhone(raw, config.defaultCountryCode),
  validateMessage(msg) {
    const out: string[] = [];
    if (!msg.providerMetadata.externalTemplateName) out.push("The WhatsApp template version has no Meta-approved template name.");
    if (msg.parameters.length > 30) out.push("Too many template parameters.");
    return out;
  },
  async testConnection(conn, deps) {
    const url = `${GRAPH}/${version(conn.config)}/${encodeURIComponent(str(conn.config.phoneNumberId))}?fields=display_phone_number,verified_name`;
    const res = await request(deps.fetch, url, { method: "GET", headers: { authorization: `Bearer ${conn.secrets.accessToken ?? ""}` } }, TEST_TIMEOUT_MS);
    if (!res.ok) return { ok: false, message: "Meta could not be reached." };
    const json = parseJson(res.text) as { display_phone_number?: string; verified_name?: string } | null;
    if (res.status === 200 && json?.display_phone_number) return { ok: true, message: `Connected to ${json.verified_name ?? "WhatsApp"} (${json.display_phone_number}).` };
    if (res.status === 401 || res.status === 403 || res.status === 400) return { ok: false, message: "Meta rejected the token or phone number ID." };
    return { ok: false, message: `Meta answered ${res.status}.` };
  },
  async send(conn, msg, deps): Promise<SendOutcome> {
    const params = msg.parameters.map((p) => ({ type: "text", text: p.value || "-" }));
    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: msg.to,
      type: "template",
      template: {
        name: msg.providerMetadata.externalTemplateName,
        language: { code: msg.providerMetadata.language || "en" },
        ...(params.length ? { components: [{ type: "body", parameters: params }] } : {}),
      },
      biz_opaque_callback_data: msg.deliveryId,
    };
    const url = `${GRAPH}/${version(conn.config)}/${encodeURIComponent(str(conn.config.phoneNumberId))}/messages`;
    const res = await request(deps.fetch, url, { method: "POST", headers: { authorization: `Bearer ${conn.secrets.accessToken ?? ""}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) return res.outcome;
    const json = parseJson(res.text) as { messages?: { id?: string; message_status?: string }[]; error?: { code?: number; message?: string; error_subcode?: number } } | null;
    const id = json?.messages?.[0]?.id;
    if (res.status === 200 && id) return { kind: "ACCEPTED", providerMessageId: id, providerStatus: json?.messages?.[0]?.message_status ?? "accepted" };
    const code = json?.error?.code;
    if (code != null && THROTTLE_CODES.has(code)) return { kind: "THROTTLED", code: "RATE_LIMITED", message: "Meta asked us to slow down.", retryAfterMs: 60_000, providerStatus: String(code) };
    if (code != null && AUTH_CODES.has(code) && (res.status === 401 || res.status === 403 || code === 190)) return { kind: "CONNECTION", code: "AUTH_FAILED", message: "Meta rejected the access token.", providerStatus: String(code) };
    return classifyHttp(res.status, res.headers, code != null ? `META_${code}` : "", json?.error?.message ?? "");
  },
  verifyWebhook(req, conn) {
    if (req.method === "GET") return { ok: true }; // handshake checks the verify token itself
    const header = req.headers.get("x-hub-signature-256") ?? "";
    if (!conn.secrets.appSecret) return { ok: false, reason: "No app secret configured." };
    const expected = `sha256=${createHmac("sha256", conn.secrets.appSecret).update(req.rawBody, "utf8").digest("hex")}`;
    return safeEqual(header, expected) ? { ok: true } : { ok: false, reason: "Invalid signature." };
  },
  handshake(req, conn) {
    if (req.method !== "GET") return null;
    const mode = req.query.get("hub.mode");
    const token = req.query.get("hub.verify_token") ?? "";
    const challenge = req.query.get("hub.challenge") ?? "";
    if (mode === "subscribe" && conn.secrets.verifyToken && safeEqual(token, conn.secrets.verifyToken) && /^[A-Za-z0-9_-]{1,200}$/.test(challenge)) return challenge;
    return null;
  },
  parseWebhook(req) {
    const json = parseJson(req.rawBody) as { entry?: { changes?: { value?: { statuses?: Record<string, unknown>[] } }[] }[] } | null;
    const out: ParsedProviderEvent[] = [];
    for (const entry of json?.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const s of change.value?.statuses ?? []) {
          const id = s.id != null ? String(s.id) : null;
          const status = String(s.status ?? "").toLowerCase();
          if (!id || !status) continue;
          const ts = Number(s.timestamp);
          const occurredAt = Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : new Date();
          const err = Array.isArray(s.errors) ? (s.errors[0] as { code?: number; title?: string } | undefined) : undefined;
          out.push({
            eventKey: `${id}|${status}|${Number.isFinite(ts) ? ts : occurredAt.getTime()}`.slice(0, 300),
            providerMessageId: id,
            correlationId: s.biz_opaque_callback_data != null ? String(s.biz_opaque_callback_data).slice(0, 64) : null,
            eventType: status,
            normalized: STATUS_MAP[status] ?? null,
            occurredAt,
            errorCode: err?.code != null ? `META_${err.code}` : null,
            detail: err?.title ? String(err.title).slice(0, 200) : null,
          });
        }
      }
    }
    return out;
  },
};
