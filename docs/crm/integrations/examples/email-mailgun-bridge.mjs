// Email (Mailgun) ⇄ Fashion ERP CRM bridge.
// Guide: docs/crm/integrations/06-EMAIL.md
//
//   node email-mailgun-bridge.mjs
//
// Environment:
//   PORT                         default 8083
//   CRM_WEBHOOK_URL              CRM Settings → Channels → (Email channel) webhook URL
//   CRM_SIGNING_SECRET           that channel's signing secret
//   MAILGUN_DOMAIN               sending / receiving domain, e.g. mail.yourcompany.com
//   MAILGUN_API_KEY              Mailgun → API keys (sending)
//   MAILGUN_WEBHOOK_SIGNING_KEY  Mailgun → Webhooks → HTTP webhook signing key
//   MAILGUN_API_BASE             default https://api.mailgun.net (EU domains: https://api.eu.mailgun.net)
//   MAIL_FROM                    e.g. "Indradhar Sales <sales@mail.yourcompany.com>"
//
// Routes:
//   POST /mailgun/inbound   Mailgun route action forward("https://bridge…/mailgun/inbound") → CRM
//   POST /mailgun/events    Mailgun webhooks "delivered" and "permanent failure"           → CRM
//   POST /crm/outbound      replies from the CRM inbox                                       → Mailgun

import { createHmac } from "node:crypto";
import { CRM_STORABLE_MIME, env, outboundHandler, ProviderError, safeEqual, sendJson, sendStatusesToCrm, sendToCrm, startServer } from "./crm-bridge-kit.mjs";

const PORT = Number(process.env.PORT ?? 8083);
const DOMAIN = env("MAILGUN_DOMAIN");
const API = `${process.env.MAILGUN_API_BASE ?? "https://api.mailgun.net"}/v3/${DOMAIN}/messages`;
const SIGNING_KEY = env("MAILGUN_WEBHOOK_SIGNING_KEY");
const auth = `Basic ${Buffer.from(`api:${env("MAILGUN_API_KEY")}`).toString("base64")}`;
const MAX_FILE = 8 * 1024 * 1024;

/** Mailgun signs webhooks: signature = hex HMAC-SHA256(signing key, timestamp + token). */
const seenTokens = new Map();
function verifyMailgun({ timestamp, token, signature }) {
  if (!timestamp || !token || !signature) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 15 * 60) return false; // stale
  if (seenTokens.has(token)) return false; // replay
  const ok = safeEqual(createHmac("sha256", SIGNING_KEY).update(String(timestamp) + token).digest("hex"), signature);
  if (ok) seenTokens.set(token, Date.now());
  for (const [t, at] of seenTokens) if (Date.now() - at > 3600_000) seenTokens.delete(t);
  return ok;
}

/** "<abc@x>" → "abc@x" — the CRM stores ids without angle brackets; they are added back when sending. */
const bare = (id) => (id ?? "").trim().replace(/^<|>$/g, "");
const ids = (header) => (header ?? "").match(/<[^>]+>/g)?.map(bare) ?? [];
/** "Asha Rao <asha@example.com>" → { email, name } */
function parseAddress(value) {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(value ?? "");
  return m ? { email: m[2].trim(), name: m[1].trim() || null } : { email: (value ?? "").trim(), name: null };
}

// ── Inbound ─────────────────────────────────────────────────────────────────

