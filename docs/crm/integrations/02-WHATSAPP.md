# WhatsApp (Meta WhatsApp Business Platform – Cloud API) → CRM Inbox

Customers' WhatsApp messages arrive in the CRM Inbox. Your team replies from the CRM, and replies are delivered on WhatsApp with Sent / Delivered / Read ticks.

Read [README.md](README.md) first. Example: [`examples/whatsapp-cloud-bridge.mjs`](examples/whatsapp-cloud-bridge.mjs).

```
WhatsApp user ─► Meta Cloud API ─webhook (X-Hub-Signature-256)─► bridge /whatsapp/webhook ─signed─► CRM
WhatsApp user ◄─ Meta Cloud API ◄─ POST /{phone-number-id}/messages ─ bridge /crm/outbound ◄─signed─ CRM
```

> Using a WhatsApp Business Solution Provider (BSP) such as Twilio or Gupshup instead of Meta directly? The flow is identical — only the provider-side calls change. See [05-SMS.md](05-SMS.md) for Twilio (WhatsApp uses `whatsapp:+…` addresses there) and [07-OTHER-SYSTEMS.md](07-OTHER-SYSTEMS.md) for adapting any gateway.

## What you need

- A Meta developer app with the **WhatsApp** product, a WhatsApp Business Account and a phone number. Note:
  - the **Phone number ID** (WhatsApp Manager / API setup);
  - a **permanent access token** — a system user token with the `whatsapp_business_messaging` permission;
  - the **App secret** (App settings → Basic).
- The bridge (Node.js 18+) on a public HTTPS URL.

## Step 1 — Create the CRM channel

1. Go to CRM → Settings → Channels → **Add channel**.
2. Set Channel type **WhatsApp**, Name "Sales WhatsApp", Business number "+91 80000 00000".
3. Choose a default assignee.
4. Save. Copy the **Webhook URL** and the **Signing secret**.

## Step 2 — Run the bridge

```bash
export CRM_WEBHOOK_URL="https://erp.yourcompany.com/api/v1/crm/webhooks/conversations/generic/<channel id>"
export CRM_SIGNING_SECRET="whsec_…"
export WA_PHONE_NUMBER_ID="106540352242922"
export WA_ACCESS_TOKEN="EAAG…"
export META_APP_SECRET="…"
export META_VERIFY_TOKEN="pick-any-long-random-string"
export DOWNLOAD_MEDIA=1          # store customers' photos / PDFs in the CRM (optional)
PORT=8080 node whatsapp-cloud-bridge.mjs
```

## Step 3 — Point Meta's webhook to the bridge

1. Meta app → WhatsApp → **Configuration** → Webhook:
   - **Callback URL:** `https://wa-bridge.yourcompany.com/whatsapp/webhook`
   - **Verify token:** the same value as `META_VERIFY_TOKEN`
2. Meta calls `GET …?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…`. The bridge echoes the challenge when the token matches.
3. Subscribe to the **messages** webhook field. It carries both incoming messages and the statuses of your outgoing messages.

## Step 4 — Enable replies in the CRM

Edit the channel:

- **Outbound URL** = `https://wa-bridge.yourcompany.com/crm/outbound`
- Allow attachments: on; maximum size 5 MB.

## How messages are mapped

**Incoming** — Meta's payload (abridged):

```json
{ "object": "whatsapp_business_account",
  "entry": [{ "changes": [{ "field": "messages", "value": {
    "metadata": { "phone_number_id": "106540352242922" },
    "contacts": [{ "profile": { "name": "Sheena Nelson" }, "wa_id": "16505551234" }],
    "messages": [{ "from": "16505551234", "id": "wamid.HBgL…", "timestamp": "1749416383",
                   "type": "text", "text": { "body": "Does it come in another color?" } }] } }] }] }
```

**What the bridge sends to the CRM:**

```json
{ "type": "message", "id": "wamid.HBgL…",
  "from": { "phone": "+16505551234", "name": "Sheena Nelson" },
  "timestamp": "2025-06-08T20:59:43.000Z",
  "text": "Does it come in another color?" }
```

| WhatsApp message type | CRM |
|---|---|
| `text`, `button`, `interactive` (button / list reply) | `text` |
| `image`, `document`, `audio`, `video`, `sticker` | Caption as `text`, plus an attachment. With `DOWNLOAD_MEDIA=1`, images and documents are fetched from Meta (`GET /{media-id}` → URL → download with the token) and stored in the CRM. Audio, video and anything else are listed by media id. |
| `location` | `location` |
| `context.id` (the customer quoted one of your messages) | `inReplyTo` |
| anything else (reactions, contact cards…) | `"[reaction message]"` as a readable trace (`messageType: OTHER`) |

**Contact matching:** the WhatsApp number is matched against contacts' phone, mobile and WhatsApp numbers (last 10 digits). Unknown numbers go to **Unmatched**.

**Delivery statuses:** Meta's `statuses[]` entries (`sent`, `delivered`, `read`, `failed`) are forwarded as CRM `status` events. `failed` includes Meta's error code and title.

**Outgoing** — the CRM's request to `/crm/outbound`:

```json
{ "id": "b2a8…", "to": { "kind": "PHONE", "value": "+16505551234" }, "text": "Yes — navy and maroon.",
  "inReplyTo": "wamid.HBgL…", "attachments": [] }
```

The bridge calls Meta:

```bash
POST https://graph.facebook.com/v25.0/<PHONE_NUMBER_ID>/messages
Authorization: Bearer <ACCESS_TOKEN>
{ "messaging_product": "whatsapp", "recipient_type": "individual", "to": "16505551234",
  "type": "text", "text": { "preview_url": false, "body": "Yes — navy and maroon." },
  "context": { "message_id": "wamid.HBgL…" } }
```

**Response and attachments:**

- The bridge answers the CRM with `{ "messageId": "<messages[0].id>" }`.
- Attachments are uploaded first (`POST /{phone-number-id}/media`), then sent as `image` or `document` messages.
- The first WhatsApp message id carries the delivery ticks.

## The 24-hour rule (important)

WhatsApp allows free-form replies only within **24 hours of the customer's last message**. After that, only pre-approved **template** messages can be sent.

**What happens outside the window:**

- Meta refuses (error 131047).
- The bridge answers the CRM `422`.
- The message shows **Failed** in the Inbox. The bridge logs: *"Outside the 24-hour customer service window — send an approved template."*

**What to do instead:** start conversations or re-engage with templates from WhatsApp Manager or your BSP tool. Template sending from the CRM is a planned extension.

## Testing without Meta

```bash
CRM_WEBHOOK_URL=… CRM_SIGNING_SECRET=… node send-test-message.mjs --phone "+91 98100 12345" --name "Test" --text "Hello on WhatsApp"
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| Meta says the callback URL couldn't be verified | `META_VERIFY_TOKEN` differs from the Meta setting, or the URL isn't public HTTPS |
| Bridge logs `401 bad signature` | Wrong `META_APP_SECRET`, or a proxy changed the body |
| Messages arrive but replies fail with 401 from Meta (shown as HTTP 422) | Access token expired — use a permanent system user token |
| Replies Failed after a day of silence | The 24-hour window — use a template |
| Ticks don't update | The **messages** webhook field isn't subscribed, or a different number's statuses are going elsewhere |
