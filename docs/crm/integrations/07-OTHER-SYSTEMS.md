# Other systems → CRM Inbox

How to connect anything that isn't covered by the other guides: another messaging platform (Telegram, LINE, Viber…), another SMS / WhatsApp gateway, your own customer portal or app, or a no-code tool (n8n, Make, Zapier).

Read [README.md](README.md) first — every integration uses the same two signed HTTP calls. Examples:

- [`examples/telegram-bridge.mjs`](examples/telegram-bridge.mjs) — a full worked example for a platform with no ready-made channel type (Node.js).
- [`examples/inhouse_bridge.py`](examples/inhouse_bridge.py) — a template for your own system (Python, standard library only).

## The recipe (any platform)

Every bridge does the same four jobs. Write them in this order and test each before the next.

| # | Job | What to do |
|---|---|---|
| 1 | **Receive** the platform's incoming-message webhook | Verify it the way the platform documents (signature, secret header, basic auth). Answer `2xx` quickly. |
| 2 | **Map** it to a CRM `message` event and send it signed | `id` = the platform's unique message id · `from` = the customer's identity · `text` · optional `threadId`, `inReplyTo`, `attachments`. |
| 3 | **Deliver** CRM replies | Verify the CRM's signature, de-duplicate by `X-CRM-Idempotency-Key`, call the platform's send API, answer `{ "messageId": "<platform id>" }`. |
| 4 | **Report** delivery statuses (if the platform has them) | Map to `sent` / `delivered` / `read` / `failed` and send `status` events with `messageId` = the id you returned in step 3. |

**Choosing the CRM channel type:** use the matching type if there is one (an SMS gateway → **SMS**, a WhatsApp BSP → **WhatsApp**), because those types match contacts by phone and use the right consent setting. Use **Other** for everything else.

**Choosing the identity (`from`):**

| You have… | Send | Result |
|---|---|---|
| A phone number | `from.phone` in international format (`+91…`) | Matched to contacts by phone (SMS / WhatsApp types; Other uses it after `id` and `email`) |
| An email | `from.email` | Matched to contacts by email |
| Only a platform user id | `from.id` | First conversation is **Unmatched**; after your team links it to a contact once, later ones match automatically |
| Several | All of them | The channel type decides which is the identity; the others help matching |

**Choosing the ids:**

- `id` must be unique per message **within the channel** and the same on every retry — that's what makes retries harmless. If the platform's ids are only unique per chat, prefix them (`"<chat id>:<message id>"`).
- `threadId` is optional. Leave it out to get one conversation per customer; set it to split a customer's messages into several conversations (email threads, support tickets).
- The `messageId` you return for a reply must be what the platform will later name in its status callbacks.

## Worked example 1 — Telegram bot

A Telegram bot is a good model for any chat platform: a webhook in, an HTTP send API out, ids per chat, no delivery receipts.

```
Customer ─► Telegram ─ update (X-Telegram-Bot-Api-Secret-Token) ─► bridge /telegram/webhook ─signed─► CRM (Other channel)
Customer ◄─ Telegram ◄─ POST /bot<token>/sendMessage ◄─ bridge /crm/outbound ◄─signed─ CRM
```

**Step 1 — Create the bot and the channel**

1. In Telegram, talk to **@BotFather** → `/newbot` → copy the **bot token**.
2. CRM → Settings → Channels → **Add channel**: type **Other**, Name "Telegram", untick attachments. Save; copy the **Webhook URL** and **Signing secret**.

**Step 2 — Run the bridge**

```bash
export CRM_WEBHOOK_URL="https://erp.yourcompany.com/api/v1/crm/webhooks/conversations/generic/<channel id>"
export CRM_SIGNING_SECRET="whsec_…"
export TELEGRAM_BOT_TOKEN="123456:ABC…"
export TELEGRAM_SECRET_TOKEN="a-long-random-string"
PORT=8086 node telegram-bridge.mjs
```

**Step 3 — Register the webhook with Telegram**

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d url="https://tg-bridge.yourcompany.com/telegram/webhook" \
  -d secret_token="$TELEGRAM_SECRET_TOKEN" \
  -d allowed_updates='["message"]'
```

**Step 4 — Enable replies:** channel **Outbound URL** = `https://tg-bridge.yourcompany.com/crm/outbound`.

**Mapping.** Telegram sends:

```json
{ "update_id": 81723,
  "message": { "message_id": 55, "date": 1758000000,
               "from": { "id": 731234567, "first_name": "Ravi", "last_name": "K" },
               "chat": { "id": 731234567, "type": "private" },
               "text": "Do you have bulk pricing?" } }
```

The bridge sends the CRM:

```json
{ "type": "message", "id": "731234567:55",
  "from": { "id": "731234567", "name": "Ravi K" },
  "timestamp": "2025-09-16T05:20:00.000Z",
  "text": "Do you have bulk pricing?" }
```

A CRM reply (`to: { "kind": "PROVIDER_ID", "value": "731234567" }`) becomes:

```bash
POST https://api.telegram.org/bot<token>/sendMessage
{ "chat_id": "731234567", "text": "Yes — from 100 pieces.", "reply_parameters": { "message_id": 55, "allow_sending_without_reply": true } }
```

Telegram answers `{ "ok": true, "result": { "message_id": 56, … } }` → the bridge returns `{ "messageId": "731234567:56", "status": "sent" }`. Bots get no delivery or read receipts, so replies stay at **Sent**.

## Worked example 2 — your own system (Python)

Use this when your own application talks to the customer — a B2B ordering portal with a "message us" box, a mobile app, a call-centre tool — and you want those conversations in the CRM Inbox.

