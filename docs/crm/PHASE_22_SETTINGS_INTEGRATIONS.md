# CRM Phase 22 — Settings, API configuration, webhooks and integration guidance

**Status:** implemented (final CRM phase). **Date:** 2026-10-14.

CRM Settings is now a configuration centre: sections are grouped, every integration shows a status computed from real data, developers get in-app instructions for the lead capture API and webhooks, and a new **outgoing webhooks** feature sends CRM events to other systems.

Secrets follow one rule everywhere: **a secret is shown once — in the response that creates or rotates it — and never again.** Phase 22 removed the one place that broke this rule: the workflow "Reveal secret" action.

---

## 1. What changed

| Area | Change |
|---|---|
| Settings layout | Grouped navigation instead of one 16-tab strip: General, Leads, Contacts & companies, Sales, Integrations and Automation. On small screens it becomes one select. The old `?tab=` ids still work; the default section is now **Overview**. |
| General → Overview | Business time zone (Asia/Kolkata, fixed), default pipeline, configuration counts, a summary of integration health, and links to every setup area. |
| General → Users & access | What each CRM permission allows, which ones the viewer holds, and a link to Administration (users, roles, audit log). Read-only — roles are still managed in `/admin`. |
| Integrations → All integrations | A catalogue whose statuses come from the database: **Connected**, **Needs attention**, **Available — not set up** or **Planned**. |
| Integrations → API access | Developer guide for `POST /api/v1/crm/leads/ingest`. It shows this deployment's address, placeholder keys, real limits and response codes, and the copy buttons work. |
| Integrations → Outgoing webhooks | **New.** Subscribe an HTTPS endpoint to CRM events, with signed delivery, retries, a delivery log, test events, secret rotation and redelivery. |
| Automation → Workflows & events | The trigger, action and event catalogues, read from the registries, with links to workflows and executions. |
| Security fixes | Workflow secret reveal removed. Channel outbound URLs get an SSRF check. One-time secret display fixed: honest copy feedback, plus confirmation before it closes. |

---

## 2. Settings information architecture

| Group | Section (`?tab=`) | Notes |
|---|---|---|
| General | Overview (`overview`), Users & access (`access`) | new |
| Leads | Lead statuses (`statuses`), Sources (`sources`), Tags (`tags`), Lead custom fields (`custom-fields`), Lead duplicate rules (`duplicates`) | unchanged |
| Contacts & companies | Contact custom fields, Contact duplicate rules, Form options, Company statuses, Company custom fields, Company duplicate rules | unchanged |
| Sales | Pipelines & stages (`pipelines`), Opportunity custom fields | unchanged |
| Integrations | All integrations (`integrations`), API access (`api`), API keys (`api-keys`), Incoming lead webhooks (`webhooks`), Outgoing webhooks (`webhooks-out`), Conversation channels (`channels`) | `integrations`, `api` and `webhooks-out` are new |
| Automation | Workflows & events (`automation`) | new; workflows themselves are still edited at `/crm/workflows` |

Message templates, imports and the audit log keep their own pages; Settings links to them.

**Permissions:** viewing Settings needs `crm_settings.view`; any change needs `crm_settings.edit`. Both are enforced on every API route; the UI only hides buttons.

---

## 3. Secret handling (all CRM integrations)

| Credential | Format | Stored as | Shown | Recover a lost one |
|---|---|---|---|---|
| Lead capture API key | `crmk_<12 hex>_<32>` | SHA-256 hash | once, at creation | revoke it and create a new key |
| Incoming lead webhook secret | `whsec_…` | AES-256-GCM, encrypted | once, at creation or rotation | rotate |
| Conversation channel secret | `whsec_…` | AES-256-GCM, encrypted | once, at creation or rotation | rotate |
| Outgoing webhook signing secret (new) | `whsec_` + 32 random bytes (base64url) | AES-256-GCM, encrypted | once, at creation or rotation | rotate |
| Workflow "Call a webhook" secret | 64 hex | AES-256-GCM, encrypted | once, at rotation (**Reveal removed**) | rotate |

Secrets that must sign outgoing requests are encrypted rather than hashed, because the CRM needs the plaintext to sign them. They are decrypted only inside the signing code.

Guarantees, and where each one is enforced:

