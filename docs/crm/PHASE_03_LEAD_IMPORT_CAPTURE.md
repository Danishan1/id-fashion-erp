# CRM Phase 03 — Lead Import & Capture: Report & Test Checklist

_Date: 2026-10-02 · Branch: `crm-marketing-rebuild-v1` (on top of c1500ca) · Not committed yet._

## Decisions applied

| Topic | Decision |
|---|---|
| External API auth | **CRM API keys.** Created in CRM Settings and shown once. Stored as a SHA-256 hash, revocable, optional expiry, scope `leads:ingest`. A signed-in user with `crm.create` can also call the API. |
| UPDATE policy | **Fill empty fields only.** Nothing already entered is overwritten. Source attribution (source, UTM, campaign, referral, capture channel) is never changed. A *different* requirement is added as a note, not dropped. Tags are only added. |
| Webhooks | **Generic signed webhook.** Per-endpoint URL plus HMAC-SHA256 secret (encrypted at rest), optional JSON field mapping, idempotent inbox with retry. Meta, IndiaMART and other providers plug in later as adapters. |
| Access | **Imports and history:** `crm.create`. Users see their own imports; `crm.view_all` sees all. **API keys, webhooks and the submission log:** `crm_settings.view` to see, `crm_settings.edit` to change or review. |

## Architecture

```
Manual form ──► captureManualLead ─────────────────────────────┐
CSV / XLSX rows ─► import worker ─┐                            │
REST API  ───────► ingest route ──┤                            │
Webhook ─► adapter (verify+map) ──┤                            ▼
Future Meta / IndiaMART adapters ─┴─► Lead Ingestion Service ─► lead.service
                                       normalize → resolve → validate          createLead / fillEmptyLeadFields
                                       → duplicates (leads, contacts, external id) (audit + timeline in one tx)
                                       → policy SKIP / UPDATE / CREATE / FLAG
```

| Part | Where | What it does |
|---|---|---|
| Lead Ingestion Service | `src/modules/crm/ingestion/lead-ingest.service.ts` | `prepareLead` (normalize, resolve status/source/owner by name, validate incl. custom fields), `findIngestDuplicates`, `ingestPreparedLead` (policy and write), `ingestLead` (one call), `resolveFlaggedLead` (review), `captureManualLead`. Never throws for data problems: every record ends **IMPORTED / UPDATED / SKIPPED / FLAGGED / FAILED** with a reason. |
| Mapping engine | `ingestion/lead-field-catalog.ts` (client-safe) | One field catalog with aliases ("Mobile No", "Email ID", "Customer Name"…) used by the wizard, the API and webhooks. Includes `suggestLeadMapping` and `validateLeadMapping` (needs a name or company plus a contact column; no field mapped twice). Custom fields map as `cf:<key>`. |
| Normalizer | `ingestion/lead-normalizer.ts` (pure) | Trim and collapse whitespace, treat N/A / NA / NULL / - and configured tokens as empty. Lower-case emails; a second email moves to the alternate email. Phones (see rules below). ALL-CAPS person names re-cased (company names never). Values like "₹ 1,50,000" become numbers. Hot / Warm / Cold (and High / Medium / Low). Dates as dd/mm/yyyy, mm/dd/yyyy, ISO or "5 Oct 2026"; impossible dates such as 31/02 are rejected. |
| File reader | `imports/import-file.ts` | CSV / XLSX by extension plus magic bytes. Rejects legacy .xls, binaries, damaged or mislabelled ZIPs and empty, header-only or header-less files. Decodes UTF-8 (with BOM), UTF-16 and Windows-1252. Detects comma / semicolon / tab / pipe. Repeated or blank headers are renamed; extra cells are kept under generated headers, never cut off. Limits: 20 MB, 25,000 rows, 100 columns. |
| Import jobs | `imports/crm-import.service.ts`, `crm-import.worker.ts` | Statuses: PENDING → VALIDATING → READY → PROCESSING → COMPLETED / PARTIALLY_COMPLETED / FAILED / CANCELLED. Every file line becomes a `crm_import_rows` row at upload, so preview, review, progress and the error file are all database reads. Validation is inline for ≤1,000 rows and in the background above that. Processing is always in the background. |
| Background jobs | Existing BullMQ / Redis worker (`npm run worker`, started by `npm run dev`) | New queue `crm-lead-ingest-<db hash>`, isolated per database like the bulk-import queue. Jobs: `import.validate`, `import.process` (3 attempts, resumable), `ingest.retry`, daily `import.cleanup` (02:15). |
| API ingestion | `POST /api/v1/crm/leads/ingest` | API key (`Authorization: Bearer crmk_…` or `X-API-Key`) or session. 100 KB body limit, 120 requests/min per key. `Idempotency-Key` header. Fields flat or under `lead`, exact names or aliases; unknown fields are reported back. Returns 201 / 200 / 202 / 422 / 401 / 429. |
| Webhooks | `POST /api/v1/crm/webhooks/leads/{provider}/{endpointId}` | Adapter registry (only `generic` for now). Signature `X-CRM-Signature: sha256=HMAC(secret, "<ts>.<body>")` plus `X-CRM-Timestamp` (5-minute window). Optional `X-CRM-Event-Id`. One lead or `{ "leads": [...] }` (≤50). 256 KB limit, 300 requests/min per endpoint. Unknown or paused endpoints, or ones whose creator is deactivated, return 404. |
| Ingest inbox | `capture/crm-ingest-events.service.ts` | Every API or webhook submission is stored first: redacted payload, mapped fields, settings used. Then it is processed. Unexpected failures retry automatically (1 min → 5 min → 30 min → 2 h → 12 h, 5 attempts). A re-delivery of a failed event retries at once; data problems are final. Flagged submissions can be reviewed. |
| Adapter contract | `capture/providers/lead-provider-adapter.ts` | `verifySignature` plus `parse` → mapped records. A provider is one file plus one registry line; adapters never write leads themselves. |

