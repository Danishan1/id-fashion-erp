# CRM Channel Integration Guide

How to connect a communication channel — website chat, WhatsApp, Facebook Messenger, Instagram, SMS, email or any other system — to the **Fashion ERP CRM Inbox**, for both **incoming** messages (customer → CRM) and **outgoing** replies (CRM → customer).

Who this is for:

- **CRM admins** create the channel in CRM Settings.
- **Developers** connect the provider, using the steps and runnable examples in this folder.

| Guide | Channel | Example bridge |
|---|---|---|
| [01-WEBSITE-CHAT.md](01-WEBSITE-CHAT.md) | Your website's chat box | `examples/website-chat-bridge.mjs` |
| [02-WHATSAPP.md](02-WHATSAPP.md) | WhatsApp Business Platform (Meta Cloud API) | `examples/whatsapp-cloud-bridge.mjs` |
| [03-FACEBOOK-MESSENGER.md](03-FACEBOOK-MESSENGER.md) | Facebook Page messages | `examples/meta-messenger-instagram-bridge.mjs` |
| [04-INSTAGRAM.md](04-INSTAGRAM.md) | Instagram Direct messages | `examples/meta-messenger-instagram-bridge.mjs` |
| [05-SMS.md](05-SMS.md) | SMS / MMS (Twilio; notes for other gateways) | `examples/sms-twilio-bridge.mjs` |
| [06-EMAIL.md](06-EMAIL.md) | Email (Mailgun; notes for other providers) | `examples/email-mailgun-bridge.mjs` |
| [07-OTHER-SYSTEMS.md](07-OTHER-SYSTEMS.md) | Telegram (worked example), your own system, n8n / Make / Zapier, other gateways | `examples/telegram-bridge.mjs`, `examples/inhouse_bridge.py` |

---

## 1. How it works

The CRM speaks **one** provider-neutral protocol for every channel: signed JSON over HTTPS. A small service you run — a **bridge** — translates between that protocol and your provider (Meta, Twilio, Mailgun, your chat backend…).

```
                 INBOUND (customer → CRM)                                   OUTBOUND (CRM → customer)

 Customer ──► Provider ──webhook──► Bridge ──signed POST──► CRM channel        CRM user clicks Send
                                    (verify provider,       webhook URL             │
                                     translate, sign)           │              CRM checks permissions,
                                                                ▼              capabilities and DND
                                                          Inbox conversation        │
                                                                                    ▼
 Customer ◄── Provider ◄──send API── Bridge ◄──signed POST── CRM ─── your channel's "Outbound URL"
                 │                   (verify CRM,
                 │                    call provider,
                 └──status webhook──► Bridge ──signed POST──► CRM  (sent / delivered / read / failed)
```

**Why a bridge?**

- Every provider authenticates and formats data differently. The CRM stays the same for all of them, and your provider credentials stay in your bridge — never in the CRM or the browser.
- Adding a channel never changes the CRM.

**What the CRM does for you:**

- de-duplicates messages;
- matches senders to contacts;
- runs the unmatched queue;
- handles assignment, notifications, internal notes and tasks;
- enforces DND / opt-outs;
- keeps conversation history, timelines and automation events.

**What the bridge does:**

1. Verifies the provider's webhook signature.
2. Converts the provider's payload to CRM events, and sends them signed.
3. Receives CRM replies, verifies the CRM's signature, and calls the provider's send API.
4. Forwards delivery receipts.

> **Already have a bridge?** A built-in provider can later replace the bridge for a given channel, with no change to conversations, inbox or history.

---

## 2. Step-by-step setup (every channel)

**Step 1 — Create the channel (CRM admin)**

1. Open CRM → Settings → **Channels** → **Add channel**.
2. Choose the **channel type** (Email, SMS, WhatsApp, Facebook Messenger, Instagram, Website chat, Other).
3. Give it a **name** (e.g. "Sales WhatsApp").
4. Optionally add the **business number / address**, for display.
5. Optionally choose who receives **new conversations**. Otherwise they stay unassigned, and only managers (crm.view_all) see unmatched ones.
6. Leave **Outbound URL** empty for now, or enter it if the bridge is already running.
7. Save.

