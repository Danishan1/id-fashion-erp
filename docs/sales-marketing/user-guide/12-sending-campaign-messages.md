# 12 — Sending campaign messages

[← Back to the overview](README.md)

Campaign messages go out by e-mail, SMS or WhatsApp through **your own provider accounts**. Every recipient is checked for an address and consent at the moment of sending, and every result is tracked.

## 1. Connecting a provider (administrators)

**Sales & Marketing → Channel Connections → Add.** You need Settings edit permission.

| Provider | What you need |
|---|---|
| **SMTP** (any mail server) | Host, port, user, password, from address. SMTP gives no delivery receipts |
| **Brevo** | API key, sender. Delivered, bounced, blocked, spam and unsubscribe events come back |
| **MSG91** (SMS) | Auth key, sender ID, DLT-approved templates |
| **WhatsApp Cloud API** | Phone number ID, access token, app secret, verify token, Meta-approved templates |

- Secrets are stored encrypted and shown only as `••••1234`.
- Click **Test** to check the account.
- Copy the **callback URL** into the provider's webhook settings, so delivery results come back.
- Set the **default country code** for SMS and WhatsApp. Numbers without a country code are otherwise refused, never guessed.
- **Disable** a connection to stop using it. You can't disable it while a run is open.

## 2. Sending from a campaign

Open the campaign → **Channels & delivery**:

1. **Add a channel:** choose a connection plus a template or the campaign's content. Any **readiness problems** are listed (no approved version, missing provider template ID, no audience…).
2. **Send a test** to yourself. It uses sample data and is marked `[TEST]`; up to 5 per minute.
3. **Check recipients:** how many will get it, and how many are skipped and why (no address, opted out, duplicate…).
4. Tick the confirmation, then **Send now** or **Schedule** (from 1 minute up to 90 days ahead).

## 3. Delivery runs

**Sales & Marketing → Delivery Runs**, or the run from the campaign page, shows:

- counts by outcome: sent, delivered, bounced, failed, skipped, unknown;
- errors grouped by reason;
- the recipient list, with each one's event history. Addresses are masked unless you have *view all*.

| Status | Meaning |
|---|---|
| Accepted / Sent | The provider took the message. **Not** proof it arrived |
| Delivered | The provider confirmed delivery (WhatsApp "read" counts as delivered) |
| Bounced / Rejected / Failed | Not delivered. Hard bounces mark the contact's e-mail as bounced |
| Suppressed | Skipped before sending (no address, consent) |
| **Unknown** | The send timed out, so we don't know whether it went. These are **never resent automatically** |

**Actions on a run:**

- **Cancel**;
- **Resume**, after fixing a connection problem;
- for unknown outcomes, **Close as failed**, or **Resend**. Resend needs a tick confirming that some people may get the message twice.

## 4. Unsubscribes and consent

- Every e-mail has an unsubscribe link and one-click unsubscribe headers. The template can't remove them.
- Unsubscribes, complaints and hard bounces update the contact's consent **automatically**. The ERP only ever makes consent stricter, never looser.
- The next send skips those people.

## 5. Good practice

- Always **test** and **check recipients** before sending.
- Pin the audience snapshot ([10](10-audience-segments.md)) before a big send.
- Watch the **System health** card on the dashboard for failed runs.
