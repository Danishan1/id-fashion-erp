# Sales & Marketing — Phase 16 External integrations, webhooks and API (2026-11-06)

Spec: `docs/sales-marketing/ref/16.md`. Scope confirmed with the user on 2026-11-06:

- **Webhooks: extend the CRM engine.** S&M events go into a public outbox fed by the Phase 15 event reader. The existing CRM Phase 22 subscription and delivery engine sends them, so there is no second bus and no second sender.
- **API auth: a scoped key plus a run-as user.** S&M keys live in the existing hashed API-key table. A key acts as the person who created it. Every call needs the scope **and** that person's current permission and record visibility.
- **Integration paths, all three:**
  - **API read + webhooks:** campaigns, performance, segments, quotations and jobs, plus signed S&M event webhooks.
  - **Enquiry intake + sync:** external ids, idempotent upsert, checkpoints and field ownership. Conflicts are recorded, never applied silently.
  - **Provider registry:** one registry with lifecycle and health. It covers the Phase 10 delivery providers, S&M keys and webhooks, and the CRM capture keys, inbound webhooks and outbound webhooks (shown read-only).
- **Permissions: a new module, `sales_integrations`.**
  - view: status, logs and conflicts;
  - edit: configure, keys, subscriptions, enable/disable, checks;
  - approve: resolve conflicts, replay deliveries, revoke keys.

Out of scope: BI (17), AI (18). No new providers, no inbound actions that approve, convert, send or post, and no generic sync for all entities.

## 1. What existed and what was reused or introduced

| Need | Existing | Phase 16 |
|---|---|---|
| API keys | `crm_api_keys` (SHA-256 hash, prefix, scopes, expiry, revoke), lead-ingest only | Same table and format. New columns `purpose` (CRM_CAPTURE / SALES_MARKETING_API), `description`, `rate_limit_per_minute`, `rotated_from_id`. CRM key lists, counts and lead-ingest auth now filter `purpose = CRM_CAPTURE` |
| Outbound webhooks | CRM Phase 22 subscriptions and deliveries, HMAC signing, SSRF guard (https, public IPs only, IP pinning, no redirects), retries, delivery log, redeliver, rotate, secret shown once | Same tables and engine. Subscriptions get `scope` (CRM / SALES_MARKETING) and `payload_version`; deliveries get `event_source` (CRM / INTEGRATION). The queue step also reads `integration_events` for S&M-scoped subscriptions |
| Event source | Phase 15 reader over committed S&M rows plus the event log | The same claim writes the public `integration_events` row. Workflow completion and needs-attention also publish |
| Provider adapters | Phase 10 `MarketingProviderAdapter` (send, test, verify/parse callbacks), encrypted connection secrets, store-then-ack callback pipeline | Reused unchanged. Callback outcomes (accepted / failed verification) are now counted per connection |
| Rate limiting | In-memory fixed window (`capture-rate-limit.ts`) | Same limiter, with a new `checkRateLimit` that returns remaining calls and reset time for headers |
| Queues | BullMQ worker, `sales-workflows` queue | New `sm-integrations.tick` job on the same queue, every 5 minutes |
| Secrets | `core/security/encryption` (AES-GCM), hash-only API keys | Reused. No new secret store. The registry stores only a credential reference |
| Audit | `writeAuditLog` | Keys, subscriptions, registry changes, external refs and conflict resolutions |

New tables (migration `20261111090000_sm_integrations_phase16`; rollback `prisma/rollback/20261111090000_sm_integrations_phase16.down.sql`):

| Table | Purpose |
|---|---|
| `integrations` | The registry: one row per wrapped resource (unique company + resource), kind, provider, lifecycle status with reason, capabilities, auth method, credential reference, last success and error, `managed_in` |
| `integration_events` | Public S&M events (outbox), unique on (source, source_key), minimal payloads, 30-day retention |
| `integration_external_refs` | External id ↔ ERP record (unique company + system + type + external id), `last_values` baseline, `source_updated_at` |
| `integration_sync_checkpoints` | Per integration and stream: last source time and counters (created / updated / unchanged / stale / conflicts / failed) |
| `integration_conflicts` | One OPEN row per (ref, field); reason ERP_CHANGED / RECORD_ADVANCED / NOT_UPDATABLE; resolution and note |
| `integration_api_usage` | Hourly counters per client (API key or delivery connection) and endpoint: requests, errors, refused, 429s. 90-day retention |
| `integration_idempotency` | Idempotency-Key store for API writes (24 h) |