The CRM then shows the following. **Copy them now.**

| Value | Example |
|---|---|
| **Webhook URL** | `https://erp.yourcompany.com/api/v1/crm/webhooks/conversations/generic/6f1c2f1e-…` |
| **Signing secret** | `whsec_Vb1…` — shown **once**. If lost, use **New secret** (the old one stops working immediately). |

**Step 2 — Run a bridge (developer)**

1. Pick the example for your channel from `examples/`. You need Node.js 18 or newer (or Python 3.9+ for `inhouse_bridge.py`); there are no packages to install.
2. Configure it with the webhook URL and secret (environment variables `CRM_WEBHOOK_URL`, `CRM_SIGNING_SECRET`) plus your provider credentials.
3. Host it at a public **HTTPS** address. Your provider must be able to reach it, and so must the ERP server, for replies.

**Step 3 — Connect the provider**

Point the provider's webhook (incoming messages and delivery statuses) to the bridge. Each channel guide shows exactly where.

**Step 4 — Enable replies**

1. In CRM Settings → Channels → Edit, set **Outbound URL** to the bridge's outbound route (e.g. `https://bridge.yourcompany.com/crm/outbound`).
2. Optionally allow attachments and set the size limit.
3. Without an outbound URL, the channel is **receive-only** and the Inbox explains that replies aren't set up.

**Step 5 — Test**

1. Send a test message, either from a real phone or account, or without any provider:
   ```bash
   CRM_WEBHOOK_URL=… CRM_SIGNING_SECRET=… node examples/send-test-message.mjs --phone "+91 98765 43210" --name "Asha Rao" --text "Hi, do you have polo shirts?"
   ```
2. Open CRM → **Inbox**, open the conversation and reply. The reply should reach the customer and show **Sent → Delivered**.
3. Go through the go-live checklist in §10.

---

## 3. Inbound API — sending messages to the CRM

```
POST <channel webhook URL>
Content-Type: application/json
X-CRM-Timestamp: <unix time in seconds>
X-CRM-Signature: sha256=<hex HMAC-SHA256(signing secret, "<timestamp>.<raw body>")>
```

### 3.1 Signing

Sign the **exact bytes** you send (`<timestamp>.<raw body>`), using the channel's signing secret. Requests whose timestamp is more than **5 minutes** from the CRM's clock are rejected (replay protection), so sign at send time and keep your server clock in sync (NTP).

<details><summary>Node.js</summary>

```js
import { createHmac } from "node:crypto";
const body = JSON.stringify(payload);
const ts = Math.floor(Date.now() / 1000);
const sig = `sha256=${createHmac("sha256", process.env.CRM_SIGNING_SECRET).update(`${ts}.${body}`).digest("hex")}`;
await fetch(process.env.CRM_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json", "X-CRM-Timestamp": String(ts), "X-CRM-Signature": sig }, body });
```
</details>

<details><summary>Python</summary>

```python
import hmac, hashlib, json, time, os, requests
body = json.dumps(payload, separators=(",", ":"))
ts = str(int(time.time()))
sig = "sha256=" + hmac.new(os.environ["CRM_SIGNING_SECRET"].encode(), f"{ts}.{body}".encode(), hashlib.sha256).hexdigest()
requests.post(os.environ["CRM_WEBHOOK_URL"], data=body.encode(), headers={"Content-Type": "application/json", "X-CRM-Timestamp": ts, "X-CRM-Signature": sig}, timeout=30)
```
</details>

<details><summary>PHP</summary>

```php
$body = json_encode($payload);
$ts = (string) time();
$sig = 'sha256=' . hash_hmac('sha256', $ts . '.' . $body, getenv('CRM_SIGNING_SECRET'));
$ch = curl_init(getenv('CRM_WEBHOOK_URL'));
curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => ['Content-Type: application/json', "X-CRM-Timestamp: $ts", "X-CRM-Signature: $sig"]]);
$response = curl_exec($ch);
```
</details>

