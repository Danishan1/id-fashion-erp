import { MARKETING_PROVIDERS } from "../delivery-registry";
import { classifyHttp, normalizePhone, parseJson, request, str, TEST_TIMEOUT_MS } from "./http";
import type { MarketingProviderAdapter, NormalizedProviderEvent, ParsedProviderEvent } from "./provider-contract";

/**
 * MSG91 SMS through the Flow API (DLT templates). One request per
 * recipient, so the request id MSG91 returns identifies the message and
 * matches its delivery reports. Template variables are sent as var1, var2…
 * in the order the CRM template first uses its merge fields. MSG91 doesn't
 * sign delivery reports: the webhook is authenticated by the URL token.
 * NOT live-verified in this build (built from MSG91's public docs, tested
 * with mocked responses).
 */

const FLOW_URL = "https://control.msg91.com/api/v5/flow";
const BALANCE_URL = "https://control.msg91.com/api/balance.php";

/** MSG91 DLR status codes / words → normalised event. */
const STATUS_MAP: Record<string, NormalizedProviderEvent> = {
  "1": "DELIVERED",
  delivered: "DELIVERED",
  "2": "FAILED",
  failed: "FAILED",
  "8": "SENT",
  submitted: "SENT",
  sent: "SENT",
  "9": "REJECTED",
  ndnc: "REJECTED",
  "16": "REJECTED",
  rejected: "REJECTED",
  "17": "REJECTED",
  blocked: "REJECTED",
  "25": "REJECTED",
  "26": "REJECTED",
};

export const msg91Adapter: MarketingProviderAdapter = {
  key: "MSG91",
  capabilities: MARKETING_PROVIDERS.MSG91.capabilities,
  validateConfig(config, secrets) {
    const errors: Record<string, string> = {};
    if (!/^[A-Za-z0-9]{3,11}$/.test(str(config.senderId))) errors.senderId = "Enter the DLT sender ID (3–11 letters / digits).";
    if (str(config.defaultCountryCode) && !/^\d{1,4}$/.test(str(config.defaultCountryCode))) errors.defaultCountryCode = "Digits only, e.g. 91.";
    if (!secrets.authKey) errors.authKey = "Enter the auth key.";
    return errors;
  },
  normalizeDestination: (raw, config) => normalizePhone(raw, config.defaultCountryCode),
  validateMessage(msg) {
    const out: string[] = [];
    if (!msg.providerMetadata.externalTemplateId) out.push("The SMS template version has no MSG91 flow / template id.");
    if (msg.attachments?.length) out.push("SMS can't carry attachments.");
    if (!msg.body.trim()) out.push("The message body is empty.");
    return out;
  },
  async testConnection(conn, deps) {
    const url = `${BALANCE_URL}?type=4&authkey=${encodeURIComponent(conn.secrets.authKey ?? "")}`;
    const res = await request(deps.fetch, url, { method: "GET" }, TEST_TIMEOUT_MS);
    if (!res.ok) return { ok: false, message: "MSG91 could not be reached." };
    const text = res.text.trim();
    if (res.status === 200 && /^-?\d+(\.\d+)?$/.test(text)) return { ok: true, message: `Auth key accepted by MSG91 (balance ${text}).` };
    return { ok: false, message: "MSG91 rejected the auth key." };
  },
  async send(conn, msg, deps) {
    const recipient: Record<string, string> = { mobiles: msg.to };
    msg.parameters.forEach((p, i) => (recipient[`var${i + 1}`] = p.value));
    const body = { template_id: msg.providerMetadata.externalTemplateId, sender: str(conn.config.senderId), short_url: "0", recipients: [recipient] };
    const res = await request(deps.fetch, FLOW_URL, { method: "POST", headers: { authkey: conn.secrets.authKey ?? "", "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) return res.outcome;
    const json = parseJson(res.text) as { type?: string; message?: string } | null;
    if (res.status === 200 && json?.type === "success" && json.message) return { kind: "ACCEPTED", providerMessageId: String(json.message), providerStatus: "success" };
    const text = String(json?.message ?? "");
    if (res.status === 200 || res.status === 400) {
      if (/auth/i.test(text)) return { kind: "CONNECTION", code: "AUTH_FAILED", message: "MSG91 rejected the auth key." };
      return { kind: "PERMANENT", code: "REJECTED", message: text.slice(0, 200) || "MSG91 refused the message.", providerStatus: json?.type ?? String(res.status) };
    }
    return classifyHttp(res.status, res.headers, "REJECTED", text);
  },
  parseWebhook(req) {
    let raw: unknown = parseJson(req.rawBody);
    if (raw == null) {
      const form = new URLSearchParams(req.rawBody);
      raw = form.get("data") ? parseJson(form.get("data")!) : null;
    }
    if (raw && typeof raw === "object" && !Array.isArray(raw) && "data" in (raw as object)) raw = (raw as { data: unknown }).data;
    const items = (Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : []) as Record<string, unknown>[];
    const out: ParsedProviderEvent[] = [];
    for (const item of items) {
      const requestId = item.requestId ?? item.request_id;
      if (requestId == null) continue;
      const reports = (Array.isArray(item.report) ? item.report : [item]) as Record<string, unknown>[];
      for (const r of reports) {
        const status = String(r.status ?? r.desc ?? "").toLowerCase();
        const desc = String(r.desc ?? r.status ?? "");
        const number = String(r.number ?? item.number ?? "");
        const when = Date.parse(String(r.date ?? ""));
        const occurredAt = Number.isFinite(when) ? new Date(when) : new Date();
        const normalized = STATUS_MAP[status] ?? STATUS_MAP[desc.toLowerCase()] ?? null;
        out.push({
          eventKey: `${requestId}|${number}|${status}|${occurredAt.getTime()}`.slice(0, 300),
          providerMessageId: String(requestId),
          correlationId: null,
          eventType: desc || status || "report",
          normalized,
          occurredAt,
          errorCode: normalized === "FAILED" || normalized === "REJECTED" ? desc.toUpperCase().slice(0, 40) : null,
          detail: null,
        });
      }
    }
    return out;
  },
};