**Phone rule:** keep digits and a leading `+`; `00…` becomes `+…`; a trunk `0` before a 10-digit mobile is dropped. No country code is ever guessed (the ERP rule from `src/lib/communication.ts`). Landlines keep their STD code. Duplicate matching uses the last 10 digits.

### Duplicate strategy

Phase 02's duplicate rules apply everywhere (EMAIL / PHONE / COMPANY_AND_EMAIL / COMPANY_AND_PHONE; WARN / BLOCK / OFF).

**Checks:**

- **Within the file:** a repeat of an earlier row is flagged in the preview. While processing, the earlier row's lead is in the database, so the policy applies to it.
- **Against existing leads:** for imports, one indexed query per 500 rows.
- **Against CRM contacts:** email and phone.
- **Same external id** (provider plus external lead id, e.g. an "Enquiry ID" column, `externalLeadId`, or a webhook `id`): the same external lead is never ingested twice.

**Policies:**

- **SKIP** — reason names the matched lead.
- **UPDATE** — fill empty fields as described above. Several matches → FLAGGED (choose which). An archived-only match → SKIPPED. A match the importer can't see (own-scope user) → FLAGGED for a manager. Nothing new to add → SKIPPED ("already has this information").
- **CREATE** — creates despite a WARN match. BLOCK rules still win (SKIPPED with a reason).
- **FLAG_FOR_REVIEW** — nothing is written; decide per row afterwards (Create / Update matching lead / Skip).

A match with only a contact creates the lead linked to that contact under UPDATE or CREATE; SKIP and FLAG treat it as a duplicate. Nothing is ever merged automatically.

## Database (migration `20261002100000_crm_lead_import_capture`)

- **New enums:** CrmLeadCaptureChannel (MANUAL, CSV, XLSX, WEBSITE_FORM, API, WEBHOOK, INTEGRATION), CrmImportFileType, CrmImportJobStatus, CrmDuplicatePolicy, CrmImportRowValidation, CrmIngestOutcome, CrmIngestEventStatus.
- **`crm_leads`** gains:
  - `capture_channel` (default MANUAL; existing leads become MANUAL; set once, never changed)
  - `capture_provider`
  - `import_job_id`
- **New tables:**
  - `crm_import_jobs`
  - `crm_import_rows` (one per file line)
  - `crm_lead_external_refs` (unique company + provider + external id)
  - `crm_ingest_events` (unique company + provider + idempotency key)
  - `crm_api_keys`
  - `crm_webhook_endpoints`
- **Data steps:**
  - Adds the system lead source **Trade portal** for companies already using the CRM.
  - **Fixes a Phase 02 numbering bug.** Lead and opportunity numbers came from per-branch sequences, so a user with a default branch and one without (or a webhook) could both get `LEAD-2026-00001`. The migration folds them into one company-wide sequence that continues after the highest number already issued, and the code now always numbers CRM records per company.