- **Never returned again.**
  - List, detail, update, test and delivery endpoints use selects that leave out the secret column.
  - Outgoing webhook responses carry `secret: { configured: true, masked: "whsec_••••••••", rotatedAt }`.
  - Update schemas are strict and have no secret field.
- **No reveal action.**
  - `GET /api/v1/crm/workflows/{id}/webhook-secret` and `revealWebhookSecret` are deleted.
  - The workflow Details & secret tab shows "Secret configured" and a **Rotate secret** button, which asks for confirmation.
- **Shown once in the UI.**
  - `SecretOnce` (`src/components/crm/SecretOnce.tsx`) holds the value only in component state, taken from the create or rotate response.
  - It never re-fetches the secret and never writes it to browser storage.
  - The user must tick "I have stored this secret somewhere safe" before **Done** is enabled.
  - Leaving the page before confirming triggers the browser's leave-page warning.
- **Honest copy.**
  - **Copied** appears only after the clipboard accepted the text.
  - When the browser refuses, the user is told, and the text is selected so it can be copied by hand.
  - `CopyButton` and `CopyableCode` follow the same rule.
- **Not in logs, URLs, audit rows, payloads or diagnostics.**
  - Audit rows record `secret: "generated"` or `secret: "rotated"`.
  - Delivery logs store outcomes only: status, HTTP status, duration and a short sanitised reason. They never store the request body, the receiver's response or internal addresses.
- **Responses carrying a secret** are sent with `Cache-Control: no-store`.

Verified by integration tests (§8) and by the browser test, which scanned:

- every GET response;
- every request URL;
- localStorage and sessionStorage.

No API key or signing secret was found in any of them.

---

## 4. Outgoing webhooks

### 4.1 Configuration

**Where:** CRM Settings → Integrations → Outgoing webhooks.

**Each subscription has:**

- a name;
- an optional description;
- an endpoint URL;
- one or more events;
- an active / disabled state;
- a signing secret, generated by the CRM.

**Limit:** 20 subscriptions per company.

**Events:**

- The event list is the CRM event registry (`crm-event-types.ts`), minus `workflow.draft_saved` and `workflow.draft_discarded`.
- Only events the services actually write to the `crm_events` outbox are listed. The catalogue is built from `src/modules/crm/webhooks-out/webhook-events.ts`, so the UI, docs and backend use the same list.

**Destination rules** (shared with the workflow webhook sender, `workflow-webhook.ts`):

- https only;
- ports 443 or 8443;
- no credentials in the URL;
- no `localhost` / `*.local` / `*.internal` names;
- **every** resolved address must be public — loopback, private, link-local (cloud metadata), CGNAT, multicast, reserved and IPv6 ULA/link-local ranges are refused;
- the connection is pinned to the vetted IP, so there is no DNS rebinding between check and connect;
- **redirects are never followed**, so redirect-based bypasses are refused;
- the rules are checked when the subscription is saved **and** on every send.

**Server-side exceptions, for administrators only:**

- `CRM_WORKFLOW_WEBHOOK_ALLOWED_HOSTS` — exact host names, e.g. an on-premise system;
- `CRM_WORKFLOW_WEBHOOK_ALLOW_HTTP=true` — local testing only.

**Lifecycle:**

- A new subscription receives events that happen **after** it was created.
- Re-enabling it, or adding event types, starts again from that moment. Nothing that happened while it was off is replayed.
- Disabling cancels everything still queued.
- Deleting removes the subscription and its delivery log.

### 4.2 Delivery

The worker job `webhook.tick` runs every 15 seconds on the CRM queue (`crm-import.worker.ts`). Each run does three things.

1. **Queue.** One `crm_webhook_deliveries` row per (subscription, matching event).
   - The pair is unique, so an event is queued once.
   - Events older than 24 hours are not queued.
2. **Send.** Due rows are claimed with a 2-minute lease (`FOR UPDATE SKIP LOCKED`), so several workers never send the same row.
   - Up to 50 rows per run, 5 at a time.
   - 10-second timeout per request.
3. **Retry.** Retryable failures are tried again after 1 min, 5 min, 30 min, 2 h and 6 h — 6 attempts in all — and then marked **Failed**.
   - Retried: timeouts, network errors, HTTP 408, 429 and 5xx.
   - Failed at once: other 4xx, any 3xx (`REDIRECT_REFUSED`) and blocked destinations.

