# Facebook Messenger (Facebook Page messages) → CRM Inbox

Messages sent to your Facebook Page arrive in the CRM Inbox. Your team replies from the CRM, and replies are delivered in Messenger.

Read [README.md](README.md) first. Example: [`examples/meta-messenger-instagram-bridge.mjs`](examples/meta-messenger-instagram-bridge.mjs) — one process serves both Messenger and Instagram ([04-INSTAGRAM.md](04-INSTAGRAM.md)).

```
Customer ─► Messenger ─► Meta webhook (X-Hub-Signature-256) ─► bridge /meta/webhook ─signed─► CRM (Messenger channel)
Customer ◄─ Messenger ◄─ POST /me/messages (Page token) ◄─ bridge /crm/outbound/messenger ◄─signed─ CRM
```

## What you need

- A Facebook **Page** and a Meta developer app (type *Business*) with the **Messenger** product added.
- From the app:
  - the **App secret** (App settings → Basic);
  - a **Page access token** for the Page (Messenger → Settings → Access tokens → *Generate*), with `pages_messaging` permission. Use a long-lived token from a system user in production.
- The bridge (Node.js 18+) on a public HTTPS URL.

> **Development vs live:** while the Meta app is in development mode, only people with a role on the app (admins, developers, testers) can message the Page and get replies through it. To serve real customers, the app needs **Advanced access** to `pages_messaging` (App Review) and must be switched to **Live**.

## Step 1 — Create the CRM channel

1. CRM → Settings → Channels → **Add channel**.
2. Channel type **Facebook Messenger**, Name "Facebook Page", Account "Indradhar Fashion (Page)".
3. Choose who receives new conversations.
4. Save. Copy the **Webhook URL** and the **Signing secret**.

## Step 2 — Run the bridge

```bash
cd docs/crm/integrations/examples
export META_APP_SECRET="…"
export META_VERIFY_TOKEN="pick-any-long-random-string"
export FB_PAGE_ACCESS_TOKEN="EAAG…"
export FB_CRM_WEBHOOK_URL="https://erp.yourcompany.com/api/v1/crm/webhooks/conversations/generic/<channel id>"
export FB_CRM_SIGNING_SECRET="whsec_…"
export DOWNLOAD_MEDIA=1          # store customers' photos in the CRM (optional)
PORT=8081 node meta-messenger-instagram-bridge.mjs
```

Leave the `IG_…` variables empty if you don't use Instagram — that part is then switched off.

## Step 3 — Point Meta's webhook to the bridge

1. Meta app → Messenger → **Settings** → Webhooks:
   - **Callback URL:** `https://meta-bridge.yourcompany.com/meta/webhook`
   - **Verify token:** the same value as `META_VERIFY_TOKEN`
2. Meta calls `GET /meta/webhook?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…`. The bridge echoes `hub.challenge` when the token matches.
3. Under the Page, **Add subscriptions**: `messages`, `messaging_postbacks`, `message_deliveries`. (`message_echoes` and `message_reads` are optional — the bridge ignores echoes, and Messenger read receipts carry only a time, not a message id, so they are not forwarded.)

The same subscription can be made by API:

```bash
curl -X POST "https://graph.facebook.com/v25.0/<PAGE_ID>/subscribed_apps?subscribed_fields=messages,messaging_postbacks,message_deliveries&access_token=<PAGE_ACCESS_TOKEN>"
```

## Step 4 — Enable replies in the CRM

Edit the channel:

- **Outbound URL** = `https://meta-bridge.yourcompany.com/crm/outbound/messenger`
- Allow attachments: on (images and files are sent as Messenger attachments); maximum size 8 MB.

## How messages are mapped

**Incoming** — Meta's payload (abridged):

```json
{ "object": "page",
  "entry": [{ "id": "<PAGE_ID>", "time": 1758000000000,
    "messaging": [{ "sender": { "id": "6912345678901234" }, "recipient": { "id": "<PAGE_ID>" },
                    "timestamp": 1758000000000,
                    "message": { "mid": "m_AbC123…", "text": "Is the linen shirt available in XL?" } }] }] }
```

**What the bridge sends to the CRM:**

```json
{ "type": "message", "id": "m_AbC123…",
  "from": { "id": "6912345678901234" },
  "timestamp": "2025-09-16T05:20:00.000Z",
  "text": "Is the linen shirt available in XL?" }
```