```
Your system ─POST /inbound (X-Api-Key)─► inhouse_bridge.py ─signed─► CRM (Other channel)
Your system ◄─POST INHOUSE_SEND_URL (Bearer)── inhouse_bridge.py ◄─signed─ CRM (replies)
Your system ─POST /status (X-Api-Key)─► inhouse_bridge.py ─signed─► CRM (Delivered / Read)
```

**Step 1 — Channel:** type **Other**, Name "B2B portal". Copy the URL and secret.

**Step 2 — Run the bridge**

```bash
export CRM_WEBHOOK_URL="https://erp.yourcompany.com/api/v1/crm/webhooks/conversations/generic/<channel id>"
export CRM_SIGNING_SECRET="whsec_…"
export INHOUSE_SEND_URL="https://portal.yourcompany.com/api/support/messages"
export INHOUSE_API_KEY="…"            # the bridge uses this to call your system
export INHOUSE_INBOUND_KEY="…"        # your system uses this to call the bridge
PORT=8085 python3 inhouse_bridge.py
```

**Step 3 — From your system, post each customer message to the bridge:**

```bash
curl -X POST https://inhouse-bridge.yourcompany.com/inbound \
  -H "Content-Type: application/json" -H "X-Api-Key: $INHOUSE_INBOUND_KEY" \
  -d '{"id":"portal-msg-88231","customerId":"CUST-1042","name":"Asha Rao","email":"asha@example.com","text":"Where is my order SO-2231?"}'
```

The bridge sends the CRM `{ "type":"message", "id":"portal-msg-88231", "from":{ "id":"CUST-1042", "name":"Asha Rao", "email":"asha@example.com" }, "text":"…" }`. Because an email is included, the conversation is matched to the contact automatically.

**Step 4 — Replies:** set the channel's **Outbound URL** = `https://inhouse-bridge.yourcompany.com/crm/outbound`. For each reply the bridge calls your system:

```json
POST <INHOUSE_SEND_URL>
Authorization: Bearer <INHOUSE_API_KEY>
{ "customerId": "CUST-1042", "conversationRef": null, "text": "It ships tomorrow.", "attachments": [], "crmMessageId": "b51c…" }
```

Your system must answer `{ "messageId": "<your id>" }`. Answer `4xx` for a permanent problem (the CRM shows **Failed**) or `5xx` for a temporary one.

**Step 5 — Statuses (optional):** when your app shows the reply to the customer, post `{"messageId":"<your id>","status":"read"}` to `/status`.

## No-code tools (n8n, Make, Zapier)

These work, with one rule: **the signature is over the exact bytes sent**. Build the JSON body as a text value first, sign that text, then send that same text as a raw body — never let the tool re-serialise it after signing.

**Sending messages to the CRM (inbound):**

| Tool | How |
|---|---|
| **n8n** | 1. A trigger (your platform's webhook, a form, an email trigger). 2. **Code** node: build `body = JSON.stringify({ type: "message", id, from: {…}, text })`, `ts = Math.floor(Date.now()/1000)`. 3. **Crypto** node: action *Hmac*, type *SHA256*, value `{{ts}}.{{body}}`, secret = the signing secret (store it as a credential / env var), encoding *hex*. 4. **HTTP Request** node: POST the webhook URL, body type *Raw* / content type `application/json` with `{{ $json.body }}`, headers `X-CRM-Timestamp` and `X-CRM-Signature: sha256={{hmac}}`. |
| **Make** | 1. Set variables: `ts` = `{{formatDate(now; "X")}}` and `body` = the JSON text. 2. Set `sig` = `{{sha256(ts + "." + body; "hex"; <signing secret>)}}` — Make's `sha256()` computes an HMAC when given a key (build the text `<ts>.<body>` in any way Make allows). 3. **HTTP › Make a request**: POST, body type *Raw*, content type JSON, request content `{{body}}`, headers `X-CRM-Timestamp: {{ts}}` and `X-CRM-Signature: sha256={{sig}}`. |
| **Zapier** | A **Code by Zapier** (JavaScript) step: build the body, sign with `require('crypto').createHmac('sha256', secret).update(ts + '.' + body).digest('hex')`, and `await fetch(url, { method: 'POST', headers: {…}, body })` in the same step. |

Check each tool's current documentation for the exact node / function names; whatever the tool, test with a wrong secret first and confirm the CRM answers `401`.

**Receiving CRM replies (outbound)** into a no-code tool is harder: you must verify `X-CRM-Signature` over the **raw** request body before acting on it. n8n can do this (Webhook node with the *Raw body* option, then a Code node that recomputes the HMAC and stops on mismatch). Make and Zapier parse the JSON before you can see the raw bytes — for those, put a small verifier in front (for example the Python template above, with `deliver()` forwarding the verified payload to the Make / Zapier webhook) rather than accepting unverified requests.

## Adapting a gateway — checklist

Use this when adapting any of the example bridges to another provider (Gupshup, MSG91, Kaleyra, Exotel, Infobip, Vonage, 360dialog, SendGrid…):

- [ ] Inbound webhook verified as the provider documents; unverified requests get `401` / `403`.
- [ ] `id` = the provider's message id (stable across the provider's retries).
- [ ] Phone numbers sent as `+<country code><number>`; emails as plain addresses.
- [ ] Bridge answers the provider `2xx` only after the CRM accepted the event (so the provider retries if the CRM was down) — or queues the event durably and answers immediately.
- [ ] `deliver()` returns the provider's id; throws `ProviderError(422, …)` for permanent errors and `ProviderError(502, …)` for temporary ones.
- [ ] Same `X-CRM-Idempotency-Key` → same answer, no second send.
- [ ] Delivery reports mapped to `sent` / `delivered` / `read` / `failed` with the same id.
- [ ] Tested with `send-test-message.mjs`, then with a real message both ways.
- [ ] Secrets only in environment variables / a secret store; never logged.