Delivery is **at-least-once and not guaranteed**:

- A timeout may still have been processed by the receiver.
- An endpoint that stays down beyond the last retry misses the event. It can be redelivered from the log within 30 days.
- Events are not ordered; use `occurredAt`.

Finished deliveries are purged after 30 days.

**Subscription health:**

| Status | Meaning |
|---|---|
| Delivering | The last delivery succeeded. |
| Last delivery failed | The most recent delivery failed. |
| Needs attention | 3 or more failures in a row. Also shown on Overview and the integrations page. |
| No deliveries yet | Nothing has been sent. |
| Disabled | The subscription is turned off. |

### 4.3 Request format

```
POST <your URL>
Content-Type: application/json
User-Agent: FashionERP-CRM-Webhooks/1
X-CRM-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
Idempotency-Key: <delivery id — identical on every retry and redelivery>
X-CRM-Event-Id: <CRM event id>
X-CRM-Event-Type: lead.status_changed
X-CRM-Delivery-Id: <delivery id>
X-CRM-Delivery-Attempt: 1
```

```json
{
  "id": "<CRM event id>",
  "type": "lead.status_changed",
  "occurredAt": "2026-10-14T09:30:00.000Z",
  "test": false,
  "data": {
    "entity": { "type": "LEAD", "id": "<record id>" },
    "summary": "Status changed …",
    "payload": { "fromStatusId": "…", "toStatusId": "…" },
    "actor": { "userId": "<user id or null>" }
  }
}
```

**About the body:**

- The envelope identifies the record and the change; it does not include a full record snapshot.
- `payload` holds the event-specific data shown on the record timeline.

**What the receiver must do:**

1. Verify the signature over the **raw** body, comparing in constant time.
2. Reject timestamps more than 5 minutes old.
3. De-duplicate on `Idempotency-Key`.
4. Answer with any 2xx within 10 seconds.

A complete Express example is in Settings (and `RECEIVER_EXAMPLE_NODE` in `webhook-events.ts`).

### 4.4 Test, delivery log, redeliver, rotate

- **Test** sends one signed sample event immediately and shows the real result: "Delivered — HTTP 204 in 12 ms" or the failure reason.
  - The event is marked `"test": true` and uses synthetic ids.
  - It also works while the subscription is disabled.
  - It is never retried.
- **Deliveries** shows the delivery log.
  - Filter by status: Queued, Retrying, Delivered, Failed, Cancelled.
  - Each row shows attempts, the next try, the HTTP status, duration and the reason.
  - Page through older rows with "Show more".
- **Redeliver** queues a finished delivery again with the same `Idempotency-Key`. It works only while the subscription is active, and not for test deliveries.
- **Rotate secret** asks for confirmation, then shows the new secret once. The old secret stops working immediately.

### 4.5 API (`crm_settings.view` for GET, `crm_settings.edit` for everything else)

| Method & path | Notes |
|---|---|
| `GET /api/v1/crm/settings/webhook-subscriptions` | list (no secrets) |
| `POST /api/v1/crm/settings/webhook-subscriptions` | `{ name, description?, url, eventTypes[], isActive? }` → 201, with `secretOnce`, `no-store` |
| `GET /api/v1/crm/settings/webhook-subscriptions/events` | event catalogue |
| `GET /api/v1/crm/settings/webhook-subscriptions/{id}` | detail and per-status delivery counts |
| `PATCH /api/v1/crm/settings/webhook-subscriptions/{id}` | `{ version, name?, description?, url?, eventTypes?, isActive? }` — optimistic locking; no secret field |
| `DELETE /api/v1/crm/settings/webhook-subscriptions/{id}` | deletes the subscription and its log |
| `POST /api/v1/crm/settings/webhook-subscriptions/{id}/rotate-secret` | `{ version }` → `secretOnce`, `no-store` |
| `POST /api/v1/crm/settings/webhook-subscriptions/{id}/test` | `{ eventType? }` → `{ deliveryId, status, responseStatus, durationMs, message }` |
| `GET /api/v1/crm/settings/webhook-subscriptions/{id}/deliveries` | `?status=&skip=&take=` (take ≤ 100) → `{ rows, totalCount }` |
| `POST /api/v1/crm/settings/webhook-subscriptions/{id}/deliveries/{deliveryId}/redeliver` | → `{ queued: true }` |
| `GET /api/v1/crm/settings/overview` | Overview and integrations catalogue |

