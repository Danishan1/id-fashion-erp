// WhatsApp Business Platform (Meta Cloud API) ⇄ Fashion ERP CRM bridge.
// Guide: docs/crm/integrations/02-WHATSAPP.md
//
//   node whatsapp-cloud-bridge.mjs
//
// Environment:
//   PORT                      default 8080
//   CRM_WEBHOOK_URL           CRM Settings → Channels → (WhatsApp channel) webhook URL
//   CRM_SIGNING_SECRET        that channel's signing secret
//   WA_PHONE_NUMBER_ID        Meta: WhatsApp Manager / API setup → Phone number ID
//   WA_ACCESS_TOKEN           Meta: system-user access token with whatsapp_business_messaging
//   META_APP_SECRET           Meta: App settings → Basic → App secret (verifies webhook signatures)
//   META_VERIFY_TOKEN         any string you choose; type the same value in the Meta webhook settings
//   GRAPH_VERSION             default v25.0
//   GRAPH_BASE                default https://graph.facebook.com (override only for testing)
//   DOWNLOAD_MEDIA            "1" = fetch images / documents from Meta and store them in the CRM
//
// Routes:
//   GET  /whatsapp/webhook    Meta's verification handshake
//   POST /whatsapp/webhook    messages + statuses from Meta  → CRM
//   POST /crm/outbound        replies from the CRM inbox      → Meta

import { createHmac } from "node:crypto";
import { env, fetchAsCrmAttachment, isoFromUnix, outboundHandler, ProviderError, safeEqual, sendJson, sendStatusesToCrm, sendToCrm, startServer } from "./crm-bridge-kit.mjs";

const PORT = Number(process.env.PORT ?? 8080);
const GRAPH = `${process.env.GRAPH_BASE ?? "https://graph.facebook.com"}/${process.env.GRAPH_VERSION ?? "v25.0"}`;
const PHONE_NUMBER_ID = env("WA_PHONE_NUMBER_ID");
const TOKEN = env("WA_ACCESS_TOKEN");
const APP_SECRET = env("META_APP_SECRET");
const VERIFY_TOKEN = env("META_VERIFY_TOKEN");
const auth = { Authorization: `Bearer ${TOKEN}` };

// ── Inbound: Meta → CRM ─────────────────────────────────────────────────────

/** Meta signs the raw body: X-Hub-Signature-256: sha256=<HMAC-SHA256(app secret, body)>. */
function verifyMeta(req, rawBuffer) {
  const expected = `sha256=${createHmac("sha256", APP_SECRET).update(rawBuffer).digest("hex")}`;
  return safeEqual(expected, req.headers["x-hub-signature-256"]);
}

async function mediaAttachment(media, fallbackName) {
  // Without DOWNLOAD_MEDIA the CRM lists the file by its Meta media id ("not stored").
  if (process.env.DOWNLOAD_MEDIA !== "1") return { fileName: media.filename ?? fallbackName, mimeType: media.mime_type, mediaId: media.id };
  const meta = await fetch(`${GRAPH}/${media.id}`, { headers: auth }).then((r) => (r.ok ? r.json() : null));
  const file = meta?.url ? await fetchAsCrmAttachment(meta.url, { fileName: media.filename ?? fallbackName, mimeType: media.mime_type, headers: auth }) : null;
  return file ?? { fileName: media.filename ?? fallbackName, mimeType: media.mime_type, mediaId: media.id };
}

/** One Meta message → one CRM "message" event. */
async function toCrmMessage(m, contacts) {
  const name = contacts?.find((c) => c.wa_id === m.from)?.profile?.name ?? null;
  const event = { type: "message", id: m.id, from: { phone: `+${m.from}`, name }, timestamp: isoFromUnix(m.timestamp) };
  if (m.context?.id) event.inReplyTo = m.context.id;
  switch (m.type) {
    case "text":
      return { ...event, text: m.text.body };
    case "image":
    case "document":
    case "audio":
    case "video":
    case "sticker": {
      const media = m[m.type];
      return { ...event, text: media.caption ?? "", attachments: [await mediaAttachment(media, `${m.type}-${m.id.slice(-8)}`)] };
    }
    case "location":
      return { ...event, location: { latitude: m.location.latitude, longitude: m.location.longitude, name: m.location.name ?? m.location.address ?? null } };
    case "button":
      return { ...event, text: m.button.text };
    case "interactive":
      return { ...event, text: m.interactive.button_reply?.title ?? m.interactive.list_reply?.title ?? "[interactive reply]" };
    default:
      // Reactions, contacts cards, unsupported types: keep a readable trace instead of dropping them.
      return { ...event, text: `[${m.type} message]`, messageType: "OTHER" };
  }
}

