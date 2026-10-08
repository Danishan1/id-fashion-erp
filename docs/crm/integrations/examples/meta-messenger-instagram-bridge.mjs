// Facebook Messenger + Instagram Direct ⇄ Fashion ERP CRM bridge.
// Guides: docs/crm/integrations/03-FACEBOOK-MESSENGER.md and 04-INSTAGRAM.md
//
//   node meta-messenger-instagram-bridge.mjs
//
// One process can serve both (each is its own CRM channel with its own URL + secret).
// Leave a channel's variables empty to disable it.
//
// Environment:
//   PORT                          default 8081
//   META_APP_SECRET               Meta app → App settings → Basic → App secret
//   META_VERIFY_TOKEN             any string; type the same value in the Meta webhook settings
//   GRAPH_VERSION                 default v25.0
//   FB_GRAPH_BASE / IG_GRAPH_BASE defaults https://graph.facebook.com / https://graph.instagram.com (testing only)
//   DOWNLOAD_MEDIA                "1" = download images / files and store them in the CRM
//   Messenger:  FB_PAGE_ACCESS_TOKEN, FB_CRM_WEBHOOK_URL, FB_CRM_SIGNING_SECRET
//   Instagram:  IG_ACCESS_TOKEN,      IG_CRM_WEBHOOK_URL, IG_CRM_SIGNING_SECRET
//
// Routes:
//   GET  /meta/webhook           verification handshake (Messenger and Instagram)
//   POST /meta/webhook           object "page" → Messenger channel, object "instagram" → Instagram channel
//   POST /crm/outbound/messenger replies from the Messenger channel
//   POST /crm/outbound/instagram replies from the Instagram channel

import { createHmac } from "node:crypto";
import { env, fetchAsCrmAttachment, outboundHandler, ProviderError, safeEqual, sendJson, sendStatusesToCrm, sendToCrm, startServer } from "./crm-bridge-kit.mjs";

const PORT = Number(process.env.PORT ?? 8081);
const VERSION = process.env.GRAPH_VERSION ?? "v25.0";
const APP_SECRET = env("META_APP_SECRET");
const VERIFY_TOKEN = env("META_VERIFY_TOKEN");

const CHANNELS = {
  page: process.env.FB_CRM_WEBHOOK_URL && {
    name: "messenger",
    crm: { url: process.env.FB_CRM_WEBHOOK_URL, secret: process.env.FB_CRM_SIGNING_SECRET },
    // Page access token as a query parameter, as in Meta's Send API examples.
    sendUrl: `${process.env.FB_GRAPH_BASE ?? "https://graph.facebook.com"}/${VERSION}/me/messages?access_token=${encodeURIComponent(process.env.FB_PAGE_ACCESS_TOKEN ?? "")}`,
    headers: {},
    attachments: true,
  },
  instagram: process.env.IG_CRM_WEBHOOK_URL && {
    name: "instagram",
    crm: { url: process.env.IG_CRM_WEBHOOK_URL, secret: process.env.IG_CRM_SIGNING_SECRET },
    sendUrl: `${process.env.IG_GRAPH_BASE ?? "https://graph.instagram.com"}/${VERSION}/me/messages`,
    headers: { Authorization: `Bearer ${process.env.IG_ACCESS_TOKEN ?? ""}` },
    // Instagram: text replies only in this example (configure the CRM channel with attachments off).
    attachments: false,
  },
};

// ── Inbound ─────────────────────────────────────────────────────────────────

function verifyMeta(req, rawBuffer) {
  return safeEqual(`sha256=${createHmac("sha256", APP_SECRET).update(rawBuffer).digest("hex")}`, req.headers["x-hub-signature-256"]);
}

async function attachmentOf(a, mid, i) {
  const url = a.payload?.url;
  const fileName = `${a.type}-${String(mid).slice(-8)}-${i + 1}`;
  if (url && process.env.DOWNLOAD_MEDIA === "1") {
    const file = await fetchAsCrmAttachment(url, { fileName });
    if (file) return file;
  }
  const mimeType = { image: "image/jpeg", video: "video/mp4", audio: "audio/mpeg" }[a.type] ?? "application/octet-stream";
  // Not downloaded: listed in the CRM as "not stored" with this reference.
  return { fileName, mimeType, mediaId: url ? url.slice(0, 500) : `${a.type}:${mid}` };
}