## API endpoints

### Imports (`crm.create`)

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/crm/imports` | History (own imports, or all with `view_all`). |
| `POST /api/v1/crm/imports` | Upload (multipart `file`). Nothing is imported yet. |
| `GET /imports/:id` | Job with mapping, sample rows and mapping issues. |
| `PATCH /imports/:id` | Mapping, source, policy and options. A policy-only change keeps the preview. |
| `POST /imports/:id/validate` | Build the preview. |
| `GET /imports/:id/rows` | Rows. Filters: validation, outcome, duplicates, problems. |
| `POST /imports/:id/start` | Start (202). |
| `POST /imports/:id/cancel` | Cancel. |
| `POST /imports/:id/review` | Decide flagged rows. |
| `GET /imports/:id/error-file?format=csv\|xlsx&which=problems\|all` | Error or results file. |

### Capture

| Endpoint | Access |
|---|---|
| `POST /api/v1/crm/leads/ingest` | API key or session |
| `POST /api/v1/crm/webhooks/leads/{provider}/{endpointId}` | Public, signed |
| `GET /api/v1/crm/settings/api-keys`, `POST` (key shown once) | `crm_settings` view / edit |
| `PATCH /settings/api-keys/:id`, `DELETE` (revoke) | `crm_settings.edit` |
| `GET /api/v1/crm/settings/webhooks`, `POST` (secret shown once) | `crm_settings` view / edit |
| `PATCH /settings/webhooks/:id`, `POST /settings/webhooks/:id/rotate-secret` | `crm_settings.edit` |
| `GET /api/v1/crm/ingest-events`, `GET /ingest-events/:id` | `crm_settings.view` |
| `POST /ingest-events/:id/review`, `POST /ingest-events/:id/retry` | `crm_settings.edit` |

`POST /api/v1/crm/leads` (manual form) now enters through `captureManualLead`, with the same behaviour as before.

## UI

- **Navigation:** CRM → Leads, **Import Leads**, **Import History**, Activity Log, Settings. The leads list has an **Import** button and new filters, **Captured via** and **Import ID** ("View imported leads" links straight to them).
- **Import wizard** (`/crm/leads/import`, resumable with `?job=`):
  1. **Upload:** drag and drop, plus a sample file.
  2. **Source:** lead source, default owner, tags for every lead, date order, extra empty values, name tidy-up.
  3. **Map columns:** suggested matches, sample values, custom fields, Ignore, live required-field checks.
  4. **Preview:** counts and row table filtered by errors / warnings / duplicates.
  5. **Duplicates:** the four policies, explained.
  6. **Import:** confirmation summary, then live progress (%, x / y) with Cancel.
  7. **Result:** counts, error file (CSV / Excel), full results, link to the imported leads.
- **Import history and detail:** every row with status, reason and lead link. Flagged rows can be selected and decided. A second tab, **API & webhook submissions**, has a status filter and a drawer showing the redacted payload, mapped fields, attempts, and review / retry.
- **CRM Settings:** new tabs **API keys** (create / edit / revoke; key shown once with an example request) and **Webhooks** (create / edit mapping and defaults / pause / new secret; secret shown once with a signing example).
- **Lead detail:** "Captured via" (CSV import · file name, or API / webhook) and any external ids.

## Security

- **API keys:** stored hashed and compared in constant time. They stop working when revoked, expired, or when the creator is deactivated.
- **Webhook secrets:** encrypted with the existing AES-GCM helper. Signatures are verified in constant time with replay protection.
- **Rate limits and size limits** on all public endpoints. Errors don't reveal whether an endpoint exists.
- **Stored submissions:** password, token, secret, API key, authorization and signature fields are redacted. Secrets are never logged or returned after creation (`Cache-Control: no-store`).
- **Uploads:** checked by extension and magic bytes. Content is never executed; cells are plain text. Error and result files neutralise formula-like cells (`=`, `+`, `-`, `@` get a leading `'`).
- **Temporary files:** kept via the existing private FileStorage and removed when the import finishes (or after 7 days if it was never started). Rows stay for history.
- **Scoping:** import history is limited to the importer unless they have `view_all`. Every query is company-scoped. Reviewing an update only touches leads the reviewer can see.

## Automated verification (sandbox copy, identical to your repo before this phase)

