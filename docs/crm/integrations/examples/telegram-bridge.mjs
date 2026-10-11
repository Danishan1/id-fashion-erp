// Telegram bot ⇄ Fashion ERP CRM bridge — a worked example of connecting a platform
// that has no ready-made CRM channel type (CRM channel type: Other).
// Guide: docs/crm/integrations/07-OTHER-SYSTEMS.md
//
//   node telegram-bridge.mjs
//
// Environment:
//   PORT                   default 8086
//   CRM_WEBHOOK_URL        CRM Settings → Channels → (Other channel "Telegram") webhook URL
//   CRM_SIGNING_SECRET     that channel's signing secret
//   TELEGRAM_BOT_TOKEN     from @BotFather
//   TELEGRAM_SECRET_TOKEN  any random string (A-Z a-z 0-9 _ -), also passed to setWebhook as secret_token
//   TELEGRAM_API_BASE      default https://api.telegram.org (testing only)
//
// Routes:
//   POST /telegram/webhook   Telegram updates → CRM
//   POST /crm/outbound       replies from the CRM inbox → Telegram sendMessage

import { env, outboundHandler, ProviderError, safeEqual, sendJson, sendToCrm, startServer } from "./crm-bridge-kit.mjs";

const PORT = Number(process.env.PORT ?? 8086);
const API = `${process.env.TELEGRAM_API_BASE ?? "https://api.telegram.org"}/bot${env("TELEGRAM_BOT_TOKEN")}`;
const SECRET_TOKEN = env("TELEGRAM_SECRET_TOKEN");

// Telegram message ids are only unique inside one chat, so the CRM id is "<chat id>:<message id>".
const crmId = (chatId, messageId) => `${chatId}:${messageId}`;

async function handleWebhook(req, res, rawBody) {
  // Telegram sends the secret_token given to setWebhook in this header on every update.
  if (!safeEqual(req.headers["x-telegram-bot-api-secret-token"] ?? "", SECRET_TOKEN)) return sendJson(res, 401, { error: "bad secret token" });
  const update = JSON.parse(rawBody);
  const m = update.message;
  // Only private chats with the bot; edits, channel posts and group chats are acknowledged and skipped.
  if (!m || m.chat?.type !== "private") return sendJson(res, 200, { ignored: true });
  const name = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(" ") || m.from?.username;
  let text = m.text ?? m.caption ?? "";
  // Files: listed in the CRM by Telegram file id (download with getFile if you want to store them).
  const attachments = [];
  if (m.document) attachments.push({ fileName: m.document.file_name ?? "file", mimeType: m.document.mime_type ?? "application/octet-stream", mediaId: m.document.file_id });
  if (m.photo?.length) attachments.push({ fileName: `photo-${m.message_id}.jpg`, mimeType: "image/jpeg", mediaId: m.photo.at(-1).file_id });
  if (!text && !attachments.length) text = "[unsupported Telegram message]";
  await sendToCrm([
    {
      type: "message",
      id: crmId(m.chat.id, m.message_id),
      from: { id: String(m.chat.id), ...(name ? { name } : {}) },
      timestamp: new Date(m.date * 1000).toISOString(),
      text,
      ...(m.reply_to_message ? { inReplyTo: crmId(m.chat.id, m.reply_to_message.message_id) } : {}),
      ...(attachments.length ? { attachments } : {}),
    },
  ]);
  sendJson(res, 200, { ok: true }); // any non-2xx makes Telegram retry the update
}

async function deliver(p) {
  if (p.to.kind !== "PROVIDER_ID") throw new ProviderError(422, "Telegram replies go to a chat id.");
  if (p.attachments?.length) throw new ProviderError(422, "This bridge sends text only — turn attachments off for the channel.");
  const body = { chat_id: p.to.value, text: p.text };
  const replyTo = p.inReplyTo?.startsWith(`${p.to.value}:`) ? Number(p.inReplyTo.split(":")[1]) : null;
  if (replyTo) body.reply_parameters = { message_id: replyTo, allow_sending_without_reply: true };
  const res = await fetch(`${API}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(12_000) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out.ok) throw new ProviderError(res.status === 429 || res.status >= 500 ? 502 : 422, `Telegram ${out.error_code ?? res.status}: ${out.description ?? "error"}`);
  // Bots get no delivery / read receipts, so the message stays at Sent.
  return { messageId: crmId(p.to.value, out.result.message_id), status: "sent" };
}

startServer(PORT, {
  "POST /telegram/webhook": handleWebhook,
  "POST /crm/outbound": outboundHandler({ deliver }),
});
