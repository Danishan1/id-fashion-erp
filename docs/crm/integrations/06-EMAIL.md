# Email (Mailgun) → CRM Inbox

Emails sent to a sales or support address arrive in the CRM Inbox, grouped into conversations by email thread. Your team replies from the CRM; replies go out from your address with proper threading headers, so they stay in the customer's existing email thread.

Read [README.md](README.md) first. Example: [`examples/email-mailgun-bridge.mjs`](examples/email-mailgun-bridge.mjs). Using SendGrid, Postmark, Amazon SES or a Gmail / Outlook mailbox instead? See [Other email providers](#other-email-providers).

```
Customer ─email─► Mailgun (MX) ─route forward() (signed)─► bridge /mailgun/inbound ─signed─► CRM (Email channel)
Customer ◄email── Mailgun ◄─ POST /v3/<domain>/messages ◄─ bridge /crm/outbound ◄─signed─ CRM
                  Mailgun ─webhooks delivered / permanent_fail─► bridge /mailgun/events ─► CRM (Delivered / Failed)
```

## What you need

- A Mailgun account and a **domain** you control, e.g. `mail.yourcompany.com`, verified for sending (SPF + DKIM records) and with Mailgun's **MX records** for receiving.
  - Use a subdomain so your main company email (Google Workspace / Microsoft 365) is not affected.
  - Or keep `sales@yourcompany.com` in your normal mailbox and set an auto-forward to `sales@mail.yourcompany.com`.
- A Mailgun **sending API key** and the **HTTP webhook signing key** (Mailgun → Settings → Security / Webhooks).
- The bridge (Node.js 18+) on a public HTTPS URL.

## Step 1 — Create the CRM channel

1. CRM → Settings → Channels → **Add channel**.
2. Channel type **Email**, Name "Sales email", Address `sales@mail.yourcompany.com`.
3. Choose who receives new conversations. Allow attachments: on; maximum 10 MB.
4. Save. Copy the **Webhook URL** and the **Signing secret**.

## Step 2 — Run the bridge

```bash
cd docs/crm/integrations/examples
export CRM_WEBHOOK_URL="https://erp.yourcompany.com/api/v1/crm/webhooks/conversations/generic/<channel id>"
export CRM_SIGNING_SECRET="whsec_…"
export MAILGUN_DOMAIN="mail.yourcompany.com"
export MAILGUN_API_KEY="key-…"
export MAILGUN_WEBHOOK_SIGNING_KEY="…"
export MAILGUN_API_BASE="https://api.mailgun.net"      # EU region: https://api.eu.mailgun.net
export MAIL_FROM="Indradhar Sales <sales@mail.yourcompany.com>"
PORT=8083 node email-mailgun-bridge.mjs
```

## Step 3 — Point Mailgun to the bridge

**Receiving (route):** Mailgun → Receiving → **Create route**:

- Expression type: *Match recipient* — `match_recipient("sales@mail.yourcompany.com")`
- Action: *Forward* — `forward("https://email-bridge.yourcompany.com/mailgun/inbound")`
- Tick **Stop** (optional), priority 0.

Or by API:

```bash
curl -s --user "api:$MAILGUN_API_KEY" https://api.mailgun.net/v3/routes \
  -F priority=0 -F description="CRM inbox" \
  -F expression='match_recipient("sales@mail.yourcompany.com")' \
  -F action='forward("https://email-bridge.yourcompany.com/mailgun/inbound")' \
  -F action='stop()'
```

**Delivery events (webhooks):** Mailgun → Sending → Webhooks → for your domain, add `https://email-bridge.yourcompany.com/mailgun/events` to **Delivered messages** and **Permanent failure**.

## Step 4 — Enable replies in the CRM

Edit the channel: **Outbound URL** = `https://email-bridge.yourcompany.com/crm/outbound`.

## How messages are mapped

**Incoming** — Mailgun's route posts the parsed email as a form (multipart when there are attachments). The fields the bridge uses:

| Mailgun field | CRM |
|---|---|
| `timestamp`, `token`, `signature` | Checked: `signature = hex HMAC-SHA256(signing key, timestamp + token)`; tokens are not accepted twice; older than 15 min is rejected. A bad signature gets `406` (Mailgun does not retry). |
| `from` (`"Asha Rao <asha@example.com>"`) | `from.email` + `from.name` → contact matched by email |
| `subject` | `subject` |
| `stripped-text` (reply without quoted history / signature), else `body-plain` | `text` |
| `message-headers` → `Message-Id` | `id` (without `< >`) |
| `In-Reply-To`, `References` | `inReplyTo`, `references` |
| first id in `References`, else `In-Reply-To`, else own `Message-Id` | `threadId` — the whole email chain becomes one CRM conversation |
| `attachment-1…N` | Stored when the type is allowed (pdf, office, csv, jpeg/png/webp) and ≤ 8 MB; others listed by name as "not stored" |

**Example** — what the bridge sends to the CRM for a customer's reply:

```json
{ "type": "message",
  "id": "CAF3x9@mail.gmail.com",
  "threadId": "20250916.abc123@mail.yourcompany.com",
  "from": { "email": "asha@example.com", "name": "Asha Rao" },
  "subject": "Re: Quotation for 500 polo shirts",
  "text": "Thanks — can you do navy instead of black?",
  "inReplyTo": "20250916.abc123@mail.yourcompany.com",
  "references": ["20250916.abc123@mail.yourcompany.com"],
  "attachments": [{ "fileName": "logo.pdf", "mimeType": "application/pdf", "contentBase64": "JVBERi0x…", "size": 48211 }] }
```

**Outgoing** — the CRM's request to `/crm/outbound`:

```json
{ "id": "9e2c…", "conversationId": "c1…", "threadId": "20250916.abc123@mail.yourcompany.com",
  "to": { "kind": "EMAIL", "value": "asha@example.com" },
  "subject": "Re: Quotation for 500 polo shirts",
  "text": "Yes, navy works. Revised quotation attached.",
  "inReplyTo": "CAF3x9@mail.gmail.com",
  "attachments": [{ "fileName": "quotation-v2.pdf", "mimeType": "application/pdf", "contentBase64": "JVBERi0x…" }] }
```

The bridge calls Mailgun:

```bash
curl -s --user "api:$MAILGUN_API_KEY" "https://api.mailgun.net/v3/mail.yourcompany.com/messages" \
  -F from="Indradhar Sales <sales@mail.yourcompany.com>" \
  -F to="asha@example.com" \
  -F subject="Re: Quotation for 500 polo shirts" \
  -F text="Yes, navy works. Revised quotation attached." \
  -F "h:In-Reply-To=<CAF3x9@mail.gmail.com>" \
  -F "h:References=<20250916.abc123@mail.yourcompany.com> <CAF3x9@mail.gmail.com>" \
  -F "h:X-CRM-Conversation=c1…" \
  -F attachment=@quotation-v2.pdf
```

Mailgun answers `{ "id": "<20250916093012.1.ABCD@mail.yourcompany.com>", "message": "Queued. Thank you." }`. That id is the email's `Message-ID`; the bridge returns it (without `< >`) as `messageId`, and Mailgun's `delivered` / `failed` (permanent) events for it update the status. When the customer replies, their `In-Reply-To` points to it, so the reply joins the same conversation.

**Subject:** the CRM pre-fills "Re: <last subject>" and the agent can edit it. If empty, the bridge uses "Re: your message".

## Email-specific notes

- **New emails** (no `References` / `In-Reply-To`) start a new conversation; replies within the chain stay in it.
- **Auto-replies / bounces** to your sales address also arrive as messages. Add a Mailgun route filter (e.g. `match_header("auto-submitted", "auto-replied")` → `stop()`) above the forward route if you want to drop them.
- **Spam:** Mailgun adds `X-Mailgun-Sflag: Yes` for spam; add a route with `match_header("X-Mailgun-Sflag", "Yes")` → `stop()` to drop it before the CRM.
- **HTML:** only the plain-text part is shown in the CRM; replies are sent as plain text.
- **Opens/reads:** not tracked (email has no reliable read receipt). Statuses shown: Sent → Delivered, or Failed for a bounce.

## Testing without Mailgun

```bash
CRM_WEBHOOK_URL=… CRM_SIGNING_SECRET=… node send-test-message.mjs --email asha@example.com --name "Asha Rao" \
  --subject "Quotation" --text "Please send prices for 500 polo shirts" --message-id "test-1@example.com" --thread "test-1@example.com"
```

Send a second one with `--message-id test-2@example.com --thread test-1@example.com` — it lands in the same conversation.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Mailgun logs show the route's forward got `406` | Wrong `MAILGUN_WEBHOOK_SIGNING_KEY` (it's the *webhook signing key*, not the API key), or the server clock is off by > 15 minutes |
| No route activity at all | MX records for the domain don't point to Mailgun, or the recipient doesn't match the route expression |
| Replies Failed: `Mailgun 401` | Wrong API key, or EU domain used with the US API base |
| Replies Failed: `Mailgun 400 … from` | `MAIL_FROM` isn't on the verified Mailgun domain |
| Each reply starts a new conversation | A forwarding step stripped `In-Reply-To` / `References` — forward the original message, not a new one |
| Customer gets replies in spam | SPF / DKIM / DMARC not set up for the sending domain |