| Messenger event | CRM |
|---|---|
| `message.text` | `text` |
| `message.quick_reply` | The quick reply's payload as `text` (when there is no text) |
| `message.attachments[]` (`image`, `video`, `audio`, `file`) | Attachments. With `DOWNLOAD_MEDIA=1`, images and files are downloaded from `payload.url` and stored when the type is allowed (jpeg/png/webp/pdf/office); others are listed by link as "not stored". |
| `message.reply_to.mid` | `inReplyTo` |
| `postback` (a button the customer tapped) | A message whose text is the button title |
| `message.is_echo` (your own sends) | Ignored — the CRM already has them |
| `delivery.mids[]` | `status: delivered` for each message id |

**Contact matching:** Messenger identifies the customer only by a Page-scoped id (**PSID**); no phone or email is sent. The first conversation from a PSID goes to **Unmatched**. Your team uses **Link existing contact** (or **Create contact**) once; after that, every new conversation from that PSID is matched automatically.

> Want the customer's name on unmatched conversations? Extend `toCrmEvents()` to call `GET https://graph.facebook.com/v25.0/<PSID>?fields=first_name,last_name&access_token=<PAGE_TOKEN>` and put the result in `from.name` (cache it per PSID).

**Outgoing** — the CRM's request to `/crm/outbound/messenger`:

```json
{ "id": "7c1e…", "to": { "kind": "PROVIDER_ID", "value": "6912345678901234" },
  "text": "Yes, XL is in stock. Shall I reserve one?", "attachments": [] }
```

The bridge calls Meta's Send API:

```bash
POST https://graph.facebook.com/v25.0/me/messages?access_token=<PAGE_ACCESS_TOKEN>
Content-Type: application/json

{ "recipient": { "id": "6912345678901234" },
  "messaging_type": "RESPONSE",
  "message": { "text": "Yes, XL is in stock. Shall I reserve one?" } }
```

Meta answers `{ "recipient_id": "6912345678901234", "message_id": "m_XyZ…" }`. The bridge returns `{ "messageId": "m_XyZ…" }` to the CRM, and later `delivery` webhooks for that id update the tick to **Delivered**.

**Attachments** are sent one per message as a multipart upload:

```bash
curl -X POST "https://graph.facebook.com/v25.0/me/messages?access_token=<PAGE_ACCESS_TOKEN>" \
  -F 'recipient={"id":"6912345678901234"}' \
  -F 'messaging_type=RESPONSE' \
  -F 'message={"attachment":{"type":"image","payload":{"is_reusable":false}}}' \
  -F 'filedata=@catalogue.png;type=image/png'
```

## The 24-hour rule

The Page may reply freely for **24 hours after the customer's last message**. After that Meta refuses the send (error subcode **1545041**). The bridge answers the CRM `422` and the message shows **Failed** with *"More than 24 hours since the customer's last message."*

Sending outside the window requires a Meta **message tag** (for example `HUMAN_AGENT`, which allows 7 days and needs Meta's approval). Message tags are not sent by this example; add `"messaging_type": "MESSAGE_TAG", "tag": "HUMAN_AGENT"` in `deliverFor()` only once your app is approved for it.

## Testing without Meta

```bash
CRM_WEBHOOK_URL="<Messenger channel webhook URL>" CRM_SIGNING_SECRET="<its secret>" \
  node send-test-message.mjs --id 6912345678901234 --text "Hello from Messenger"
```

The conversation appears under **Unmatched**. Link it to a contact, send a second test message with the same `--id`, and it is matched automatically.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "The URL couldn't be validated" in Meta | `META_VERIFY_TOKEN` differs, or the bridge URL isn't public HTTPS |
| Bridge logs `401 bad signature` | Wrong `META_APP_SECRET` (it's the app's secret, not the Page token), or a proxy changed the body |
| Webhook works for you but not for customers | App still in development mode, or `pages_messaging` lacks Advanced access |
| Nothing arrives at all | The Page isn't subscribed to the app (`subscribed_apps`), or the `messages` field isn't ticked |
| Replies fail with "(#190) …" | Page token expired or revoked — generate a long-lived token |
| Replies fail after a day | The 24-hour window (see above) |
