# Sales & Marketing — Phase 10 Marketing channels and provider integrations (2026-11-05)

Spec: `docs/sales-marketing/ref/10.md`. Scope confirmed with the user on 2026-11-05:

- **Providers:** Email via SMTP, Email via Brevo API, SMS via MSG91, WhatsApp Cloud API (Meta).
- **Credentials:** none supplied — every integration is built from the provider's documentation and tested with mocks only. Each is marked **"Not live-verified"** in the registry (`liveVerified: false`) and on every screen.
- **Content:** existing CRM message templates (Phase 12 of the CRM), versioned; a run freezes the template version it starts with.
- **Run rules:** only an ACTIVE campaign, only by an explicit Send or Schedule from someone with `marketing_delivery.create`, after they have seen the recipient count. Consent is checked again just before each message. Nothing is ever sent automatically.

Out of scope (later phases): asset library / HTML email (11), promotions (12), attribution and ROI (13), social and ad platforms, A/B tests, sequences / drip.

## 1. What existed (reused, not rebuilt)

- **Audiences:** Phase 09 segments and campaign audiences. A run reads the pinned snapshot (or the latest completed one) of each include / exclude segment. If one has been purged the run fails rather than silently using a different audience.
- **Consent:** CRM contact consents (`canContact`, `CONTACTABILITY_SEVERITY`). Only CRM contacts carry consent, so **only CONTACT-source audiences can be sent to**.
- **Templates:** CRM message templates (`renderTemplateContent`). A version's `providerMetadata` carries the externally approved template reference. MSG91 SMS gained the provider field `externalTemplateId`.
- **Secrets:** `encryptSecret` / `decryptSecret` (AES-GCM, key from `AUTH_SECRET`).
- **Platform pieces:** BullMQ queue / worker, audit log, campaign history events (`sales_performance_events`, entity CAMPAIGN), `salesMarketingRoute`.

## 2. Data model (migration `20261106090000_marketing_delivery_phase10`, rollback in `prisma/rollback/`)

| Table | Purpose |
|---|---|
| `marketing_channel_connections` | One provider account. Holds `config` (non-secret JSON), `secrets_encrypted` (one encrypted JSON blob) and `secret_hints` (`••••1234`). Also a unique `webhook_token` (48 hex characters), the consent policy, rate and batch limits, the last test result, and circuit-breaker fields. |
| `marketing_campaign_channels` | Campaign × connection × template (unique), with `is_active`. |
| `marketing_delivery_runs` | One send. `run_number` per campaign, frozen `template_version_id`, the audience it used, and an exclusion summary. Also `scheduled_for`, an idempotency key (unique per company), a lease (`lock_token` / `locked_at`), `next_dispatch_at`, and the cancel fields. A partial unique index allows **one open run** (PREPARING, SCHEDULED, QUEUED or RUNNING) per campaign channel. |
| `marketing_deliveries` | One recipient per run (unique run × contact). Holds the destination, status, skip reason, attempts, next attempt, claim token, provider message id and errors. |
| `marketing_delivery_events` | Our own attempts (source APP) and provider callbacks (source PROVIDER). Unique on (connection, event key), so a repeated callback is stored once. Has a `processed_at` / `result` field for each event. |

Permission module **`marketing_delivery`** has these grants:

| Role | Actions |
|---|---|
| SUPER_ADMIN | all |
| MANAGEMENT | view, view_all, create, edit, cancel, export |
| MERCHANDISER | view, create, edit, cancel |
| VIEWER | view |

What each action means:

- `create` — send or schedule a run, add a channel, send a test message.
- `edit` — enable or disable a channel, resume a run, resolve unknown outcomes.
- `view_all` — see full addresses and provider ids. Other users see masked values.

Managing connections needs `sales_marketing_settings.edit`.

## 3. Lifecycles

**Run:** `PREPARING → SCHEDULED | QUEUED → RUNNING → COMPLETED | PARTIALLY_COMPLETED | FAILED`. A run can be **CANCELLED** at any open state (`RUN_TRANSITIONS` in `delivery-registry.ts`).

- **Prepare** builds the recipient list from the frozen snapshot ids. It checks each contact: the record still exists, it has an address valid for the provider, and consent allows it (re-checked). Duplicate addresses are dropped. Each recipient is written as PENDING, or SUPPRESSED with a reason.
- **Dispatch** works in time-boxed slices, each under a lease. For every recipient it re-checks eligibility, then claims the delivery (PENDING → SUBMITTING with a claim token), renders the message, sends it and settles the result.

**Delivery:** PENDING, SUBMITTING, ACCEPTED, SENT, DELIVERED, BOUNCED, REJECTED, FAILED, SUPPRESSED, CANCELLED, UNKNOWN.

- Provider events only move a delivery **forward**, using `DELIVERY_RANK`.
- "Accepted" means the provider took the message. It is never shown as "delivered".

**Send outcomes (adapter → engine):**