<details><summary>Shell (curl + openssl)</summary>

```bash
BODY='{"type":"message","id":"msg-1001","from":{"phone":"+91 98765 43210","name":"Asha Rao"},"text":"Hi, can you share the catalogue?"}'
TS=$(date +%s)
SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$CRM_SIGNING_SECRET" | sed 's/^.* //')
curl -X POST "$CRM_WEBHOOK_URL" -H "Content-Type: application/json" -H "X-CRM-Timestamp: $TS" -H "X-CRM-Signature: sha256=$SIG" -d "$BODY"
```
</details>

All four produce the same signature for the same body, timestamp and secret.

### 3.2 Body

The body is either **one event**, or `{ "events": [ … ] }` with up to **50 events** (processed in order). There are two event types.

**`message`** — a message from the customer:

| Field | Required | Notes |
|---|---|---|
| `type` | yes | `"message"` |
| `id` | yes | **Your provider's unique message id** (≤ 200 chars). It is the idempotency key: the same id on the same channel is stored once. Never generate a new id when retrying. |
| `from` | yes | Who sent it. Any of `email`, `phone`, `id` (provider user id), `sessionId` (anonymous web chat), plus optional `name`. Which one is required depends on the channel type — see §5. |
| `text` | see note | Message text (≤ 20,000 chars). A message needs `text`, an attachment or a `location`. |
| `timestamp` | no | ISO-8601 with time zone (`2026-10-08T10:42:00Z`). When the customer sent it; defaults to now. |
| `subject` | no | Email subject (≤ 300). Also becomes the conversation subject. |
| `threadId` | no | The provider's thread / conversation reference (≤ 300). When given, messages with the same `threadId` go to the same conversation (email chains, chat sessions). Without it, the CRM uses the customer's latest open conversation on this channel. |
| `inReplyTo`, `references` | no | Email threading headers (message ids), kept for reference. |
| `attachments` | no | Up to 10: `{ fileName, mimeType, contentBase64 }` to store the file in the CRM, **or** `{ fileName, mimeType, mediaId }` to list a file kept by the provider. `size` (bytes) is optional. |
| `location` | no | `{ latitude, longitude, name? }` |
| `messageType` | no | `TEXT`, `IMAGE`, `FILE`, `AUDIO`, `VIDEO`, `DOCUMENT`, `LOCATION`, `SYSTEM`, `OTHER` — inferred when omitted. |

**`status`** — a delivery receipt for a reply the CRM sent:

| Field | Required | Notes |
|---|---|---|
| `type` | yes | `"status"` |
| `messageId` | yes | The provider message id your outbound route returned to the CRM (see §4). |
| `status` | yes | `sent`, `delivered`, `read` or `failed` (case-insensitive). |
| `timestamp` | no | ISO-8601. |
| `error` | no | Short reason for `failed` (≤ 300), shown to CRM users. **Never put tokens or raw provider responses here.** |

Example with a batch:

```json
{
  "events": [
    { "type": "message", "id": "wamid.HBgL…", "from": { "phone": "+91 98100 12345", "name": "Rahul Sharma" },
      "text": "Can you send the revised quotation?", "timestamp": "2026-10-08T05:12:00Z" },
    { "type": "message", "id": "wamid.HBgM…", "from": { "phone": "+91 98100 12345" },
      "attachments": [ { "fileName": "swatch.jpg", "mimeType": "image/jpeg", "contentBase64": "/9j/4AAQ…" } ] },
    { "type": "status", "messageId": "wamid.OUT…", "status": "delivered" }
  ]
}
```

### 3.3 Files

**Stored in the CRM:** files sent with `contentBase64` whose type the ERP file store accepts:

- JPEG, PNG, WebP;
- PDF;
- Word / Excel (.doc, .docx, .xls, .xlsx);
- CSV.

