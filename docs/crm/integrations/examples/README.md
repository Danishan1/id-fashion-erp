# Example bridges

Runnable, dependency-free examples for the [CRM channel integration guide](../README.md). Node.js 18+ (Python 3.9+ for the Python template). Configure them with environment variables; each file's header lists them.

| File | Channel | Guide | Default port |
|---|---|---|---|
| `crm-bridge-kit.mjs` | Shared helpers: CRM signing / verification, sending with retries, outbound handler with idempotency, tiny HTTP server | [README](../README.md) | — |
| `website-chat-bridge.mjs` | Website chat (includes a demo page at `/chat/demo`) | [01](../01-WEBSITE-CHAT.md) | 8084 |
| `whatsapp-cloud-bridge.mjs` | WhatsApp — Meta Cloud API | [02](../02-WHATSAPP.md) | 8080 |
| `meta-messenger-instagram-bridge.mjs` | Facebook Messenger + Instagram Direct | [03](../03-FACEBOOK-MESSENGER.md), [04](../04-INSTAGRAM.md) | 8081 |
| `sms-twilio-bridge.mjs` | SMS / MMS — Twilio (also Twilio WhatsApp) | [05](../05-SMS.md) | 8082 |
| `email-mailgun-bridge.mjs` | Email — Mailgun | [06](../06-EMAIL.md) | 8083 |
| `inhouse_bridge.py` | Your own system (Python template) | [07](../07-OTHER-SYSTEMS.md) | 8085 |
| `telegram-bridge.mjs` | Telegram bot (worked "Other" example) | [07](../07-OTHER-SYSTEMS.md) | 8086 |
| `send-test-message.mjs` | Sends one signed test message or status to a channel — no provider needed | [README](../README.md) | — |

All examples were run against the CRM with mock provider APIs (signatures, mapping, matching, replies, attachments, receipts, retries).

**Before production:** run behind HTTPS, keep secrets in a secret store, and replace the in-memory stores (idempotency keys, chat replies, MMS files) with Redis or a database if you run more than one instance.
