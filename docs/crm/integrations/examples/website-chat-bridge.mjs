// Website chat ⇄ Fashion ERP CRM bridge (your own chat backend).
// Guide: docs/crm/integrations/01-WEBSITE-CHAT.md
//
//   node website-chat-bridge.mjs     then open http://localhost:8084/chat/demo
//
// The browser NEVER talks to the CRM and never sees the signing secret: the
// widget talks to this bridge, the bridge signs requests to the CRM.
//
// Environment:
//   PORT                 default 8084
//   CRM_WEBHOOK_URL      CRM Settings → Channels → (Website chat channel) webhook URL
//   CRM_SIGNING_SECRET   that channel's signing secret
//   ALLOWED_ORIGIN       your website origin for CORS, e.g. https://www.yourstore.com (default *)
//
// Routes (widget):
//   POST /chat/send        { sessionId, clientMessageId, text, name?, email?, phone? }
//   GET  /chat/messages    ?sessionId=…&after=<ISO time>  → agent replies
//   GET  /chat/demo        a test page with a minimal widget
// Routes (CRM):
//   POST /crm/outbound     replies from the CRM inbox (kept until the visitor's browser picks them up)

import { randomUUID } from "node:crypto";
import { outboundHandler, ProviderError, sendJson, sendStatusesToCrm, sendToCrm, startServer } from "./crm-bridge-kit.mjs";

const PORT = Number(process.env.PORT ?? 8084);
const ORIGIN = process.env.ALLOWED_ORIGIN ?? "*";
const SESSION_RE = /^[A-Za-z0-9_-]{16,100}$/;

// Replies waiting for each visitor (use your database / Redis in production).
const inbox = new Map(); // sessionId → [{ id, text, at }]
const rate = new Map(); // sessionId → { start, count }

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", ORIGIN);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function limited(sessionId) {
  const w = rate.get(sessionId);
  if (!w || Date.now() - w.start > 60_000) {
    rate.set(sessionId, { start: Date.now(), count: 1 });
    return false;
  }
  return ++w.count > 20; // 20 messages per minute per visitor
}

async function handleSend(req, res, rawBody) {
  cors(res);
  let b;
  try {
    b = JSON.parse(rawBody);
  } catch {
    return sendJson(res, 400, { error: "JSON body required" });
  }
  const text = String(b.text ?? "").trim().slice(0, 4000);
  if (!SESSION_RE.test(b.sessionId ?? "") || !/^[A-Za-z0-9-]{8,64}$/.test(b.clientMessageId ?? "") || !text) return sendJson(res, 400, { error: "sessionId, clientMessageId and text are required" });
  if (limited(b.sessionId)) return sendJson(res, 429, { error: "slow down" });
  const from = { sessionId: b.sessionId };
  // Optional details the visitor typed into a pre-chat form: the CRM uses email / phone to find the contact.
  if (b.name) from.name = String(b.name).slice(0, 200);
  if (b.email) from.email = String(b.email).slice(0, 254);
  if (b.phone) from.phone = String(b.phone).slice(0, 40);
  // The id must be unique per message: sessionId + the browser's own message id makes retries harmless.
  const data = await sendToCrm([{ type: "message", id: `${b.sessionId}:${b.clientMessageId}`, threadId: b.sessionId, from, text, ...(b.page ? { subject: `Chat from ${String(b.page).slice(0, 200)}` } : {}) }]);
  sendJson(res, 200, { ok: true, outcome: data.results[0]?.outcome });
}

async function handleMessages(req, res, _raw, _buf, url) {
  cors(res);
  const sessionId = url.searchParams.get("sessionId") ?? "";
  if (!SESSION_RE.test(sessionId)) return sendJson(res, 400, { error: "sessionId required" });
  const after = url.searchParams.get("after");
  const replies = (inbox.get(sessionId) ?? []).filter((r) => !after || r.at > after);
  // The visitor's browser now has these replies: tell the CRM they were read.
  const unread = replies.filter((r) => !r.reported);
  if (unread.length) {
    unread.forEach((r) => (r.reported = true));
    sendStatusesToCrm(unread.map((r) => ({ type: "status", messageId: r.id, status: "read" }))).catch((e) => console.error("read receipts:", e.message));
  }
  sendJson(res, 200, { messages: replies.map(({ id, text, at, agent }) => ({ id, text, at, agent })) });
}

async function deliver(p) {
  if (p.to.kind !== "SESSION") throw new ProviderError(422, "Website chat replies go to a chat session.");
  const id = `reply-${randomUUID()}`;
  const list = inbox.get(p.to.value) ?? [];
  list.push({ id, text: p.text, at: new Date().toISOString(), agent: "Support" });
  inbox.set(p.to.value, list.slice(-200));
  return { messageId: id, status: "sent" };
}

const DEMO = `<!doctype html><meta charset="utf-8"><title>Chat demo</title>
<style>body{font:15px system-ui;max-width:480px;margin:40px auto}#log{border:1px solid #ccc;height:300px;overflow:auto;padding:8px}.me{text-align:right;color:#3730a3}</style>
<h1>Chat with us</h1><div id="log"></div>
<form id="f"><input id="name" placeholder="Your name"> <input id="email" placeholder="Email (optional)"><br><input id="t" placeholder="Type a message" style="width:75%" autofocus> <button>Send</button></form>
<script>
const KEY = "crm-chat-session";
const sessionId = localStorage.getItem(KEY) || (crypto.randomUUID().replace(/-/g, "") + Date.now().toString(36));
localStorage.setItem(KEY, sessionId);
let after = "";
const log = (who, text) => { const p = document.createElement("p"); p.className = who; p.textContent = text; document.getElementById("log").append(p); };
document.getElementById("f").onsubmit = async (e) => {
  e.preventDefault();
  const text = document.getElementById("t").value.trim(); if (!text) return;
  log("me", text); document.getElementById("t").value = "";
  await fetch("/chat/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, clientMessageId: crypto.randomUUID(), text, name: document.getElementById("name").value || undefined, email: document.getElementById("email").value || undefined, page: location.pathname }) });
};
setInterval(async () => {
  const r = await fetch("/chat/messages?sessionId=" + sessionId + (after ? "&after=" + encodeURIComponent(after) : "")).then((r) => r.json());
  for (const m of r.messages) { log("agent", m.agent + ": " + m.text); after = m.at; }
}, 3000);
</script>`;

startServer(PORT, {
  "OPTIONS /chat/send": (_req, res) => (cors(res), res.writeHead(204), res.end()),
  "POST /chat/send": handleSend,
  "GET /chat/messages": handleMessages,
  "GET /chat/demo": (_req, res) => (res.writeHead(200, { "Content-Type": "text/html" }), res.end(DEMO)),
  "POST /crm/outbound": outboundHandler({ deliver }),
});