## 2. Integration registry and lifecycle

**States:** DRAFT, CONFIGURED, PENDING_VERIFICATION, CONNECTED, DEGRADED, DISABLED, REVOKED, FAILED.

- Every transition is checked against `INTEGRATION_TRANSITIONS`. REVOKED is final.
- **Health comes from what actually happened:**
  - **API keys:** first use, calls in the last 24 h (≥ 50 % failing → DEGRADED), expiry, and whether the run-as user is still active.
  - **Webhooks:** the last delivery, and consecutive failures (≥ 3 → FAILED).
  - **Delivery providers:** the connection test, the circuit breaker, failures, and callback verification failures.
  - **CRM resources:** shown read-only.
- **Who changes status by hand:** a person can disable (API keys only, enforced at authentication) or revoke. For webhooks and providers, enable/disable goes through their own services, and providers still require `sales_marketing_settings.edit`.
- **Refresh:** the registry refreshes on read and every 5 minutes. Rows whose resource was deleted are removed.

**Provider adapter contract:** the Phase 10 contract (send, test, verify webhook, parse webhook, handshake), with declared capabilities per provider. Phase 16 adds no providers.

## 3. API v1

**Base path:** `/api/v1/integrations/sales-marketing`. Responses carry `X-API-Version: 2026-11-06`, `X-Request-Id` and `X-RateLimit-*`.

**Authentication:** `Authorization: Bearer <key>` or `X-API-Key`. Session cookies are never accepted.

