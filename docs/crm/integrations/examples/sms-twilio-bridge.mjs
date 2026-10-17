// SMS (Twilio Programmable Messaging) ⇄ Fashion ERP CRM bridge.
// Guide: docs/crm/integrations/05-SMS.md
//
//   node sms-twilio-bridge.mjs
//
// Environment:
//   PORT                   default 8082
//   PUBLIC_BASE_URL        how Twilio reaches this bridge, e.g. https://bridge.example.com
//                          (used for the status callback URL and for signature checks)
//   CRM_WEBHOOK_URL        CRM Settings → Channels → (SMS channel) webhook URL
//   CRM_SIGNING_SECRET     that channel's signing secret
//   TWILIO_ACCOUNT_SID     Twilio Console → Account Info
//   TWILIO_AUTH_TOKEN      Twilio Console → Account Info (also signs Twilio's webhooks)
//   TWILIO_FROM            your Twilio number (E.164, e.g. +15017122661) …
//   TWILIO_MESSAGING_SERVICE_SID  … or a Messaging Service SID instead of TWILIO_FROM
//   TWILIO_API_BASE        default https://api.twilio.com (testing only)
//   DOWNLOAD_MEDIA         "1" = download MMS images and store them in the CRM
//
// Routes:
//   POST /twilio/inbound   Twilio "A message comes in" webhook       → CRM
//   POST /twilio/status    Twilio status callback (sent / delivered…) → CRM
//   POST /crm/outbound     replies from the CRM inbox                  → Twilio
//   GET  /media/<token>    temporary public link for outgoing MMS files (1 hour)

import { createHmac, randomBytes } from "node:crypto";
import { env, fetchAsCrmAttachment, outboundHandler, ProviderError, safeEqual, sendStatusesToCrm, sendToCrm, startServer } from "./crm-bridge-kit.mjs";

const PORT = Number(process.env.PORT ?? 8082);
const PUBLIC = env("PUBLIC_BASE_URL").replace(/\/$/, "");
const SID = env("TWILIO_ACCOUNT_SID");
const TOKEN = env("TWILIO_AUTH_TOKEN");
const API = process.env.TWILIO_API_BASE ?? "https://api.twilio.com";
const basicAuth = `Basic ${Buffer.from(`${SID}:${TOKEN}`).toString("base64")}`;

/**
 * Twilio's X-Twilio-Signature: base64(HMAC-SHA1(auth token, full URL + each POST
 * parameter name and value, sorted by name)). The official SDKs ship this as
 * validateRequest(); it is spelled out here to keep the example dependency-free.
 */
export function twilioSignature(authToken, url, params) {
  const data = url + [...params.keys()].sort().map((k) => k + params.getAll(k).join("")).join("");
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

function verifyTwilio(req, rawBody, path) {
  const params = new URLSearchParams(rawBody);
  return { ok: safeEqual(twilioSignature(TOKEN, PUBLIC + path, params), req.headers["x-twilio-signature"]), params };
}

const twiml = (res) => {
  // An empty TwiML response: no automatic reply to the customer.
  res.writeHead(200, { "Content-Type": "text/xml" });
  res.end("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>");
};

// ── Inbound ─────────────────────────────────────────────────────────────────

async function handleInbound(req, res, rawBody) {
  const { ok, params: p } = verifyTwilio(req, rawBody, "/twilio/inbound");
  if (!ok) {
    res.writeHead(403);
    return res.end();
  }
  const attachments = [];
  for (let i = 0; i < Number(p.get("NumMedia") ?? 0); i++) {
    const url = p.get(`MediaUrl${i}`);
    const mimeType = p.get(`MediaContentType${i}`) ?? "application/octet-stream";
    const fileName = `mms-${p.get("MessageSid").slice(-8)}-${i + 1}`;
    const file = process.env.DOWNLOAD_MEDIA === "1" ? await fetchAsCrmAttachment(url, { fileName, mimeType, headers: { Authorization: basicAuth } }) : null;
    attachments.push(file ?? { fileName, mimeType, mediaId: url });
  }
  await sendToCrm([
    {
      type: "message",
      id: p.get("MessageSid"),
      from: { phone: p.get("From") }, // E.164, e.g. +919810012345
      text: p.get("Body") ?? "",
      ...(attachments.length ? { attachments } : {}),
    },
  ]);
  twiml(res);
}

const STATUS = { sent: "sent", delivered: "delivered", read: "read", failed: "failed", undelivered: "failed" };

async function handleStatus(req, res, rawBody) {
  const { ok, params: p } = verifyTwilio(req, rawBody, "/twilio/status");
  if (!ok) {
    res.writeHead(403);
    return res.end();
  }
  const status = STATUS[p.get("MessageStatus")]; // queued / sending / accepted are not forwarded
  if (status) {
    await sendStatusesToCrm([{ type: "status", messageId: p.get("MessageSid"), status, ...(p.get("ErrorCode") ? { error: `Twilio error ${p.get("ErrorCode")}` } : {}) }]);
  }
  res.writeHead(204);
  res.end();
}

// ── Outbound ────────────────────────────────────────────────────────────────

// MMS needs a public URL per file. Files are kept in memory for one hour behind an unguessable token.
const media = new Map();
function publishMedia(att) {
  const token = randomBytes(24).toString("base64url");
  media.set(token, { ...att, until: Date.now() + 3600_000 });
  return `${PUBLIC}/media/${token}`;
}
function serveMedia(_req, res, _raw, _buf, url) {
  const m = media.get(url.pathname.split("/").pop());
  if (!m || m.until < Date.now()) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { "Content-Type": m.mimeType });
  res.end(Buffer.from(m.contentBase64, "base64"));
}

async function deliver(p) {
  const form = new URLSearchParams({ To: p.to.value, StatusCallback: `${PUBLIC}/twilio/status` });
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) form.set("MessagingServiceSid", process.env.TWILIO_MESSAGING_SERVICE_SID);
  else form.set("From", env("TWILIO_FROM"));
  if (p.text) form.set("Body", p.text);
  for (const att of p.attachments ?? []) form.append("MediaUrl", publishMedia(att)); // MMS: US / Canada numbers only
  const res = await fetch(`${API}/2010-04-01/Accounts/${SID}/Messages.json`, { method: "POST", headers: { Authorization: basicAuth, "Content-Type": "application/x-www-form-urlencoded" }, body: form, signal: AbortSignal.timeout(12_000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ProviderError(res.status >= 500 || res.status === 429 ? 502 : 422, `Twilio ${body.code ?? res.status}: ${body.message ?? "error"}`);
  return { messageId: body.sid }; // "queued" — the status callback reports sent / delivered / failed
}

startServer(PORT, {
  "POST /twilio/inbound": handleInbound,
  "POST /twilio/status": handleStatus,
  "POST /crm/outbound": outboundHandler({ deliver }),
  "GET /media/*": serveMedia,
});