| Outcome | What happens |
|---|---|
| ACCEPTED | The delivery is recorded as accepted. |
| PERMANENT | The delivery fails and is not retried. |
| RETRYABLE | Retried with backoff (~1, 2, 4, 8 min, capped at 30 min) up to 5 attempts, then FAILED `RETRIES_EXHAUSTED`. |
| THROTTLED | The run pauses until Retry-After. |
| CONNECTION (bad credentials) | The run stops. Fix the connection, then **Resume**. |
| UNKNOWN (timeout, connection lost after sending) | The delivery is marked UNKNOWN and **never resent automatically**. |

Two extra safeguards:

- **Circuit breaker:** five consecutive "provider unreachable" results pause the connection for 5 minutes.
- **Recovery job** (every 2 min):
  - A delivery stuck in SUBMITTING for 10 minutes becomes UNKNOWN, not PENDING.
  - Due or lost runs are re-enqueued.
  - Unprocessed events are applied.

**Unknown outcomes** are resolved by hand on the run page:

- **Close as failed**, or
- **Resend**, which requires ticking "some people may get it twice".

Brevo and WhatsApp echo our delivery id back. A later callback can therefore settle an UNKNOWN delivery on its own: the test shows a timed-out send becoming DELIVERED from the webhook.

## 4. Providers