| Endpoint | Scope (and the run-as user's permission) |
|---|---|
| `GET /campaigns`, `GET /campaigns/{id}` | `sm.campaigns:read` (marketing_campaigns.view) |
| `GET /campaigns/performance` | `sm.performance:read` (marketing_attribution.view) |
| `GET /segments` (metadata only, never members) | `sm.segments:read` (marketing_segments.view) |
| `GET /quotations`, `GET /quotations/{id}` | `sm.quotations:read` (sales_quotations.view) |
| `POST /enquiries`, `GET /enquiries/{system}/{externalId}` | `sm.enquiries:write` (sales_marketing.create), `sm.enquiries:read` (sales_marketing.view) |
| `POST /exports`, `GET /jobs/{id}`, `GET /jobs/{id}/file` | `sm.exports:create` (sales_marketing.export), `sm.jobs:read` |
| `/webhooks` (list, create, get, patch, delete, deliveries, test, rotate-secret, events) | `sm.webhooks:manage` (sales_integrations.edit). Replay is not offered over the API, because it is an approve action |

**How a request is checked, in order:**

1. size;
2. key: unknown, wrong, revoked, expired, owner inactive or integration disabled → 401;
3. scope → 403;
4. rate limits per key and per company → 429 with Retry-After;
5. the run-as user's permission → 403;
6. the module service, as that user, for visibility and business rules.

**Contract details:**

- **DTOs:** explicit and minimal. There are no owner names, contacts, internal notes or approval internals.
- **Errors:** `{ error: { code, message, details: { requestId } } }`. Unexpected errors are generic, with the request id.
- **Limits:**
  - 120 requests / minute per key by default (configurable 1–600; writes at most 60);
  - 600 / minute per company;
  - 64 KB bodies, pages of at most 100, date ranges of at most 366 days.
- **Idempotency:** writes take `Idempotency-Key`. A repeat returns the stored answer with `Idempotent-Replayed: true`; a different body with the same key → 400; a repeat while the first is still running → 409.
- **Versioning:** within v1, fields may be added but none are removed or renamed; such changes need a new base path and notice.

**Key management** (S&M → Integrations → API keys; also `/api/v1/sales-marketing/integrations/api-keys`):

- The full key is returned once.
- **Least privilege:** nobody can grant a scope whose permission they don't hold. This applies to creating keys, adding scopes and rotating.
- **Rotation** issues a new key acting as the rotator. The old key stops now or after a 1, 24 or 72 h grace period.
- **Revoke** needs approve and a reason.

## 4. Outgoing webhooks for S&M events

**Event types (version 1):** `sm.enquiry.qualified | stage_changed`, `sm.quotation.created | submitted | approved | approval_rejected | issued | accepted | rejected | revised | cancelled | converted`, `sm.campaign.submitted | approved | sent_back | activated | completed | cancelled`, `sm.budget.alert_raised | alert_cleared`, `sm.attribution.run_finished`, `sm.bulk.job_finished`, `sm.workflow.completed | needs_attention`.

- **Only real transitions are published.** Each type comes from a Phase 15 event source or a workflow transition (a unit test enforces this). Internal-only types such as `campaign.changed` and `quotation.withdrawn` are not published.
- **Envelope (v1):** `{ id, type, version: 1, occurredAt, test, companyId, correlationId, data: { entity: { type, id }, payload } }`. Payload keys are allow-listed per family (e.g. budget: `kind`, `campaignId`); nothing else leaves the ERP.

**Delivery** (CRM engine, worker job `webhook.tick` every 15 s):

- **Signature:** `X-CRM-Signature: t=…,v1=HMAC-SHA256(secret, "t.body")`.
- **Other headers:** `Idempotency-Key` = delivery id (stable across retries), plus `X-ERP-Event-Type`, `X-ERP-Event-Version`, `X-ERP-Delivery-Id` and `X-ERP-Delivery-Attempt`.
- **Retries:**
  - retried after 1 min, 5 min, 30 min, 2 h and 6 h (S&M adds up to 10 % jitter) for timeouts, network errors, 408, 429 and 5xx;
  - other 4xx, any 3xx and blocked destinations fail at once.
- **Shared limits (CRM and S&M):**
  - per-endpoint concurrency of 1;
  - at most 10 sends per subscription per tick;
  - backpressure: at most 1,000 queued or retrying deliveries per subscription.
- **Guarantee:** at-least-once, not guaranteed and not ordered. A 2xx only means the receiver accepted the request. Exactly-once delivery is not claimed.
- **Log and replay:** deliveries record outcomes only, never bodies or receiver responses. Replay (redeliver) requires `sales_integrations.approve`.

**SSRF protection** (shared with the CRM sender):

- https only; ports 443 / 8443; no credentials in the URL;
- no internal names;
- every resolved address must be public (loopback, private, link-local / metadata, CGNAT, multicast and reserved ranges refused);
- the connection is pinned to the vetted IP (no DNS rebinding);
- redirects are never followed;
- checked on save and on every send; 10-second timeout; response size limited.

## 5. Inbound webhooks

The Phase 10 provider callbacks are the inbound pipeline: URL token, provider signature (WhatsApp `X-Hub-Signature-256`), size and rate limits, store-then-acknowledge, dedupe on `(connection, event_key)`, asynchronous processing.

Phase 16 adds counters per connection (accepted / failed verification). They appear on the registry and the metrics. A connection with verification failures in the last 24 h shows DEGRADED.

Brevo and MSG91 don't sign their callbacks, so the URL token is their only proof. This is unchanged from Phase 10 and documented there.

## 6. Enquiry intake: sync, ID mapping and conflicts

`POST /enquiries` with `{ system, externalId, sourceUpdatedAt?, enquiry: { subject, remarks, priority, source, enquiryDate, customerId | prospect, lines[1..50] } }`.

- **Create once.** The mapping row is claimed before the enquiry is created through `createSalesEnquiry`, as the key's user. Concurrent or repeated submissions get the existing enquiry or 409, never a second enquiry (tested with 4 parallel calls).
- **Ordering.** A `sourceUpdatedAt` older than the last applied one → `STALE_IGNORED`.
- **Ownership** (system of record = the ERP after creation). For each field, the external value is compared with what the external system sent last time:
  - **unchanged** → nothing happens, even if the ERP value differs;
  - **subject / remarks / priority** changed, the enquiry still NEW or UNDER_REVIEW, and nobody changed the field in the ERP → applied through `updateSalesEnquiryDetails`;
  - **otherwise** → an OPEN conflict: ERP_CHANGED, RECORD_ADVANCED (past intake) or NOT_UPDATABLE (prospect fields and lines are create-only; no service updates them).
- **Resolution** (S&M → Integrations → Sync conflicts; approve):
  - keep the ERP value;
  - apply the external value (intake fields only, through the enquiry service as the resolver);
  - dismiss.

  Each resolution is audited.
- **Checkpoints and status.** Per key and system, `integration_sync_checkpoints` counts created / updated / unchanged / stale / conflicts / failed and records the latest source time. `GET /enquiries/{system}/{externalId}` returns the mapping, the stage and the open conflicts.

## 7. Phase 14 and Phase 15 integration

- **Phase 14:** `POST /exports` starts an S&M export bulk job as the key's user (that user's visibility and export permission; `Idempotency-Key` passed to the job). `GET /jobs/{id}` and `/file` serve only jobs that user started.
- **Phase 15:** the dispatcher's event claim publishes the public event. Workflow completion and needs-attention (from the engine and from manual resolve) publish `sm.workflow.*`, with the workflow's correlation id.

