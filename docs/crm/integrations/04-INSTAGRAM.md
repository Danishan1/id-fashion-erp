# Instagram Direct messages → CRM Inbox

Direct messages to your Instagram professional account arrive in the CRM Inbox. Your team replies from the CRM, and replies are delivered in Instagram.

Read [README.md](README.md) first, and [03-FACEBOOK-MESSENGER.md](03-FACEBOOK-MESSENGER.md) — Instagram works the same way and uses the same bridge: [`examples/meta-messenger-instagram-bridge.mjs`](examples/meta-messenger-instagram-bridge.mjs).

```
Customer ─► Instagram DM ─► Meta webhook (object "instagram") ─► bridge /meta/webhook ─signed─► CRM (Instagram channel)
Customer ◄─ Instagram DM ◄─ POST graph.instagram.com/me/messages ◄─ bridge /crm/outbound/instagram ◄─signed─ CRM
```

## What you need

- An Instagram **professional** account (Business or Creator).
- A Meta developer app with the **Instagram** product, using *Instagram API with Instagram Login*:
  - an **Instagram user access token** with `instagram_business_basic` and `instagram_business_manage_messages` (long-lived tokens last 60 days — refresh them before they expire);
  - the **App secret**.
- In the Instagram app on the phone: Settings → Messages and story replies → Message controls → **Allow access to messages** = on.
- The bridge (Node.js 18+) on a public HTTPS URL. If you already run it for Messenger, add the `IG_…` variables to the same process.

> As with Messenger, while the app is in development mode only accounts with a role on the app can test. Real customers need Advanced access (App Review) and a Live app.

## Step 1 — Create the CRM channel

1. CRM → Settings → Channels → **Add channel**.
2. Channel type **Instagram**, Name "Instagram DMs", Account "@indradhar.fashion".
3. Untick **Allow attachments** — the example bridge sends text replies only on Instagram.
4. Save. Copy the **Webhook URL** and the **Signing secret**.

## Step 2 — Run the bridge

```bash
export META_APP_SECRET="…"
export META_VERIFY_TOKEN="pick-any-long-random-string"
export IG_ACCESS_TOKEN="IGAA…"
export IG_CRM_WEBHOOK_URL="https://erp.yourcompany.com/api/v1/crm/webhooks/conversations/generic/<instagram channel id>"
export IG_CRM_SIGNING_SECRET="whsec_…"
export DOWNLOAD_MEDIA=1          # store photos customers send (optional)
PORT=8081 node meta-messenger-instagram-bridge.mjs
```

Each channel has its **own** webhook URL and signing secret. The bridge routes Meta's payload by its `object`: `"page"` → Messenger channel, `"instagram"` → Instagram channel.

## Step 3 — Point Meta's webhook to the bridge

1. Meta app → Instagram → **API setup with Instagram login** → Configure webhooks:
   - **Callback URL:** `https://meta-bridge.yourcompany.com/meta/webhook`
   - **Verify token:** the same value as `META_VERIFY_TOKEN`
2. Subscribe to the fields **`messages`** and **`messaging_seen`** (read receipts).
3. Under *Generate access tokens*, turn on webhook subscription for your Instagram account.

## Step 4 — Enable replies in the CRM

Edit the channel: **Outbound URL** = `https://meta-bridge.yourcompany.com/crm/outbound/instagram`.

## How messages are mapped

**Incoming** — Meta's payload (abridged):

```json
{ "object": "instagram",
  "entry": [{ "id": "<IG_ACCOUNT_ID>", "time": 1758000000000,
    "messaging": [{ "sender": { "id": "1789012345678901" }, "recipient": { "id": "<IG_ACCOUNT_ID>" },
                    "timestamp": 1758000000000,
                    "message": { "mid": "aWdfZAG1…", "text": "Price of the kurta in your last post?" } }] }] }
```

**What the bridge sends to the CRM:**

```json
{ "type": "message", "id": "aWdfZAG1…",
  "from": { "id": "1789012345678901" },
  "timestamp": "2025-09-16T05:20:00.000Z",
  "text": "Price of the kurta in your last post?" }
```

| Instagram event | CRM |
|---|---|
| `message.text` | `text` |
| `message.attachments[]` (image, video, audio, shares…) | Attachments; images are stored with `DOWNLOAD_MEDIA=1`, the rest listed by link |
| `message.reply_to.mid` | `inReplyTo` |
| `message.is_echo` / `is_deleted` | Ignored |
| `read.mid` (`messaging_seen`) | `status: read` for that message |

**Contact matching:** the customer is identified by an Instagram-scoped id (**IGSID**). Like Messenger, the first conversation goes to **Unmatched**; after your team links it to a contact once, later conversations from that IGSID match automatically.

**Outgoing** — the CRM's request to `/crm/outbound/instagram`:

```json
{ "id": "1f9a…", "to": { "kind": "PROVIDER_ID", "value": "1789012345678901" },
  "text": "It's ₹2,499 — sizes S to XXL.", "attachments": [] }
```

The bridge calls the Instagram API:

```bash
POST https://graph.instagram.com/v25.0/me/messages
Authorization: Bearer <IG_ACCESS_TOKEN>
Content-Type: application/json

{ "recipient": { "id": "1789012345678901" },
  "messaging_type": "RESPONSE",
  "message": { "text": "It's ₹2,499 — sizes S to XXL." } }
```

Meta answers with `message_id`, which the bridge returns to the CRM as `messageId`. When the customer opens it, the `messaging_seen` webhook marks it **Read**.

## Instagram rules

- **24-hour window:** free-form replies only within 24 hours of the customer's last message. Outside it Meta refuses (subcode 1545041) and the message shows **Failed** — *"More than 24 hours since the customer's last message."*
- **Text length:** Instagram text messages are limited to 1,000 bytes (UTF-8). Keep replies short; emoji and Indian-language characters count as 3–4 bytes each.
- **Attachments:** not sent by this example. To add images, upload the file to a public HTTPS URL and send `message: { attachment: { type: "image", payload: { url } } }`, then turn attachments on for the channel.

## Testing without Meta

```bash
CRM_WEBHOOK_URL="<Instagram channel webhook URL>" CRM_SIGNING_SECRET="<its secret>" \
  node send-test-message.mjs --id 1789012345678901 --text "Hello from Instagram"
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| Messenger works, Instagram doesn't arrive | Instagram webhook not configured in the Instagram product, `messages` not subscribed, or "Allow access to messages" is off in the Instagram app |
| Bridge answers `{ "ignored": "instagram" }` | `IG_CRM_WEBHOOK_URL` isn't set in the bridge |
| Replies fail with 190 / OAuth errors | Instagram token expired (60 days) — refresh it |
| Replies fail with "text too long" | Over 1,000 bytes |
| Replies with a file fail with 422 | Attachments still on for the channel — turn them off |