Every change is audited in `audit_logs` (`table_name = crm_webhook_subscriptions`): create, update, rotate (`secret: "rotated"`), delete, test and redeliver.

### 4.6 Data model

Migration `20261015100000_crm_webhook_subscriptions`:

- **`crm_webhook_subscriptions`**
  - Columns: `event_types text[]`, `is_active`, `active_since`, `secret_encrypted`, `secret_rotated_at`, health counters, `version`.
  - Unique on (company, name).
  - The URL must start with `http(s)://`.
- **`crm_webhook_deliveries`**
  - Status CHECK constraint.
  - Unique on (subscription, event).
  - Indexes on `(status, next_attempt_at)` and `(subscription_id, created_at)`.
  - The JSON `payload` is stored **only** for test deliveries, because they have no event row; it contains synthetic data only.

---

## 5. Integrations catalogue — status of every integration

Statuses are computed by `GET /api/v1/crm/settings/overview` (`crm-integrations-overview.service.ts`).

| Integration | Real? | Status source |
|---|---|---|
| Lead capture API (`/api/v1/crm/leads/ingest`) | yes | active, unexpired, unrevoked API keys; last used date |
| Incoming lead webhooks (generic signed) | yes | active endpoints; last lead received |
| Lead import (CSV / Excel) | yes | always available (`/crm/leads/import`) |
| Conversation channels (generic signed protocol plus a bridge you run) | yes | channels by status |
| Outgoing webhooks | yes (new) | active subscriptions; failing ones show **Needs attention** |
| Workflow automation (including "Call a webhook") | yes | published workflows |
| Message templates | yes | active templates |
| Meta Lead Ads | **Planned** | no connector — use an incoming webhook via Zapier, Make or n8n |
| IndiaMART lead sync | **Planned** | no connector — use the API or an incoming webhook |
| WhatsApp Cloud API, built-in | **Planned** | WhatsApp works today through a bridge (docs/crm/integrations/02-WHATSAPP.md) |
| Mailbox sync (Gmail / Microsoft 365) | **Planned** | email works today through a bridge (06-EMAIL.md) |

"Planned" items have no buttons that suggest they work. Each one points to the working alternative.

---

## 6. API access guide

**Settings → Integrations → API access** documents only what the ingest route does:

- **Authentication:** `Authorization: Bearer <key>` or `X-API-Key`. Keys have scope `leads:ingest`, an optional expiry and can be revoked.
- **Limits:** 100 KB body; 120 requests per minute per key.
- **Retries:** `Idempotency-Key` header, or `externalEventId` in the body.
- **Field mapping:** exact CRM keys, common aliases, and `unmappedFields` returned for anything not recognised.
- **Response codes:** 201 / 200 / 202 / 400 / 401 / 409 / 413 / 422 / 429.
- **Errors:** the envelope `{ error: { code, message, details } }`.

The examples use `YOUR_API_KEY` and the browser's own origin as the base URL. There is no other public CRM API; every other endpoint requires a signed-in session.

---

## 7. Security fixes in this phase

1. **Workflow secret reveal removed** (`crm-workflows.service.ts`, `workflows/[...path]/route.ts`, `WorkflowDetailClient.tsx`).
   - Rotation now returns the new secret once, with `no-store`. The UI shows it in `SecretOnce`.
   - **Migration note:** receivers that already hold a secret keep working. A team that needs the secret now has to rotate and update the receiver at the same time.
2. **Channel outbound URL SSRF guard** (`generic-webhook.provider.ts`).
   - In production, a URL whose host is an internal name or a private/loopback/link-local literal is refused when the channel is saved.
   - `checkOutboundDestination` re-checks DNS before every send. Blocked sends fail with `DESTINATION_BLOCKED` and are not retried.
   - Redirects were already refused (`redirect: "error"`).
   - The allow-list is shared (`CRM_WORKFLOW_WEBHOOK_ALLOWED_HOSTS`). Development (`NODE_ENV` ≠ production) may still use local bridges.