- **Vitest:** 131 files; **2,185 passing**, 0 failing. The 34 database tests skip without a test DB.
- **Against a real Postgres** (`CRM_IT_DATABASE_URL`): CRM suites **113 passing**, repeatable. The new Phase 03 integration suite has 18 tests:
  - Upload and mapping suggestions.
  - Preview with errors, in-file and existing duplicates.
  - SKIP / UPDATE / CREATE (incl. BLOCK) / FLAG_FOR_REVIEW and review (update, create, skip).
  - XLSX, contact linking, re-import of the same external id.
  - Bad files (empty, header-only, headerless, .xls, binary, fake .xlsx, PDF).
  - Windows-1252 + semicolon files.
  - Cancel before and during processing (no row left without an outcome).
  - Error file (reasons, formula safety).
  - History privacy.
  - API: key auth, idempotent replay, external id, 422, 401, revoke.
  - Webhook: bad / old signature, delivery, replay, repeated external lead, secret rotation, unknown provider.
  - Flagged API review and redaction; manual capture.
  - Policy-only change keeps the preview.
  - Company-wide numbering.
  - Re-delivery retries a failed submission.
- **Unit tests** for the normalizer, mapping engine, file reader, generic adapter, API body mapping, key generation, redaction and rate limiting.
- **Static checks:** `next typegen` + `tsc` are clean. ESLint has 0 errors (the same 12 pre-existing warnings).
- **Migrations:** all 154 apply to an empty Postgres 16 DB, the seed runs, and tables / columns / enums match the schema. A Phase 02 database with data also upgrades in one pass (sequences consolidated, existing leads MANUAL, Trade portal added).
- **Browser test** (headless Chromium + real Redis + worker):
  - 1,500-row messy CSV: auto-mapped 7 / 8 columns; background validation: 1,175 valid, 310 warnings, 15 errors, 21 duplicates.
  - Import with UPDATE: 1,464 imported, 21 updated, 15 failed with reasons. The error file downloads.
  - FLAG import, then review → updated.
  - API key created; API 201, replay 200 + `Idempotent-Replayed`, bad key 401.
  - Webhook created; signed delivery accepted, bad signature 401.
  - The automatic retry recovered a failed submission.
  - Lead shows "Captured via CSV import · leads-1500.csv".
  - A merchandiser sees only their own imports, has no submissions tab, and gets 403 on the settings APIs and 404 on another user's import.
  - No page errors.

  The browser run found and fixed:
  - the numbering collision;
  - the preview being reset when only the policy changed (Postgres `jsonb` reorders keys);
  - the landline trunk-zero handling;
  - invalid dates rolling over;
  - re-deliveries of failed events now retry.

## Manual test checklist (your machine)

```powershell
npx prisma generate
npx prisma migrate deploy        # applies 20261002100000_crm_lead_import_capture
npm test
npm run dev                      # starts Next.js AND the worker (Redis from REDIS_URL)
```

> Imports and webhook retries run in the worker. If an import stays at 0 %, check that the `worker` pane of `npm run dev` shows `CRM ingest worker started`.

1. **CRM → Import Leads → Download a sample file.** Add ~10 rows, including:
   - a bad email
   - a row with no email or phone
   - two rows with the same mobile
   - one row with the email of an existing lead

   Save it as CSV and as XLSX.
2. **Upload → Source:** pick a source, add tag `fair-2026` → **Map columns:** check the suggestions, set one column to Ignore → **Check rows.**
3. **Preview:** the Errors filter shows the bad rows with reasons; Possible duplicates shows the repeat and the existing-lead match.
4. **Duplicates → Skip duplicates → Start import.** Watch the progress. Result: counts add up to the total. Download the **error file (CSV and Excel)**: the original columns plus Import Status / Error Reason / Duplicate Information.
5. Click **View imported leads** (list filtered by import). Open one: "Captured via CSV import · <file>" and the tag.
6. Import the same file again with **Update existing leads**. Matching leads only get empty fields filled; a different requirement appears as a note.
7. Import again with **Flag for review** → open it from **Import History** → Flagged → select rows → **Update matching lead / Create new lead / Skip.**
8. Upload the XLSX version; also try a `.xls`, an empty file and a file without a header row (clear messages).
9. Start a larger import and press **Cancel import**. Unprocessed rows show "Import cancelled…".
10. **CRM Settings → API keys → Create API key.** Copy the key and run the example request (PowerShell users: use the curl in Git Bash or Postman). 201 with a lead number. Send it again with the same `Idempotency-Key` → 200, same lead. Revoke the key → 401.
11. **CRM Settings → Webhooks → Create webhook.** Use the signing example (Git Bash) → 200. Change one character of the signature → 401. **Import History → API & webhook submissions** lists both, with details in the drawer.
12. As a user without `crm_settings` (e.g. a merchandiser): Import works, history shows only their own imports, no submissions tab, and the Settings tabs aren't available.
13. **Regression:** create a lead manually (duplicate warning still works), Leads list and filters, the Masters bulk import, Dashboard, Sales Orders → New.