The file content is checked against its declared type (magic bytes). The limit is 20 MB per file, and the whole request is limited to 12 MB, so keep inline files to a few MB.

**Listed but not stored:** other types (audio, video, zip…) and `mediaId` references appear in the thread as "*file name — not stored in the CRM*". Download such files from your provider if you need them.

### 3.4 Responses

**`200`** — the body tells you what happened to each event:

```json
{ "data": { "received": 2, "results": [
  { "type": "message", "id": "wamid.HBgL…", "outcome": "created", "messageId": "…", "conversationId": "…", "conversationCreated": true },
  { "type": "status", "id": "wamid.OUT…", "status": "DELIVERED", "outcome": "applied", "messageId": "…" }
] } }
```

**Message outcomes:**

| Outcome | Meaning |
|---|---|
| `created` | Stored. |
| `duplicate` | The id was already stored — safe; treat it as success. |
| `rejected` | The sender's identity was unusable, e.g. a phone number with fewer than 7 digits. `reason` says why. |

**Status outcomes:**

| Outcome | Meaning |
|---|---|
| `applied` | The receipt was recorded. |
| `ignored` | Old or out-of-order receipt; statuses only move forward. |
| `unknown_message` | The CRM hasn't recorded that provider id yet — usually because the receipt raced ahead of the send result. Retry it after a few seconds; the example kit does this. |

| HTTP | Meaning | Retry? |
|---|---|---|
| `200` | Accepted (see the outcomes above) | — |
| `400 VALIDATION_ERROR` | The body doesn't match the format (the message says which event and field) | No — fix the payload |
| `401 INVALID_WEBHOOK_SIGNATURE` | Wrong secret, body changed after signing, or clock off by more than 5 minutes | No — fix signing or the clock |
| `404` | Unknown channel URL | No |
| `413 PAYLOAD_TOO_LARGE` | Body over 12 MB | No — send fewer or smaller files |
| `429 RATE_LIMITED` | More than 600 requests per minute for this channel | Yes, with backoff |
| `503 CHANNEL_PAUSED` | An admin paused the channel; there is a `Retry-After` header | Yes, later |
| `5xx` | Temporary problem | Yes, with backoff |

**Retrying is always safe:** the CRM stores each `id` once. If your provider retries webhooks (Meta, Twilio, Mailgun do), let it — answer the provider with an error when the CRM call fails, and the provider re-delivers later.

---

## 4. Outbound API — what the CRM sends to your bridge

When a CRM user replies, the CRM POSTs to the channel's **Outbound URL**:

```
POST <your outbound URL>
Content-Type: application/json
X-CRM-Timestamp: <unix seconds>
X-CRM-Signature: sha256=<hex HMAC-SHA256(signing secret, "<timestamp>.<raw body>")>
X-CRM-Idempotency-Key: <CRM message id>
```

```json
{
  "id": "b2a8671e-507d-4833-a97a-16989ba88ece",
  "channelId": "6f1c2f1e-…",
  "conversationId": "8a77…",
  "threadId": "root-message-id@client.example.com",
  "to": { "kind": "PHONE", "value": "+91 98100 12345" },
  "subject": null,
  "text": "Yes — navy and maroon are available.",
  "inReplyTo": "wamid.HBgL…",
  "attachments": [ { "fileName": "catalogue.pdf", "mimeType": "application/pdf", "contentBase64": "JVBERi0x…" } ]
}
```