3. **`SecretOnce` false "Copied" fixed** and the stored-confirmation step added. This applies to API keys, incoming webhooks, channels, outgoing webhooks and workflows.
4. **Generic blocked-address message.** "only public URLs can be called" replaces "workflows can only call public URLs", because the sender is now shared.

---

## 8. Tests

| Suite | What it covers |
|---|---|
| `webhooks-out/webhooks-out.unit.test.ts` | The event catalogue equals the registry (minus drafts); envelope and sample shapes; retry schedule; failure classification (no internal addresses or receiver bodies leak); strict schemas with no secret field. |
| `webhooks-out/webhooks-out.integration.test.ts` | Runs against real Postgres and a real HTTP receiver: secret returned once and absent from list, detail, update, overview and audit; SSRF refusals (metadata, private, IPv6 loopback, credentials, ports, internal names); signed test delivery verified with the secret; real `lead.created` delivered once with the event id; no replay of older events; 5xx retry after back-off with the same Idempotency-Key; 400 fails at once; 302 refused and the redirect target never called; redeliver; rotation (old secret rejected, version conflict); disable cancels the queue and re-enable doesn't replay; overview statuses; workflow secret rotate-only; delete. |
| `core/communication/communication.test.ts` (extended) | Channel outbound SSRF: internal names and private literals refused in production; allow-list respected; a blocked send never calls `fetch`. |
| `components/crm/SecretOnce.test.tsx` | Copy success vs refusal (no false "Copied"); confirmation gate; leave-page warning; `CopyButton` failure. |
| `settings/_components/OutgoingWebhooksTab.test.tsx` | Masked status and no reveal control; the edit form contains no secret; the new secret is shown once and gone after Done, with no re-fetch; view-only users see no change buttons. |
| Browser test (Playwright against the dev server, 33 checks) | Navigation and overview, integration statuses, API docs and working copy, API key once plus confirmation, SSRF refusal in the form, create → secret once → test delivery verified by the receiver's HMAC → delivery log → rotate, no secrets in GET responses, URLs or browser storage, workflow reveal endpoint returns 404 and rotate-once works, mobile layout, viewer read-only (403 on create). |

**Regression run:**

- Full unit suite: 2,629 passed.
- All 18 database integration suites: 223 tests passed (including the Redis queue suite, run with `BULK_IT_REDIS_URL`).
- `tsc`: clean.
- ESLint: 0 errors. The only warnings are pre-existing ones outside the CRM.

---

## 9. Operations

- **Worker:** event delivery needs the CRM worker (`startCrmIngestWorker`), which schedules `crm-webhook-tick` every 15 s. Test deliveries are sent by the API and do not need the worker.
- **Environment variables:** no new ones. `CRM_WORKFLOW_WEBHOOK_ALLOWED_HOSTS` and `CRM_WORKFLOW_WEBHOOK_ALLOW_HTTP` now also govern outgoing webhooks, and channel outbound URLs in production. Never set `ALLOW_HTTP` in production.
- **Encryption key:** secrets are encrypted with the key derived from `AUTH_SECRET` / `NEXTAUTH_SECRET`, as before. Changing it makes stored webhook, channel and workflow secrets unreadable, and they must all be rotated.

## 10. Limitations and launch checks

- **Delivery isn't guaranteed.** It is at-least-once with 6 attempts over about 8.6 hours. Events older than 24 hours when the worker next runs (e.g. after a long worker outage) are not queued.
- **Throughput:** about 50 deliveries per 15 s per worker, sent 5 at a time. That is enough for normal CRM volume; bulk changes produce one event per record and may take minutes to drain.
- **Payloads are envelopes, not record snapshots.** Receivers fetch details separately. There is no public read API yet; for now, receivers use the ids, summary and timeline payload.
- **No per-subscription filters** (e.g. by pipeline or owner) beyond the event type.
- **Channel outbound sends check DNS just before `fetch`,** rather than pinning the connection as the workflow / outgoing webhook sender does. A short DNS-rebinding window remains; redirects are still refused.
- **Before launch:**
  1. Check that existing channel outbound URLs are public https addresses, or allow-list them, because production now refuses private addresses.
  2. Tell any team using a workflow webhook secret that Reveal is gone.
  3. Make sure the CRM worker runs in production.
- Users and roles are still managed in Administration; the Users & access section explains them but doesn't edit them.