## 8. UI

**Sales & Marketing → Integrations** (`/sales-marketing/integrations`, gated on `sales_integrations.view`):

- **Metric tiles:** integrations needing attention, API calls with error rate, webhooks delivered / failed / queued, delivery queue lag, provider callbacks with verification failures, open conflicts.
- **Integrations:** the registry, with status and reason, capabilities, last success and error. Providers are labelled "Not live-verified"; CRM rows link to CRM Settings.
- **API keys:** create (scopes with the permission each needs; key shown once with the stored-confirmation step), rotate with grace, revoke with a reason.
- **Outgoing webhooks:** create (events grouped), secret shown once, test, enable/disable, rotate, delete, and the delivery log with redeliver.
- **Sync conflicts:** ERP vs external values; keep / apply / dismiss with a note.
- **API & webhook guide:** base URL, auth, limits, errors, idempotency, endpoints and scopes, an intake example, signature verification, the delivery guarantee and the event list. It is rendered from the same registry the API enforces.
- **Integration detail page:** capabilities, auth, credential reference (never the value), usage by endpoint (24 h / 7 d), sync checkpoints, webhook or callback statistics, audit history, and enable / disable / check behind confirmations.

## 9. Security and privacy

- **Secrets:** API keys are hash-only and shown once. Webhook secrets are AES-GCM encrypted and shown once. Registry rows and responses carry only references; the tests scan responses and audit rows for keys and secrets.
- **Tenancy:** every query is company-scoped. Another company's campaign, integration, conflict, subscription or external id → 404 (tested).
- **Human vs. service:** a key never exceeds its creator's permissions. A creator losing a permission or being deactivated stops the key at once. Approvals, conversions, campaign sends and financial actions are not exposed.
- **Data minimisation:** minimal public DTOs and event payloads, no personal data in URLs (external ids are the integrator's own), segment members never exposed.
- **Compliance:** these are safeguards, not a compliance certification. A deployment that must meet specific regulations should review retention (events 30 days, usage 90 days, idempotency 24 h) and its DPA terms with the integrators.

## 10. Tests run (sandbox, 2026-11-06)

| Suite | Result |
|---|---|
| `sm-integrations.integration.test.ts` (real Postgres, real local HTTP receiver, real route handlers) | 7/7 |
| `sm-integrations.units.test.ts` | 11/11 |
| `sm-integration-screens.test.tsx` (jsdom) | 4/4 |
| Touched-area regressions: CRM webhooks-out, capture and settings; Phase 10 delivery; Phase 15 workflows; S&M foundation | 91/91 |
| Full suite `npx vitest run` | 339 files passed, 2 skipped; 4,358 tests passed, 9 skipped (after updating one dashboard assertion that expected Phase 16 to still be "planned") |
| `tsc` (sandbox slice), `eslint` on all changed files | clean |

**Coverage:**

- key hashing and once-only display, least privilege, CRM isolation;
- 401 / 403 / 404 paths, run-as permission revocation, per-key 429 with Retry-After;
- rotation without grace, disable / enable, revoke (approve only, final);
- intake create / idempotent replay / reuse with a different body / unchanged / applied update / stale / ERP_CHANGED / NOT_UPDATABLE / RECORD_ADVANCED, resolution paths, concurrency, cross-tenant 404;
- SSRF refusals (metadata IP, private IP, localhost, http, credentials in the URL);
- a real budget alert → outbox → signed delivery verified with the secret, minimal payload checked against the published schema;
- re-read without republishing or redelivering; 503 → retry → success with the receiver body never stored;
- replay needing approve, test event, registry CONNECTED;
- workflow event published once; provider shown CONFIGURED and not live-verified; metrics; registry tenant isolation.

**Real vs. mocked:**

- **Real:** the API, auth, rate limits, intake and conflicts against Postgres; webhook delivery to a real HTTP server on 127.0.0.1 (allow-listed for the test only).
- **Mocked:** the permission service (allowed unless a test denies).
- **Not exercised against real accounts:** Brevo, MSG91, WhatsApp Cloud and SMTP. The registry labels them "Not live-verified".

## 11. Acceptance criteria

All §25 criteria are met, with these notes:

- **"At least one meaningful integration path end to end":** met for API reads, enquiry intake and S&M event webhooks (verified against a real receiver). The external marketing providers remain unverified against real accounts (Phase 10 limitation, labelled in the UI).
- **"Inbound webhooks verify authenticity before processing":** met by the Phase 10 pipeline. Unsigned providers (Brevo, MSG91) rely on the URL token, as documented.
- **Rate limiting:** in-memory per process. With several app instances the limits multiply. A Redis limiter is the documented next step (same as the CRM capture endpoints).

## 12. Deployment and operations

1. Run `npx prisma migrate deploy`, then `npx prisma generate`.
2. Run `node scripts/sync-permission-catalog.mjs`; grant `sales_integrations.*` to custom roles as needed.
3. Restart the app **and** the worker:
   - webhooks are sent by the CRM worker tick `webhook.tick`;
   - the public outbox is filled by `sm-workflow.tick`;
   - registry health and retention run on `sm-integrations.tick`.
4. Allow outbound HTTPS from the worker to integrators' endpoints. `CRM_WORKFLOW_WEBHOOK_ALLOWED_HOSTS` is for on-premise receivers only. Never set `CRM_WORKFLOW_WEBHOOK_ALLOW_HTTP` in production.
5. Give integrators the API & webhook guide tab (or this document). Create one key per integrator with only the scopes it needs, and set an expiry.

**Troubleshooting:**

- **401 for a valid-looking key:** check the key's state (expired / revoked), the registry status (disabled) and whether the creator is still active.
- **403:** the scope is missing, or the creator lost the permission. The integration's "Run check" lists each scope.
- **Webhooks not arriving:**
  - check the subscription health and its delivery log;
  - check the registry FAILED reason;
  - check the queue lag tile (worker down?);
  - the destination is refused if it resolves to a private address.
- **Conflicts piling up:** the external system is changing fields after the ERP took over. Agree which fields they may update, or resolve in bulk.
- **Rollback:** apply the down file. S&M keys and S&M subscriptions are removed; CRM integrations are unaffected.

## 13. Known limitations

- Rate limits and idempotency claims are per database (idempotency) and per process (rate limits).
- No OAuth client-credentials flow: scoped API keys are the repository's existing mechanism, so OAuth was not added.
- Webhook delivery honours 429 by retrying on the fixed schedule; the receiver's `Retry-After` value is not read.
- Not published: Sales Order status changes beyond conversion, audience snapshots, content approvals, promotion activation/expiry and per-recipient delivery status. They have no Phase 15 event source yet; adding one means a source in `sm-workflow-events.ts` plus a public type.
- Intake is enquiries only. Other entities are read-only over the API.

## 14. Phase 17 readiness

Data that can feed reporting:

- `integration_api_usage` (volume and error rates per key and endpoint);
- `crm_webhook_deliveries` with `event_source = INTEGRATION` (delivery reliability);
- `integration_events` (a 30-day, minimal, versioned business event stream);
- `integration_external_refs` and `integration_sync_checkpoints` (provenance and sync volumes by source system: enquiries by channel / partner);
- `integration_conflicts` (data-quality signals).

BI should read these through services, never expose raw payloads, and keep the existing retention.