| Field | Notes |
|---|---|
| `id` | The CRM message id. It is the same as `X-CRM-Idempotency-Key`. |
| `to.kind` / `to.value` | Where to send. `kind` is `EMAIL`, `PHONE`, `PROVIDER_ID` (PSID / IGSID / user id) or `SESSION` (web chat), and is the identity the customer wrote from. |
| `text` | The message, already within the channel's limit (SMS 1,600 characters; others 10,000). Can be empty when only files are sent. |
| `subject` | Email channels only. |
| `threadId` | The conversation's `threadId` from inbound messages (e.g. the email root Message-ID), or null. |
| `inReplyTo` | The provider id of the customer's latest message — use it for quoted replies (WhatsApp `context`) or email `In-Reply-To`. |
| `attachments` | Only when the channel allows attachments: images and documents, up to 5 files and the channel's MB limit, base64. |
| `template` | Only when the reply was written from a CRM message template (Phase 12): `{ templateId, versionId, versionNumber, name, providerMetadata, parameters: [{ key, value }] }`. `text` is always the final text to send. `providerMetadata` holds the template's provider settings (e.g. `externalTemplateName`, `language` for WhatsApp templates approved by your provider) and `parameters` the variable values in order of first use — map them onto your provider's approved-template call if it needs one (e.g. outside WhatsApp's 24-hour window). `parameters` is empty when the user edited the text before sending. |
| `test` | `true` only for a **template test send** from CRM → Templates: one message to an address a user typed (marked "[TEST]"), not a customer conversation. Deliver it like any other message; the CRM doesn't expect delivery receipts for it. |

**Your bridge must:**

1. **Verify the signature and timestamp**, exactly as in §3.1, using the same secret. Reject anything else with `401`.
2. **De-duplicate by `X-CRM-Idempotency-Key`.** The CRM sends a message once, but a user's **Retry** of a failed send re-uses the same key. If you already sent that key successfully, return the same answer without sending again.
3. **Call the provider** and answer within **15 seconds**:

| You answer | The CRM shows |
|---|---|
| `2xx` `{ "messageId": "<provider message id>" }` (optional `"status": "delivered"` or `"read"`) | **Sent** (or Delivered / Read). Keep the `messageId`: delivery receipts refer to it. |
| `429` or `5xx`, or no answer within 15 s | **Failed** — "temporary"; the user can **Retry** |
| other `4xx` (e.g. outside WhatsApp's 24-hour window, invalid number) | **Failed** — the user sees "The provider rejected the message (HTTP 4xx)" |

**Rules for the outbound URL:**

- The CRM follows no redirects.
- It never shows your response body to users. Log details on your side.
- It must be `https://` in production (http is allowed only in local development), with no user name or password in the URL — requests are signed instead.

A message stuck in "Sending…" for 10 minutes (e.g. the ERP restarted mid-send) is marked **Failed — may or may not have been delivered**. It is never resent automatically.

**Delivery receipts:** when your provider reports `sent`, `delivered`, `read` or `failed` for a message, send a `status` event (§3.2) with `messageId` = the id you returned. Statuses only move forward (Sent → Delivered → Read). Only statuses your provider actually reports are shown.

---

## 5. Identities and contact matching

What you put in `from` decides which conversation a message joins, and which contact it is linked to.

| Channel type | Identity used (in order) | Contact matching |
|---|---|---|
| Email | `from.email` | The contact's email (main, alternate and extra email channels) |
| SMS, WhatsApp | `from.phone` | The contact's phone, mobile or WhatsApp number, compared on the last 10 digits — send full international numbers, e.g. `+919810012345` |
| Facebook Messenger, Instagram | `from.id` (PSID / IGSID) | No automatic match the first time. Once a user links the conversation to a contact, later conversations from that id match automatically. |
| Website chat | `from.sessionId`, then `id`, `email`, `phone` | A visitor who typed an email or phone (send it too) is matched by it. Otherwise the chat is anonymous and goes to the unmatched queue. |
| Other | `from.id`, then `email`, `phone`, `sessionId` | As above |

**What happens after matching:**

| Result | What the CRM does |
|---|---|
| Exactly one contact matches | The conversation is linked to the contact, the contact's company and the contact's only open opportunity (if there is exactly one). |
| Several contacts match | The conversation shows **Several possible contacts**; a user picks one. |
| No contact matches | The conversation goes to **Unmatched**. A user links an existing contact or creates one, and the CRM's duplicate rules apply. **No contact is ever created automatically.** |

---

## 6. DND / opt-outs

The CRM refuses to send when the linked contact has opted out. The Inbox shows a warning; the API answers `422 CRM_CONTACT_NOT_CONTACTABLE`, so **your bridge is never called**.

| Channel | Contact setting that applies |
|---|---|
| Email | Contactability → Email |
| SMS | Contactability → SMS |
| WhatsApp | Contactability → WhatsApp |
| Messenger, Instagram, website chat, other | Contactability → All channels |

If a customer opts out through the provider (e.g. replies STOP to an SMS), record it on the contact: Contact → Contactability. The provider-side opt-out also still applies.

---

## 7. Security checklist

- **Secrets:**
  - Keep the CRM signing secret and the provider credentials only on the bridge server (environment variables or a secret manager).
  - Never put them in a browser, a mobile app or a log.
  - Rotate the CRM secret with **New secret** if it leaks; the old one stops working immediately.
- **Verify every request:**
  - provider → bridge: Meta `X-Hub-Signature-256`, `X-Twilio-Signature`, Mailgun signature;
  - CRM → bridge: `X-CRM-Signature` plus a timestamp within 5 minutes.
- **HTTPS everywhere:** the CRM requires it for the outbound URL in production.
- **Website chat:** the browser talks to your bridge, never to the CRM. Validate and rate-limit visitor input.
- **Error messages:** the reasons you send in `error` and in failed responses must be plain text without tokens, URLs with credentials, or stack traces.

---

## 8. Running bridges in production

- **Process:** run each bridge under a supervisor (systemd, PM2, Docker, Kubernetes) behind HTTPS (nginx, Caddy, a cloud load balancer).
- **Idempotency store:** the examples keep idempotency keys and web-chat replies **in memory**. For more than one instance, or to survive restarts, move them to Redis or a database table.
- **Monitoring:** log the provider ids, CRM outcomes and errors, and alert on repeated `4xx` from the CRM — usually a signature, secret or format problem.
- **Keys:** one bridge process can serve several channels, but each channel has its own webhook URL and secret. See the Messenger / Instagram example.

---

## 9. Troubleshooting

| Symptom | Check |
|---|---|
| `401` from the CRM | The secret matches the channel? It wasn't rotated? You signed the exact body you sent (no re-serialisation after signing)? Server clock in sync? |
| `400 … from: needs phone` | Each channel type needs its identity — WhatsApp / SMS need `from.phone`, email needs `from.email` (§5). |
| Message in the Inbox but not linked to the contact | The contact's number / email is different (check the last 10 digits). Messenger / Instagram need one manual link first. |
| Reply stays Failed with HTTP 401 | Your bridge rejected the CRM's signature: wrong secret configured in the bridge, or clock drift. |
| Reply Failed "did not answer in time" | Your outbound route must answer within 15 s. Call the provider and answer; don't wait for delivery. |
| Status stays Sent | Receipts must use the **same id** your outbound route returned. Check the provider is configured to send status webhooks. |
| `503 CHANNEL_PAUSED` | The channel is paused in CRM Settings → Channels. |
| Replies say "Replies are not set up for this channel" | Set the Outbound URL on the channel. |
| Reply button disabled with an opt-out warning | The contact opted out (§6). |

---

## 10. Go-live checklist

- [ ] Channel created; webhook URL and secret stored on the bridge server.
- [ ] Provider webhook points to the bridge and passes its signature check.
- [ ] Test message appears in the Inbox and is linked to the right contact.
- [ ] Outbound URL set (https); a reply reaches the customer and shows Delivered.
- [ ] Re-sending the same provider webhook does not create a second message.
- [ ] A failed send (e.g. an invalid number) shows Failed, and Retry does not double-send.
- [ ] Default assignee set (or a manager watches **Unassigned** / **Unmatched**).
- [ ] Bridge runs under a supervisor with HTTPS, logs and alerts.

Running the examples' verification: every example in `examples/` was run against the CRM with mock provider APIs. That covered signature checks, inbound mapping, contact matching, replies, attachments, receipts, threading and duplicate deliveries.
