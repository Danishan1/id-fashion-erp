# Website chat → CRM Inbox

Connect the chat box on your website so visitors' messages arrive in the CRM Inbox and your team's replies appear back in the visitor's chat.

Read [README.md](README.md) first for the shared protocol. Example: [`examples/website-chat-bridge.mjs`](examples/website-chat-bridge.mjs).

```
Visitor's browser ──POST /chat/send──► Your chat bridge ──signed POST──► CRM (channel type: Website chat)
Visitor's browser ◄─GET /chat/messages─ Your chat bridge ◄──signed POST── CRM (replies to the Outbound URL)
```

**The browser never calls the CRM** — the signing secret must stay on your server.

## What you need

- A server (Node.js 18+) reachable from your website and from the ERP, over HTTPS.
- A channel in CRM Settings → Channels of type **Website chat**.

## Step 1 — Create the channel

1. Go to CRM → Settings → Channels → **Add channel**.
2. Set Channel type **Website chat**, Name "Website chat".
3. Set **New conversations go to** = the person who answers website chats.
4. Save. Copy the **Webhook URL** and the **Signing secret**.

## Step 2 — Run the bridge

```bash
cd docs/crm/integrations/examples
export CRM_WEBHOOK_URL="https://erp.yourcompany.com/api/v1/crm/webhooks/conversations/generic/<channel id>"
export CRM_SIGNING_SECRET="whsec_…"
export ALLOWED_ORIGIN="https://www.yourstore.com"
PORT=8084 node website-chat-bridge.mjs
```

Open `http://localhost:8084/chat/demo` to try it: type a message, and it appears in CRM → Inbox.

## Step 3 — Enable replies

In CRM Settings → Channels → **Edit** the channel, set **Outbound URL** = `https://chat-bridge.yourcompany.com/crm/outbound`. Attachments are not used by this example — untick them.

## Step 4 — Add the widget to your site

The demo page shows the minimum. The essentials:

```html
<script>
const BRIDGE = "https://chat-bridge.yourcompany.com";
// A stable, random id per visitor (kept in the browser) = the CRM conversation for this visitor.
const sessionId = localStorage.getItem("crm-chat-session") || (crypto.randomUUID().replace(/-/g, "") + Date.now().toString(36));
localStorage.setItem("crm-chat-session", sessionId);

async function sendChat(text, details = {}) {            // details: { name, email, phone } from a pre-chat form
  await fetch(`${BRIDGE}/chat/send`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, clientMessageId: crypto.randomUUID(), text, page: location.pathname, ...details }),
  });
}

let after = "";
setInterval(async () => {                                 // replies from your team
  const r = await fetch(`${BRIDGE}/chat/messages?sessionId=${sessionId}${after ? "&after=" + encodeURIComponent(after) : ""}`).then((r) => r.json());
  for (const m of r.messages) { showAgentMessage(m.agent, m.text); after = m.at; }
}, 3000);
</script>
```

## What the bridge sends to the CRM

```json
{ "type": "message",
  "id": "a1b2c3…:5f0e…",                     // sessionId + the browser's message id → retries are harmless
  "threadId": "a1b2c3…",                      // one conversation per visitor session
  "from": { "sessionId": "a1b2c3…", "name": "Asha", "email": "asha@example.com" },
  "text": "Do you ship to Dubai?",
  "subject": "Chat from /products/polo-shirts" }
```

**Contact matching:**

- **Anonymous visitor (only `sessionId`):** the conversation goes to **Unmatched**. Your team can **Create contact** (with duplicate checks) or **Link existing contact**.
- **Visitor who gave an email or phone in a pre-chat form:** include it in `from`. The CRM matches the contact by it automatically.

## Replies and read receipts

1. The CRM POSTs the agent's reply to `/crm/outbound` with `to: { "kind": "SESSION", "value": "<sessionId>" }`.
2. The bridge stores it and answers `{ "messageId": "reply-…", "status": "sent" }`.
3. When the visitor's browser fetches it, the bridge reports `{ "type": "status", "messageId": "reply-…", "status": "read" }`, and the CRM shows **Read**.

## Production notes

- **Storage:** store waiting replies (and sessions) in Redis or a database instead of memory.
- **Polling:** every 3 s is simple and works everywhere. You can swap it for WebSockets or Server-Sent Events between the browser and your bridge — nothing changes on the CRM side.
- **Abuse:** keep the per-session rate limit and input length limits. Consider a CAPTCHA for anonymous visitors.
- **Offline replies:** if the visitor has left, the reply still waits; show it on their next visit (same `sessionId`). You can also ask for their email so the team can follow up by email.