## Known limitations / deferred

- **Parsing in memory:** a file (≤20 MB) is parsed in memory once at upload (exceljs / the CSV parser). Rows are then processed in database chunks of 100–500, so memory stays flat during processing. True streaming upload parsing can come with the performance phase.
- **Per-row processing:** each row is processed individually (duplicate re-check plus its own transaction). That's about 1,500 rows in roughly a minute in the sandbox, fine for the 25,000-row limit. Batched writes are a later optimisation.
- **Lead and row are written separately:** if the worker crashes between creating a lead and saving that row's outcome, the retry finds the lead as a duplicate of an earlier row of the same file and reports it, rather than creating it twice.
- **Rate limits are in-memory** (single instance), like the login limiter.
- **Concurrent submissions:** two different submissions for the same new person arriving at the same instant can both create a lead (no event id or external id to tie them). Same-event and same-external-id repeats are always caught.
- **Not built (out of scope):** Facebook / Meta, IndiaMART, Google, LinkedIn and trade-portal connectors, provider OAuth or credentials, a website form builder, workflows. The adapter interface, registry, external-ref table, capture channels and system sources (facebook, instagram, indiamart, google, linkedin, trade_portal, website) are ready for them.

## Future integration points

- **New connector:** implement `LeadProviderAdapter` (`verifySignature`, `parse`), register it in `capture/providers/registry.ts`, and give it a default source key. The webhook route, inbox, idempotency, retries, duplicate rules and review are reused unchanged. Pull-based providers (IndiaMART's pull API, Meta lead fetch) can enqueue `ingestLead` calls from a scheduled worker job with `channel: INTEGRATION`.
- **Website forms:** post to `/api/v1/crm/leads/ingest` with `channel: "WEBSITE_FORM"` and an API key, or use a signed webhook. A visual form builder can later generate either.
- **Workflows (later phase):** subscribe to `lead.created` / `lead.updated` events. Their payloads now carry `channel`, `provider` and `importJobId`.

## CLAUDE.md entry (already appended on your machine)

```markdown
## CRM rebuild — Phase 03 Lead Import & Capture (2026-10-02)
- Every non-interactive lead source goes through `src/modules/crm/ingestion/lead-ingest.service.ts` (normalize → resolve → validate → duplicates → SKIP/UPDATE/CREATE/FLAG_FOR_REVIEW → lead.service). Never create leads directly from an import/API/webhook/adapter. Manual form: `captureManualLead`.
- Field catalog + auto-mapping: `ingestion/lead-field-catalog.ts` (client-safe, shared by wizard/API/webhooks; custom fields `cf:<key>`). Normalizer rules in `lead-normalizer.ts` (never guess a phone country code).
- Imports: `crm_import_jobs` + one `crm_import_rows` row per file line (every row ends IMPORTED/UPDATED/SKIPPED/FLAGGED/FAILED). Validation inline ≤1000 rows, else queued; processing always in the worker (`crm-import.worker.ts`, queue `crm-lead-ingest-<db hash>`, registered in `src/core/jobs/worker.ts`).
- UPDATE = fill empty fields only (`fillEmptyLeadFields`); source attribution and `capture_channel` never change after create.
- Capture: API keys (hashed, `crmk_…`), signed generic webhooks (adapter registry `capture/providers/`), inbox `crm_ingest_events` (idempotency key unique per provider, external ids in `crm_lead_external_refs`, retries via `ingest.retry`).
- CRM document numbers (CRM_LEAD, CRM_OPPORTUNITY) are company-wide: always `branchId: null`.
- Report: `docs/crm/PHASE_03_LEAD_IMPORT_CAPTURE.md`.
```