async function handleInbound(req, res, _raw, rawBuffer) {
  // Mailgun posts multipart/form-data (with attachments) or urlencoded; Request.formData() parses both.
  const form = await new Request("http://bridge.local", { method: "POST", headers: { "content-type": req.headers["content-type"] ?? "" }, body: rawBuffer }).formData();
  const get = (k) => (typeof form.get(k) === "string" ? form.get(k) : null);
  if (!verifyMailgun({ timestamp: get("timestamp"), token: get("token"), signature: get("signature") })) {
    // 406 tells Mailgun not to retry.
    return sendJson(res, 406, { error: "bad signature" });
  }
  const headers = new Map((JSON.parse(get("message-headers") ?? "[]") ?? []).map(([k, v]) => [k.toLowerCase(), v]));
  const messageId = bare(headers.get("message-id") ?? get("Message-Id"));
  const inReplyTo = bare(headers.get("in-reply-to") ?? get("In-Reply-To"));
  const references = ids(headers.get("references") ?? get("References"));
  // Thread = the first message of the email chain, so replies land in the same CRM conversation.
  const threadId = references[0] ?? (inReplyTo || messageId);
  const from = parseAddress(get("from") ?? get("sender"));

  const attachments = [];
  for (let i = 1; i <= Number(get("attachment-count") ?? 0); i++) {
    const file = form.get(`attachment-${i}`);
    if (!(file instanceof Blob)) continue;
    const mimeType = (file.type || "application/octet-stream").toLowerCase();
    const buf = Buffer.from(await file.arrayBuffer());
    const fileName = file.name || `attachment-${i}`;
    // Files the CRM can't store (zip, exe, large videos) are listed by name only.
    attachments.push(CRM_STORABLE_MIME.has(mimeType) && buf.length <= MAX_FILE ? { fileName, mimeType, contentBase64: buf.toString("base64"), size: buf.length } : { fileName, mimeType, mediaId: `mailgun:${messageId}:${i}`, size: buf.length });
  }

  await sendToCrm([
    {
      type: "message",
      id: messageId,
      threadId,
      from,
      subject: get("subject") ?? "",
      // stripped-text drops quoted history and signatures; fall back to the full plain body.
      // The CRM needs text or a file; an empty email still gets a visible line.
      text: (get("stripped-text") || get("body-plain") || (attachments.length ? "" : "(empty email)")).replace(/\r\n/g, "\n").slice(0, 20_000),
      ...(inReplyTo ? { inReplyTo } : {}),
      ...(references.length ? { references: references.slice(-50) } : {}),
      ...(attachments.length ? { attachments } : {}),
    },
  ]);
  sendJson(res, 200, { ok: true });
}

/** Mailgun event webhooks (JSON): delivered → delivered; permanent failure → failed. */
async function handleEvents(req, res, rawBody) {
  const body = JSON.parse(rawBody);
  if (!verifyMailgun(body.signature ?? {})) return sendJson(res, 406, { error: "bad signature" });
  const ev = body["event-data"] ?? {};
  const messageId = bare(ev.message?.headers?.["message-id"]);
  let status = null;
  if (ev.event === "delivered") status = "delivered";
  if (ev.event === "failed" && ev.severity === "permanent") status = "failed"; // temporary failures are retried by Mailgun
  if (messageId && status) {
    await sendStatusesToCrm([{ type: "status", messageId, status, ...(status === "failed" ? { error: ev["delivery-status"]?.description || ev.reason || "Email bounced" } : {}) }]);
  }
  sendJson(res, 200, { ok: true });
}

// ── Outbound ────────────────────────────────────────────────────────────────

async function deliver(p) {
  const form = new FormData();
  form.set("from", env("MAIL_FROM"));
  form.set("to", p.to.value);
  form.set("subject", p.subject || "Re: your message");
  form.set("text", p.text || "");
  // Threading headers so the customer's mail client keeps the conversation together.
  if (p.inReplyTo) form.set("h:In-Reply-To", `<${p.inReplyTo}>`);
  const refs = [...new Set([p.threadId, p.inReplyTo].filter(Boolean))].map((r) => `<${r}>`).join(" ");
  if (refs) form.set("h:References", refs);
  form.set("h:X-CRM-Conversation", p.conversationId);
  for (const att of p.attachments ?? []) form.append("attachment", new Blob([Buffer.from(att.contentBase64, "base64")], { type: att.mimeType }), att.fileName);
  const res = await fetch(API, { method: "POST", headers: { Authorization: auth }, body: form, signal: AbortSignal.timeout(12_000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ProviderError(res.status >= 500 || res.status === 429 ? 502 : 422, `Mailgun ${res.status}: ${body.message ?? "error"}`);
  return { messageId: bare(body.id) }; // Mailgun's id is the email's Message-ID
}

startServer(PORT, {
  "POST /mailgun/inbound": handleInbound,
  "POST /mailgun/events": handleEvents,
  "POST /crm/outbound": outboundHandler({ deliver }),
});