## Other email providers

Only the bridge's three handlers change; the CRM side stays identical.

| Provider | Inbound | Outbound | Delivery events |
|---|---|---|---|
| **SendGrid** | *Inbound Parse* webhook to your bridge (multipart: `from`, `subject`, `text`, `headers`, `attachments`, `attachment1…`). Protect it with a secret path or basic auth in the URL. | `POST https://api.sendgrid.com/v3/mail/send` with `headers: { "In-Reply-To", "References" }`. Set your own `Message-ID` header (e.g. `<uuid@mail.yourcompany.com>`) and return it as `messageId`, so replies thread. | *Event Webhook* (`delivered`, `bounce`, `dropped`) with signed events; match by the `Message-ID` you set (send it as a custom arg). |
| **Postmark** | *Inbound* webhook (JSON: `MessageID`, `From`, `Subject`, `TextBody`, `StrippedTextReply`, `Headers[]`, `Attachments[]` with base64 `Content`). Use basic auth in the webhook URL. | `POST https://api.postmarkapp.com/email` with `Headers: [{Name:"In-Reply-To",…},{Name:"References",…}]`. Postmark's response `MessageID` is not the email Message-ID — set your own `Message-ID` header and return that. | Delivery / Bounce webhooks. |
| **Amazon SES** | Receipt rule → S3 + SNS (or Lambda); parse the raw MIME (e.g. `mailparser`). | `SendEmail` / `SendRawEmail` (raw lets you set `In-Reply-To` / `References` / `Message-ID`). | Configuration set → SNS events (`Delivery`, `Bounce`). |
| **Gmail / Google Workspace, Outlook / Microsoft 365 mailbox** | Poll with IMAP (or Gmail API / Microsoft Graph change notifications) every minute; send each new email as a CRM message with `id` = its `Message-ID`. | SMTP (`smtp.gmail.com` / `smtp.office365.com`, app password or OAuth) or the Gmail / Graph send API, with `In-Reply-To` / `References` set. | Not available — leave messages at Sent. |

**Rules that apply to every provider:**

- Use the email's real `Message-ID` (without `< >`) as the CRM `id` and as the returned `messageId` — that is what makes threading and duplicate protection work.
- `threadId` = first id in `References`, else `In-Reply-To`, else the message's own id.
- Prefer the "stripped" reply text when the provider offers it; otherwise send the plain-text body.
