# SMS (Twilio) → CRM Inbox

Text messages to your business number arrive in the CRM Inbox. Your team replies from the CRM, and replies go out as SMS with Sent / Delivered / Failed status.

Read [README.md](README.md) first. Example: [`examples/sms-twilio-bridge.mjs`](examples/sms-twilio-bridge.mjs). Using an Indian gateway (MSG91, Gupshup, Kaleyra…) instead? See [Other SMS gateways](#other-sms-gateways) at the end.

```
Customer ─SMS─► Twilio ─"A message comes in" webhook (X-Twilio-Signature)─► bridge /twilio/inbound ─signed─► CRM
Customer ◄SMS── Twilio ◄─ POST /Accounts/{SID}/Messages.json ◄─ bridge /crm/outbound ◄─signed─ CRM
                Twilio ─status callback─► bridge /twilio/status ─► CRM (Sent / Delivered / Failed)
```

## What you need

- A Twilio account with an SMS-capable **phone number** (or a **Messaging Service**).
- The **Account SID** and **Auth Token** (Twilio Console → Account Info). The Auth Token also signs Twilio's webhooks.
- The bridge (Node.js 18+) on a public HTTPS URL.

> **India:** sending SMS to Indian numbers requires DLT registration (entity, sender ID/header and content templates) — set this up with Twilio or your gateway before go-live. Free-form agent replies may be blocked by operators unless they match a registered template.

## Step 1 — Create the CRM channel

1. CRM → Settings → Channels → **Add channel**.
2. Channel type **SMS**, Name "Sales SMS", Business number "+1 501 712 2661".
3. Choose who receives new conversations.
4. **Attachments:** MMS (pictures) works only on US and Canadian numbers. For Indian SMS, untick attachments.
5. Save. Copy the **Webhook URL** and the **Signing secret**.

## Step 2 — Run the bridge

```bash
cd docs/crm/integrations/examples
export PUBLIC_BASE_URL="https://sms-bridge.yourcompany.com"   # exactly what Twilio calls — used for signature checks
export CRM_WEBHOOK_URL="https://erp.yourcompany.com/api/v1/crm/webhooks/conversations/generic/<channel id>"
export CRM_SIGNING_SECRET="whsec_…"
export TWILIO_ACCOUNT_SID="AC…"
export TWILIO_AUTH_TOKEN="…"
export TWILIO_FROM="+15017122661"            # or: export TWILIO_MESSAGING_SERVICE_SID="MG…"
export DOWNLOAD_MEDIA=1                       # store MMS pictures in the CRM (optional)
PORT=8082 node sms-twilio-bridge.mjs
```

## Step 3 — Point Twilio to the bridge

Twilio Console → Phone Numbers → Manage → Active numbers → *your number* → **Messaging configuration**:

- **A message comes in:** Webhook, `https://sms-bridge.yourcompany.com/twilio/inbound`, **HTTP POST**.

(With a Messaging Service, set the same URL under the service's **Integration** → *Send a webhook*.)

You don't configure the status callback in the Console — the bridge sets `StatusCallback` on every message it sends.

## Step 4 — Enable replies in the CRM

Edit the channel: **Outbound URL** = `https://sms-bridge.yourcompany.com/crm/outbound`.

## How messages are mapped

**Incoming** — Twilio posts a form (`application/x-www-form-urlencoded`):

```
MessageSid=SM1f0e…&AccountSid=AC…&From=%2B919810012345&To=%2B15017122661&Body=Is+my+order+shipped%3F&NumMedia=0
```

The bridge checks `X-Twilio-Signature` (HMAC-SHA1 of the URL plus the sorted form fields, keyed with your Auth Token), then sends:

```json
{ "type": "message", "id": "SM1f0e…",
  "from": { "phone": "+919810012345" },
  "text": "Is my order shipped?" }
```

and answers Twilio with an empty TwiML `<Response></Response>` (no automatic reply).

| Twilio field | CRM |
|---|---|
| `MessageSid` | `id` (Twilio retries are de-duplicated) |
| `From` | `from.phone` → matched against contacts' phone / mobile / WhatsApp (last 10 digits) |
| `Body` | `text` |
| `MediaUrl0…N`, `MediaContentType0…N` | Attachments. With `DOWNLOAD_MEDIA=1` they are downloaded (with your Twilio credentials) and stored; otherwise listed by URL. |

**Outgoing** — the CRM's request to `/crm/outbound`:

```json
{ "id": "3d7b…", "to": { "kind": "PHONE", "value": "+919810012345" },
  "text": "Yes — shipped today, AWB 1234567890.", "attachments": [] }
```

The bridge calls Twilio:

```bash
curl -X POST "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/Messages.json" \
  -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
  --data-urlencode "To=+919810012345" \
  --data-urlencode "From=+15017122661" \
  --data-urlencode "Body=Yes — shipped today, AWB 1234567890." \
  --data-urlencode "StatusCallback=https://sms-bridge.yourcompany.com/twilio/status"
```

Twilio answers `{ "sid": "SM9a…", "status": "queued", … }`; the bridge returns `{ "messageId": "SM9a…" }`.

**Attachments (MMS):** Twilio needs a public URL for each file. The bridge keeps each file in memory behind an unguessable `/media/<token>` link for one hour and passes it as `MediaUrl`.

**Delivery statuses** — Twilio posts `MessageSid` + `MessageStatus` to `/twilio/status`:

| Twilio `MessageStatus` | CRM status |
|---|---|
| `queued`, `accepted`, `sending` | not forwarded (the message already shows Sending) |
| `sent` | Sent |
| `delivered` | Delivered |
| `read` (WhatsApp / RCS only) | Read |
| `undelivered`, `failed` | Failed, with `Twilio error <ErrorCode>` |

## WhatsApp through Twilio

Twilio can also carry WhatsApp. Run a **second copy** of this bridge for a separate CRM channel of type **WhatsApp**, with:

- `TWILIO_FROM="whatsapp:+14155238886"` (your WhatsApp-enabled sender);
- Twilio's WhatsApp sender webhook pointing to that copy's `/twilio/inbound`.

Twilio then sends `From=whatsapp:+919810012345`. Strip the prefix for the CRM and add it back when sending — two one-line changes:

```js
// handleInbound():
from: { phone: p.get("From").replace(/^whatsapp:/, "") },
// deliver():
const form = new URLSearchParams({ To: `whatsapp:${p.to.value}`, StatusCallback: `${PUBLIC}/twilio/status` });
```

The WhatsApp 24-hour rule applies (see [02-WHATSAPP.md](02-WHATSAPP.md)); Twilio reports it as error 63016.

## Testing without Twilio

```bash
CRM_WEBHOOK_URL=… CRM_SIGNING_SECRET=… node send-test-message.mjs --phone "+91 98100 12345" --name "Test" --text "Hello by SMS"
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| Bridge answers Twilio `403` | `PUBLIC_BASE_URL` doesn't match the exact URL Twilio calls (scheme, host, no trailing slash), or wrong `TWILIO_AUTH_TOKEN` |
| Messages arrive under **Unmatched** | The contact's phone is missing or differs in the last 10 digits |
| Replies Failed: `Twilio 21608` | Trial account — the recipient number must be verified in Twilio |
| Replies Failed: `Twilio 21211` | Invalid `To` number — check the contact's number includes the country code |
| Statuses stay at Sending | `PUBLIC_BASE_URL` isn't reachable by Twilio, so `/twilio/status` never gets called |
| Indian recipients don't receive SMS | DLT registration / template mismatch |

## Other SMS gateways

Any gateway works the same way; only three functions in the bridge change:

1. **Inbound** — read the gateway's "incoming SMS" callback, verify it as the gateway documents (signature, shared token or IP allow-list), and send the CRM:
   `{ type: "message", id: <gateway's message id>, from: { phone: "+91…" }, text: <body> }`.
   Use the gateway's own message id so retries are de-duplicated.
2. **Outbound** — in `deliver()`, call the gateway's send API and return `{ messageId: <gateway's id> }`. Throw `new ProviderError(422, "<reason>")` for permanent errors (invalid number, DLT template rejected) and `new ProviderError(502, …)` for temporary ones.
3. **Delivery reports** — map the gateway's DLR statuses to `sent` / `delivered` / `failed` and call `sendStatusesToCrm([{ type: "status", messageId, status }])`.

Always send phone numbers in international format (`+91…`) so contact matching works. See [07-OTHER-SYSTEMS.md](07-OTHER-SYSTEMS.md) for a full worked template.