/** One messaging[] item → CRM events (messages, delivery / read receipts). Echoes of our own sends are skipped. */
async function toCrmEvents(ev) {
  const out = { messages: [], statuses: [] };
  const msg = ev.message;
  if (msg && !msg.is_echo && !msg.is_deleted) {
    const base = { type: "message", id: msg.mid, from: { id: ev.sender.id }, timestamp: new Date(ev.timestamp).toISOString() };
    if (msg.reply_to?.mid) base.inReplyTo = msg.reply_to.mid;
    const attachments = [];
    for (const [i, a] of (msg.attachments ?? []).entries()) {
      if (a.type === "fallback" || a.type === "template") continue;
      attachments.push(await attachmentOf(a, msg.mid, i));
    }
    const text = msg.text ?? msg.quick_reply?.payload ?? "";
    if (text || attachments.length) out.messages.push({ ...base, text, ...(attachments.length ? { attachments } : {}) });
  }
  if (ev.postback) out.messages.push({ type: "message", id: ev.postback.mid ?? `postback-${ev.sender.id}-${ev.timestamp}`, from: { id: ev.sender.id }, timestamp: new Date(ev.timestamp).toISOString(), text: ev.postback.title ?? ev.postback.payload ?? "[button]" });
  // Messenger delivery receipts name the delivered message ids; read receipts only carry a watermark time,
  // so they cannot be tied to one message and are not forwarded in this example.
  for (const mid of ev.delivery?.mids ?? []) out.statuses.push({ type: "status", messageId: mid, status: "delivered" });
  // Instagram "messaging_seen" names the message that was read.
  if (ev.read?.mid) out.statuses.push({ type: "status", messageId: ev.read.mid, status: "read" });
  return out;
}

async function handleWebhook(req, res, rawBody, rawBuffer) {
  if (!verifyMeta(req, rawBuffer)) return sendJson(res, 401, { error: "bad signature" });
  const body = JSON.parse(rawBody);
  const channel = CHANNELS[body.object];
  if (!channel) return sendJson(res, 200, { ignored: body.object }); // not configured here — acknowledge so Meta stops retrying
  const messages = [];
  const statuses = [];
  for (const entry of body.entry ?? []) {
    for (const ev of entry.messaging ?? []) {
      const r = await toCrmEvents(ev);
      messages.push(...r.messages);
      statuses.push(...r.statuses);
    }
  }
  for (let i = 0; i < messages.length; i += 50) await sendToCrm(messages.slice(i, i + 50), channel.crm);
  if (statuses.length) await sendStatusesToCrm(statuses, channel.crm);
  sendJson(res, 200, { ok: true });
}

function handleVerify(req, res, _raw, _buf, url) {
  if (url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === VERIFY_TOKEN) {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end(url.searchParams.get("hub.challenge") ?? "");
  }
  sendJson(res, 403, { error: "verification failed" });
}

// ── Outbound ────────────────────────────────────────────────────────────────

async function callSend(channel, init) {
  const res = await fetch(channel.sendUrl, { method: "POST", ...init, headers: { ...channel.headers, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(12_000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = body.error ?? {};
    // 1545041: the 24-hour standard messaging window has closed (Meta returns it as code or subcode).
    const outside = err.error_subcode === 1545041 || err.code === 1545041;
    throw new ProviderError(res.status >= 500 || res.status === 429 ? 502 : 422, outside ? "More than 24 hours since the customer's last message." : `${err.code ?? res.status} ${err.message ?? "Meta API error"}`);
  }
  return body.message_id;
}

function deliverFor(channel) {
  return async (p) => {
    const recipient = { id: p.to.value }; // PSID (Messenger) / IGSID (Instagram)
    const ids = [];
    if (p.text) ids.push(await callSend(channel, { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipient, messaging_type: "RESPONSE", message: { text: p.text } }) }));
    for (const att of p.attachments ?? []) {
      if (!channel.attachments) throw new ProviderError(422, "This bridge sends text only on this channel.");
      // Messenger Send API: multipart upload with "filedata".
      const form = new FormData();
      form.set("recipient", JSON.stringify(recipient));
      form.set("messaging_type", "RESPONSE");
      form.set("message", JSON.stringify({ attachment: { type: att.mimeType.startsWith("image/") ? "image" : "file", payload: { is_reusable: false } } }));
      form.set("filedata", new Blob([Buffer.from(att.contentBase64, "base64")], { type: att.mimeType }), att.fileName);
      ids.push(await callSend(channel, { body: form }));
    }
    return { messageId: ids[0] };
  };
}

const routes = { "GET /meta/webhook": handleVerify, "POST /meta/webhook": handleWebhook };
for (const channel of Object.values(CHANNELS)) if (channel) routes[`POST /crm/outbound/${channel.name}`] = outboundHandler({ secret: channel.crm.secret, deliver: deliverFor(channel) });
startServer(PORT, routes);
