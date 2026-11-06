import { MARKETING_PROVIDERS } from "../delivery-registry";
import { classifyHttp, normalizeEmail, parseJson, request, str, TEST_TIMEOUT_MS } from "./http";
import type { MarketingProviderAdapter, NormalizedProviderEvent, ParsedProviderEvent } from "./provider-contract";

/**
 * Brevo transactional email API (https://developers.brevo.com/reference/sendtransacemail).
 * Our delivery id goes in the `X-Mailin-custom` header, which Brevo echoes in
 * every webhook event — so a callback can settle a message even when the send
 * response was lost. Brevo webhooks are unsigned: they are authenticated by
 * the secret token in the webhook URL (checked by the route).
 */

const API = "https://api.brevo.com/v3";

const EVENT_MAP: Record<string, NormalizedProviderEvent> = {
  request: "SENT",
  sent: "SENT",
  delivered: "DELIVERED",
  hard_bounce: "BOUNCED",
  invalid_email: "BOUNCED",
  soft_bounce: "DEFERRED",
  deferred: "DEFERRED",
  blocked: "REJECTED",
  error: "FAILED",
  spam: "COMPLAINED",
  complaint: "COMPLAINED",
  unsubscribed: "UNSUBSCRIBED",
  opened: "OPENED",
  unique_opened: "OPENED",
  proxy_open: "OPENED",
  click: "CLICKED",
};

function eventTime(e: Record<string, unknown>): Date {
  const ts = Number(e.ts_event ?? e.ts_epoch ?? e.ts);
  if (Number.isFinite(ts) && ts > 0) return new Date(ts > 1e12 ? ts : ts * 1000);
  const d = Date.parse(String(e.date ?? ""));
  return Number.isFinite(d) ? new Date(d) : new Date();
}

export const brevoAdapter: MarketingProviderAdapter = {
  key: "BREVO",
  capabilities: MARKETING_PROVIDERS.BREVO.capabilities,
  validateConfig(config, secrets) {
    const errors: Record<string, string> = {};
    if (!normalizeEmail(str(config.fromEmail))) errors.fromEmail = "Enter the verified sender email.";
    if (str(config.replyTo) && !normalizeEmail(str(config.replyTo))) errors.replyTo = "Enter a valid email.";
    if (!secrets.apiKey) errors.apiKey = "Enter the API key.";
    return errors;
  },
  normalizeDestination: (raw) => normalizeEmail(raw),
  validateMessage(msg) {
    const out: string[] = [];
    if (!msg.subject?.trim()) out.push("An email needs a subject.");
    if (!msg.body.trim()) out.push("The message body is empty.");
    const att = msg.attachments ?? [];
    if (att.reduce((s, a) => s + a.sizeBytes, 0) > 10 * 1024 * 1024) out.push("Attachments are larger than 10 MB in total.");
    if (att.length > 5) out.push("At most 5 attachments.");
    return out;
  },
  async testConnection(conn, deps) {
    const res = await request(deps.fetch, `${API}/account`, { method: "GET", headers: { "api-key": conn.secrets.apiKey ?? "", accept: "application/json" } }, TEST_TIMEOUT_MS);
    if (!res.ok) return { ok: false, message: "Brevo could not be reached." };
    if (res.status === 200) return { ok: true, message: "API key accepted by Brevo." };
    if (res.status === 401 || res.status === 403) return { ok: false, message: "Brevo rejected the API key." };
    return { ok: false, message: `Brevo answered ${res.status}.` };
  },
  async send(conn, msg, deps) {
    const headers: Record<string, string> = { "X-Mailin-custom": msg.deliveryId };
    if (msg.unsubscribeUrl) {
      headers["List-Unsubscribe"] = `<${msg.unsubscribeUrl}>`;
      headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
    }
    const body = {
      sender: { email: str(conn.config.fromEmail), ...(str(conn.config.fromName) ? { name: str(conn.config.fromName) } : {}) },
      to: [{ email: msg.to, ...(msg.toName ? { name: msg.toName } : {}) }],
      ...(str(conn.config.replyTo) ? { replyTo: { email: str(conn.config.replyTo) } } : {}),
      subject: msg.subject ?? "",
      textContent: msg.body,
      headers,
      ...(msg.tag ? { tags: [msg.tag.slice(0, 50)] } : {}),
      ...(msg.attachments?.length ? { attachment: msg.attachments.map((a) => ({ name: a.fileName, content: (a.content ?? Buffer.alloc(0)).toString("base64") })) } : {}),
    };
    const res = await request(deps.fetch, `${API}/smtp/email`, { method: "POST", headers: { "api-key": conn.secrets.apiKey ?? "", "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) return res.outcome;
    const json = parseJson(res.text) as { messageId?: string; code?: string; message?: string } | null;
    if (res.status === 201 || res.status === 200 || res.status === 202) return { kind: "ACCEPTED", providerMessageId: json?.messageId ?? null, providerStatus: String(res.status) };
    return classifyHttp(res.status, res.headers, json?.code ?? "", json?.message ?? "");
  },
  parseWebhook(req) {
    const json = parseJson(req.rawBody);
    const items = (Array.isArray(json) ? json : json && typeof json === "object" ? [json] : []) as Record<string, unknown>[];
    const out: ParsedProviderEvent[] = [];
    for (const e of items) {
      const type = String(e.event ?? "").toLowerCase();
      if (!type) continue;
      const providerMessageId = e["message-id"] != null ? String(e["message-id"]) : null;
      const correlation = e["X-Mailin-custom"] ?? e["x-mailin-custom"];
      const at = eventTime(e);
      out.push({
        eventKey: `${providerMessageId ?? correlation ?? "?"}|${type}|${at.getTime()}`.slice(0, 300),
        providerMessageId,
        correlationId: correlation != null ? String(correlation).slice(0, 64) : null,
        eventType: type,
        normalized: EVENT_MAP[type] ?? null,
        occurredAt: at,
        errorCode: type.includes("bounce") || type === "blocked" || type === "error" ? type.toUpperCase() : null,
        detail: e.reason != null ? String(e.reason).slice(0, 200) : null,
      });
    }
    return out;
  },
};