const STATUS = { sent: "sent", delivered: "delivered", read: "read", failed: "failed" };

async function handleWebhook(req, res, rawBody, rawBuffer) {
  if (!verifyMeta(req, rawBuffer)) return sendJson(res, 401, { error: "bad signature" });
  const body = JSON.parse(rawBody);
  const messages = [];
  const statuses = [];
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value ?? {};
      if (v.metadata?.phone_number_id && v.metadata.phone_number_id !== PHONE_NUMBER_ID) continue; // another number on the same app
      for (const m of v.messages ?? []) messages.push(await toCrmMessage(m, v.contacts));
      for (const s of v.statuses ?? []) {
        if (!STATUS[s.status]) continue;
        statuses.push({ type: "status", messageId: s.id, status: STATUS[s.status], timestamp: isoFromUnix(s.timestamp), ...(s.errors?.[0] ? { error: `${s.errors[0].code ?? ""} ${s.errors[0].title ?? "Delivery failed"}`.trim() } : {}) });
      }
    }
  }
  // Forward before answering: if the CRM is unreachable we answer 500 and Meta retries (up to 7 days).
  // Re-deliveries are safe — the CRM stores each WhatsApp message id once.
  for (let i = 0; i < messages.length; i += 50) await sendToCrm(messages.slice(i, i + 50));
  if (statuses.length) await sendStatusesToCrm(statuses);
  sendJson(res, 200, { ok: true });
}

function handleVerify(req, res, _raw, _buf, url) {
  if (url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === VERIFY_TOKEN) {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end(url.searchParams.get("hub.challenge") ?? "");
  }
  sendJson(res, 403, { error: "verification failed" });
}

// ── Outbound: CRM → Meta ────────────────────────────────────────────────────

async function graph(path, init) {
  const res = await fetch(`${GRAPH}${path}`, { ...init, headers: { ...auth, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(12_000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = body.error ?? {};
    // 131047 = more than 24 hours since the customer's last message: only approved templates may be sent.
    const reason = err.code === 131047 ? "Outside the 24-hour customer service window — send an approved template from WhatsApp Manager." : `${err.code ?? res.status} ${err.message ?? "Meta API error"}`;
    throw new ProviderError(res.status >= 500 || res.status === 429 ? 502 : 422, reason);
  }
  return body;
}

async function uploadMedia(att) {
  const form = new FormData();
  form.set("messaging_product", "whatsapp");
  form.set("type", att.mimeType);
  form.set("file", new Blob([Buffer.from(att.contentBase64, "base64")], { type: att.mimeType }), att.fileName);
  return (await graph(`/${PHONE_NUMBER_ID}/media`, { method: "POST", body: form })).id;
}

async function deliver(p) {
  const to = p.to.value.replace(/[^\d]/g, ""); // "+91 98100 12345" → "919810012345"
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to, ...(p.inReplyTo ? { context: { message_id: p.inReplyTo } } : {}) };
  const ids = [];
  if (p.text) ids.push((await graph(`/${PHONE_NUMBER_ID}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...base, type: "text", text: { preview_url: false, body: p.text } }) })).messages[0].id);
  for (const att of p.attachments ?? []) {
    const mediaId = await uploadMedia(att);
    const type = att.mimeType.startsWith("image/") ? "image" : "document";
    const media = type === "image" ? { id: mediaId } : { id: mediaId, filename: att.fileName };
    ids.push((await graph(`/${PHONE_NUMBER_ID}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...base, type, [type]: media }) })).messages[0].id);
  }
  // The CRM tracks one provider id per message: the first WhatsApp message carries the delivery receipts.
  return { messageId: ids[0] };
}

startServer(PORT, {
  "GET /whatsapp/webhook": handleVerify,
  "POST /whatsapp/webhook": handleWebhook,
  "POST /crm/outbound": outboundHandler({ deliver }),
});