| Provider | Send | Correlation | Callbacks | Notes |
|---|---|---|---|---|
| SMTP (nodemailer 8) | `sendMail`, Message-ID `<deliveryId@from-domain>` | Message-ID | none — no delivery receipts | Connection test = `verify()` (login only). |
| Brevo | `POST /v3/smtp/email`, `api-key` header | `X-Mailin-custom` = delivery id | URL token (Brevo doesn't sign) | Handles delivered, bounces, blocked, spam, unsubscribed, opens and clicks. Opens and clicks are stored but don't change status. |
| MSG91 | Flow API `POST /api/v5/flow`, `authkey` | request id | URL token | Needs a DLT-approved template: the template version's `externalTemplateId`. Variables go positionally as `var1..n`. |
| WhatsApp Cloud | `POST /{version}/{phoneNumberId}/messages`, type `template` | `biz_opaque_callback_data` = delivery id | `X-Hub-Signature-256` (app secret) + GET handshake (verify token) | Needs a Meta-approved template name and language in `providerMetadata`. "read" counts as delivered. |

Rules that apply to every provider:

- Phone numbers are stored as country code + digits. A number without `+` needs the connection's default country code; otherwise it is "invalid address", never guessed.
- Every campaign email gets an unsubscribe footer, plus `List-Unsubscribe` and `List-Unsubscribe-Post: One-Click` headers. The template can't remove them.

## 5. Webhooks and unsubscribes (public, no session)

**Callback URL:** `POST /api/v1/sales-marketing/delivery/webhooks/{connectionId}/{token}` (and GET for the WhatsApp handshake). Each request goes through:

1. A rate limit of 1,200 per minute per connection, and a 512 KB size limit.
2. A constant-time token check.
3. The provider's signature check.
4. Parsing, then storing the events (deduplicated), **before** we answer the provider.
5. Processing after the response (queue, or `after()`).

**Unsubscribe link:** `/api/v1/public/marketing/unsubscribe/{token}`. The token is the delivery id plus an HMAC (`AUTH_SECRET`), so it carries no personal data.

- GET shows a confirmation page with a masked address. Mail scanners can't unsubscribe anyone by following the link.
- POST records the unsubscribe. This is also the RFC 8058 one-click target.

**Consent:** provider unsubscribes and complaints become `UNSUBSCRIBED` on the channel; email hard bounces become `BOUNCED`. They are written through `recordSystemContactRestriction`, which:

- follows merged contacts;
- **only ever makes consent stricter** (DO_NOT_CONTACT is never weakened);
- writes an audit row and a CRM timeline event.

## 6. Screens

- **Sales & Marketing → Channel Connections** (`/sales-marketing/delivery/connections`, settings users):
  - provider forms built from the registry, with setup steps;
  - write-only secrets showing masked hints;
  - Test;
  - Enable / Disable (refused while a run is open);
  - the callback URL (shown as origin + path), and Replace URL.
- **Campaign page → Channels & delivery:**
  - add a connection plus a CRM template;
  - readiness problems;
  - send a test (sample data, `[TEST]`, 5 per minute, not stored);
  - Check recipients (counts and skip reasons);
  - a confirmation tick, then Send now or Schedule (1 minute to 90 days);
  - the last runs.
- **Delivery Runs** (`/sales-marketing/delivery`) and the **run page** (`/runs/[id]`):
  - counts by outcome and errors by code;
  - Cancel, Resume, and Close / Resend unknown;
  - the recipient list (masked without `view_all`) with each recipient's event history.

## 7. Code map (`src/modules/sales-marketing/delivery/`)

| File | Contents |
|---|---|
| `delivery-registry.ts` | Client-safe: channels, providers (fields, capabilities, `liveVerified`), statuses, ranks, skip reasons, schemas. |
| `providers/` | The adapter contract; `http.ts` (timeouts, classification, address normalisation); one file per provider; the `index.ts` lookup. Adding a provider = one file + one index line + one registry entry. |
| `delivery-common.ts` | Secrets, runtime, audit / history, public URLs, unsubscribe tokens. |
| `connection.service.ts` | Connections CRUD, test, status, webhook token. |
| `audience-eligibility.ts` | Snapshot → contacts; the address and consent checks. |
| `delivery-render.ts` | Template loading and checks, per-recipient values, footer. |
| `delivery-run.service.ts` | Channels, preview, test send, start / cancel / resume / resolve, reads. |
| `delivery-engine.ts` | Prepare, dispatch, settle, finish, recovery. |
| `delivery-events.service.ts` | Webhook handshake / receive / process, unsubscribe. |
| `delivery-queue.ts`, `delivery-dispatch.ts`, `delivery-jobs.worker.ts` | Queue, inline fallback, worker (registered in `src/core/jobs/worker.ts`). |

UI: `src/components/sales-marketing/delivery/`. API: `src/app/api/v1/sales-marketing/delivery/**`, `campaigns/[id]/channels`, and `src/app/api/v1/public/marketing/unsubscribe/[token]`.

## 8. Setup

1. **Environment variables:**
   - `APP_BASE_URL` — the app's public https address, used in unsubscribe links. Email sends are refused without it (falls back to `NEXTAUTH_URL` / `AUTH_URL`).
   - `AUTH_SECRET` — already required; it signs unsubscribe tokens and encrypts credentials. **Changing it makes stored credentials unreadable** (re-enter them) and old unsubscribe links invalid.
   - `REDIS_URL`, plus the worker (`npm run worker`), for scheduled sends, retries and recovery. Without Redis, "Send now" runs from the web server after the response (best effort, up to about 4 minutes per request). Scheduling is refused without Redis, and retries wait until a worker runs.
2. **Deploy:**
   - `npm install` (adds `nodemailer@8`)
   - `npx prisma migrate deploy`
   - `npx prisma generate`
   - `node scripts/sync-permission-catalog.mjs`
   - restart the app and the worker
3. **Providers:**
   - Register the callback URL in Brevo, MSG91 and Meta. It must be reachable from the internet.
   - For WhatsApp: subscribe the app to `messages`, using the verify token you entered.
   - Put the DLT template id (MSG91) or the approved template name and language (WhatsApp) on the CRM template version.

## 9. Limitations (known)

- **Not live-verified.** Field names, endpoints and callback formats follow the providers' public documentation as of 2026. Run **Test**, then a test send, against each real account before a real campaign.
- **Rate limits are per run:**
  - Two runs on the same connection, or several worker processes, can together exceed the connection's rate.
  - Keep the rate conservative, or run one worker.
- **In-memory limits:** the test-send limit and the webhook / unsubscribe rate limits are per process, like the other public endpoints.
- **SMTP has no delivery receipts, and bounces arrive by email.** They are not read: only "accepted" is known.
- **Plain text only.** No HTML email, attachments or images (Phase 11 asset library).
- **Audiences:** only CRM contact audiences; companies, leads and customers have no consent records.
- **Recipient names** shown later are the contact's current name.
- **No CSV export of recipients yet** (`export` is granted but unused).

## 10. Acceptance criteria (spec `ref/10.md`)

| # | Criterion | Status |
|---|---|---|
| 1 | Provider-independent adapter contract; add a provider without touching the engine | Done |
| 2 | Credentials encrypted, write-only, masked, never logged | Done (tested: not in responses, not in the DB in clear) |
| 3 | Connection test without sending a message | Done (mocked) |
| 4 | Uses Phase 09 snapshots, never silently substitutes | Done (purged snapshot → run fails) |
| 5 | Unknown / missing consent never treated as permission; opt-in policy | Done |
| 6 | Consent re-checked just before sending | Done (tested: opt-out after prepare → skipped) |
| 7 | Explicit send / schedule only; active campaign only | Done |
| 8 | Idempotent start; one open run per channel; no duplicate sends | Done (key + partial unique index + claim tokens) |
| 9 | Acceptance ≠ delivery; timeout → UNKNOWN, no blind resend | Done |
| 10 | Retries with backoff, throttling, circuit breaker, resume | Done (unit-tested; integration covers the no-retry and unknown paths) |
| 11 | Webhooks verified, deduplicated, stored before acknowledging | Done |
| 12 | Events only move status forward | Done |
| 13 | Unsubscribe link + one-click header; only stricter consent | Done |
| 14 | Cancel a scheduled / running run | Done (scheduled tested; running stops at the next recipient) |
| 15 | Live verification against real providers | **Not done — no credentials** |

## 11. Verification (sandbox, 2026-11-05)

See the hand-over message for the exact commands and results.
