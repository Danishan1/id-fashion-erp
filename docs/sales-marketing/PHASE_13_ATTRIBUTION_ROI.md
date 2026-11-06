# Sales & Marketing — Phase 13 Campaign attribution and ROI (2026-11-06)

Spec: `docs/sales-marketing/ref/13.md`. Scope confirmed with the user on 2026-11-06:

- **Touchpoints:** campaign tags on records plus message deliveries. These are only what the ERP really captures: the campaign set on a lead, enquiry, quotation or Sales Order, and campaign messages accepted or delivered per contact (Phase 10). No open or click tracking was added.
- **Models:** all five — first touch, last touch, linear, position-based and time decay — each with a written formula and tests.
- **Conversions:** lead created, enquiry received, quotation accepted, Sales Order booked. The revenue basis is chosen per report: Sales Order value, invoiced value (posted sales invoices) or accepted-quote value, all before GST.
- **Control:** a new permission module, `marketing_attribution`. A model version is approved by someone other than its author before it can be used; recalculating needs `edit`.

**Attribution shares credit for an outcome by a stated rule. It does not show that a campaign caused the outcome.** Every screen and report says so.

Out of scope (later phases): bulk tools (14), workflow orchestration (15), public integrations (16), general BI (17), AI / predictive attribution (18).

## 1. Sources (what exists and is used)

| Concept | Authoritative source | Reused |
|---|---|---|
| Campaign | `marketing_campaigns` (Phase 08) | yes, by id |
| Message touch | `marketing_deliveries` (+ run → campaign, channel, provider), Phase 10 | yes, by id |
| Campaign response | `campaign_id` on `crm_leads`, `buyer_enquiries`, `quotations`, `sales_orders` (Phase 08 link) | yes |
| Person / account | `crm_contacts` → `crm_companies.customer_id` → `customers` (existing links) | yes |
| Conversions | leads, enquiries, accepted `quotation_revisions`, booked `sales_orders` (same "booked" rule as Phase 05) | yes |
| Revenue | Sales Order `base_total_amount`; posted `sales_invoices` (Phase 05 "invoiced" statuses) subtotal × exchange rate; accepted revision `taxable_total` | yes |
| Spend | Phase 12 actual: approved expenses + posted purchase invoices linked to the campaign | yes (`measureBudgets`, now with an optional date range) |

What is **not** captured and so not used: email opens and clicks, ad impressions and clicks, website visits, provider billing. Phase 10 delivery events carry only delivery status; there is no link tracking and no ad-platform cost import.

## 2. Data model (migration `20261108090000_marketing_attribution_phase13`, rollback in `prisma/rollback/`)

- **`marketing_attribution_models`** — header.
  - Fields: code; name; DRAFT / ACTIVE / RETIRED; one default per company (partial unique index); `approved_version_id`.
  - CHECKs: ACTIVE needs an approved version; the default must be ACTIVE.
- **`marketing_attribution_model_versions`** — the rules.
  - Type; window in days (1–730); touch types; message channels; conversion types; collapse repeats; first / last % (position-based); half-life (time decay).
  - Lifecycle: DRAFT → PENDING_APPROVAL → APPROVED | REJECTED; APPROVED → SUPERSEDED.
  - CHECKs on every parameter. The decider is neither the creator nor the submitter. One open version per model.
  - Trigger `marketing_attribution_versions_frozen`: a decided version never changes.
- **`marketing_touchpoints`** — normalised touches.
  - Source (DELIVERY / LEAD / ENQUIRY / QUOTATION / SALES_ORDER + id); type; campaign (FK); channel; provider.
  - `identity_keys` (typed record ids, GIN index); `occurred_at`; VALID | EXCLUDED with a reason; ingested / updated times.
  - Unique (company, dedup key).
- **`marketing_conversions`** — one row per (company, type, source record).
  - Fields: reference number; conversion moment; business date; identity keys; ACTIVE / REVERSED / REMOVED; quoted / order / invoiced value (DECIMAL 18,2); currency.
- **`marketing_attribution_runs`** — one calculation of one approved version over a period of conversion dates.
  - Fields: status; counts; data-quality summary (JSON); `sources_synced_at` (the data cut); idempotency key.
  - Partial unique index: one QUEUED / RUNNING run per model version.
- **`marketing_attribution_results`** — one per (run, conversion): ATTRIBUTED / UNATTRIBUTED / EXCLUDED, reason, window start, the values used.
- **`marketing_attribution_credits`** — one per (result, touchpoint): campaign, touch type, channel, position, weight (DECIMAL 12,10, > 0), quoted / order / invoiced credit.
- Results and credits are never updated (trigger `marketing_attribution_*_immutable`). A recalculation is a new run.
- **`marketing_attribution_checkpoints`** — how far each source has been read.

No contact names, e-mails, phone numbers or message content are stored. Identity keys are record ids only.

## 3. Touchpoints and conversions (`attribution-sync.service.ts`)

**Sync** reads each source from its checkpoint (records whose `updated_at` moved, with a 5-minute overlap):

- It upserts on the stable key and skips unchanged rows.
- It is safe to repeat or run concurrently; a full re-sync of unchanged data changes 0 rows (tested).
- Sync runs before every calculation and every 30 minutes in the worker, and can also be started from the API.

| Touch | Rule |
|---|---|
| MESSAGE_SENT | A delivery the provider accepted (`accepted_at`). Not proof it arrived or was read. |
| MESSAGE_DELIVERED | The provider confirmed delivery (time = delivered time). A model choosing "message sent" also counts delivered messages. |
| Excluded | Bounced / rejected / failed after acceptance. |
| CAMPAIGN_RESPONSE | The campaign set on a lead / enquiry / quotation / Sales Order, at the record's creation time. Changing or removing the campaign excludes the old touch. |

| Conversion | Counts when | Moment | Value | Reversal |
|---|---|---|---|---|
| LEAD_CREATED | lead exists | created at | — | — |
| ENQUIRY_CREATED | enquiry exists | created at | — | — |
| QUOTATION_ACCEPTED | a revision is ACCEPTED | end of the customer decision date (India time) | accepted revision taxable total | none (acceptance is final) |
| SALES_ORDER_BOOKED | status CONFIRMED…CLOSED, or ON_HOLD from one of those | end of the order date (India time) | base total (before GST); invoiced = Σ posted invoices subtotal × rate | cancelled / back to draft → REVERSED |

One business outcome is one conversion row per type. A Sales Order is counted once as SALES_ORDER_BOOKED; its invoices only change that row's invoiced value, never adding a second conversion.

**Identity (deterministic only).** A touch reaches a conversion when they share an identity key:

| Record | Identity keys |
|---|---|
| Delivery | CONTACT (the recipient), CUSTOMER (via the contact's CRM company link) |
| Lead | LEAD, CONTACT |
| Enquiry | ENQUIRY, CONTACT, CUSTOMER |
| Quotation | QUOTATION, ENQUIRY (source enquiry), CONTACT, CUSTOMER |
| Sales Order | ORDER, CUSTOMER, QUOTATION (source quotation), ENQUIRY |

There is no matching on names, e-mails or phone numbers. Customer-level matching is account-based: a message to any contact of the customer's CRM company counts for that customer's orders.

## 4. Models and formulas (`attribution-math.ts`)

**Eligibility.** A touch counts when all of these hold:

- it is VALID;
- it is of an allowed type, and, for a message, of an allowed channel;
- it shares an identity key with the conversion;
- `conversion − window ≤ occurred_at ≤ conversion`. Both ends are included; later touches never count.

Times are event times; ingestion time is kept for diagnostics only.

**Order:** by time, then id (deterministic ties).

**Repeats (optional):** one touch per (campaign, touch type) — the earliest for first touch, otherwise the latest.

For n eligible touches in order:

| Model | Weights |
|---|---|
| First touch | w₁ = 1 |
| Last touch | wₙ = 1 |
| Linear | wᵢ = 1/n |
| Position-based (f, l %) | n = 1: 1. n = 2: f/(f+l), l/(f+l) (½ each if both 0). n ≥ 3: w₁ = f, wₙ = l, middle (1 − f − l)/(n − 2) each |
| Time decay (half-life h days) | rawᵢ = 2^(−ageᵢ/h), age = days before the conversion; wᵢ = rawᵢ / Σ raw |

**Precision.** Weights are rounded to 10 decimals, and the rounding difference goes to the largest weight (the earliest on a tie), so they add up to exactly 1. Zero weights (e.g. middle touches at 50/50) produce no credit row.

**Money.** The value × weight is computed in paisa with largest-remainder rounding (ties to the earlier touch), so the credits add up to **exactly** the value. Each run checks this and reports any mismatch; there were none in tests.

**No eligible touch** → UNATTRIBUTED. Credit is never given to a campaign by default.

## 5. Runs, recalculation and history

- **Recalculate** (manual, `edit`) or the nightly job (last 365 days, every ACTIVE model) creates a new run for the model's current approved version.
- **Run steps:** sync → claim (QUEUED → RUNNING, guarded) → batches of 400 conversions → results + credits written per batch in a transaction → COMPLETED with counts and data-quality summary.
- **Failure:** the run is FAILED and its partial results are deleted. Reports keep using the previous completed run.
- **Safeguards:**
  - one queued / running run per version;
  - idempotency keys on requests;
  - a run can be executed only once (tested with two concurrent executions);
  - stuck runs are failed after an hour, and lost queued runs re-queued, by the recovery job.
- **Late events, corrections, reversals:** picked up by the next sync. The report says **Out of date** when conversions or touches changed after the run's data cut. A new run then reflects them, while the old run keeps its own results (tested).
- **Model changes:** an approved version is frozen, and every run records its version. A new approved version applies only to new runs; reports wait for a run under the current version and never mix versions (tested).
- **Retention:** the newest 3 completed runs of each version keep their results and credits. Older runs keep only their totals (status PURGED). Touchpoints and conversions are kept as references to their source records.

## 6. Metrics (`attribution-report.service.ts`)

Reports read the newest COMPLETED run of the model's current version, filtered to conversions whose business date is in the period. The period is limited to the run's range, and the report says when it is.

| Metric | Definition |
|---|---|
| Credited conversions | Σ credit weights per campaign and conversion type (a conversion shared by two campaigns counts ½ each) |
| Attributed revenue | Σ money credits on the chosen basis (order / invoiced / accepted-quote value), before GST |
| Actual spend | Phase 12 actual: approved / partly paid / paid expenses + posted purchase invoices linked to the campaign, **dated in the period**. Budgets, budget lines and committed POs are **not** spend (committed is shown separately). |
| ROI (revenue-based) | (attributed revenue − actual spend) ÷ actual spend × 100. **Not profit.** "n/a" when spend is 0 or unknown. |
| ROAS | attributed revenue ÷ actual spend; same rule |
| Cost per lead / order | actual spend ÷ credited leads / orders; "n/a" when either is 0 |
| Coverage | attributed ÷ (attributed + unattributed) conversions in the period |
| Messages delivered / records tagged | VALID touches in the period (counts, not people) |

**Currency.** Everything is INR (company base currency), as in the rest of the ERP:

- invoice amounts use the invoice's stored exchange rate;
- Sales Order amounts are stored base totals;
- nothing is summed across currencies.

## 7. Screens and reports

- **Sales & Marketing → Attribution & ROI**:
  - filters: model, compare-with model, revenue basis, period;
  - totals, conversions by type (credited / unattributed / excluded), the campaign table, and a channel breakdown (costs aren't split by channel);
  - data-quality notices (out of date, partial period, no spend, committed spend, hidden campaigns), source freshness;
  - **Recalculate**.
- **Campaign drill-down**:
  - every credited conversion, with this campaign's share and the full ordered list of touches that shared it (campaign, kind, channel, time, weight);
  - record numbers and links only for modules the viewer can open — otherwise "Hidden — no access" with no amounts;
  - no person data.
- **Models**:
  - list and create;
  - detail with versions (edit draft, submit, approve / reject, return to draft, new version), make default, retire, recalculate, the run list and history.
- **Report Center → Sales & Marketing**: *Campaign Attribution & ROI* and *Attribution Model Comparison* (each model in use side by side), with the existing export / PDF.
- **Visibility:** campaign visibility follows the Campaigns screens (owner / team / `view_all`). Credit to campaigns the viewer can't see isn't listed (a notice says so).

## 8. Security, privacy, audit

- **Permissions:** new module `marketing_attribution`.

  | Role | Actions |
  |---|---|
  | SUPER_ADMIN | all |
  | MANAGEMENT | view, create, edit, approve, reject, export |
  | MERCHANDISER | view, export |
  | VIEWER | view |

  `approve` also governs making a model the default; `edit` governs recalculation and sync.
- **Tenant isolation:** every query is company-scoped. Cross-company access is refused (tested).
- **Privacy:**
  - only record ids are stored;
  - drill-downs show business documents, not people;
  - the touches come from messages already sent under Phase 10 consent rules, and from records users created; no new tracking was added.
  - **Not done:** no new consent category for analytics. It isn't a separate consent in this ERP, so it should be confirmed with the company's privacy policy.
- **Audit:** model create, change, submit, approve, reject, default and retire, plus recalculation requests, go to `audit_logs` and the model history (`sales_performance_events`, entity ATTRIBUTION_MODEL).

## 9. Code map

- `src/modules/sales-marketing/attribution/`:
  - `attribution-registry.ts` (client-safe types, labels, schemas);
  - `attribution-math.ts` (eligibility, weights, money, ROI);
  - `attribution-sync.service.ts`;
  - `attribution-model.service.ts`;
  - `attribution-run.service.ts`;
  - `attribution-report.service.ts`;
  - `attribution-jobs.worker.ts`;
  - tests: `attribution-math.test.ts`, `attribution.integration.test.ts`.
- `src/modules/sales-marketing/budgets/budget.service.ts`: `measureBudgets(…, period)` — spend dated in a period.
- APIs under `/api/v1/sales-marketing/attribution`:
  - report (GET);
  - `campaigns/[campaignId]`;
  - `models` (list, create);
  - `models/[id]` (get, patch);
  - `models/[id]/[set-default|retire]`;
  - `models/[id]/versions`, `versions/[versionId]`, `versions/[versionId]/[submit|return-to-draft|approve|reject]`;
  - `models/[id]/runs` (POST: queue a recalculation);
  - `runs/[runId]`;
  - `sync`.
- UI:
  - `src/components/sales-marketing/attribution/*`;
  - pages under `src/app/(dashboard)/sales-marketing/attribution`;
  - Report Center: `src/modules/reports/marketing-attribution.reports.ts` and page meta.

## 10. Setup

```
npx prisma migrate deploy
npx prisma generate
node scripts/sync-permission-catalog.mjs
# restart the app and the worker (npm run worker) — new queue "marketing-attribution"
```

Then create a model under Attribution & ROI → Models, have it approved by someone else, make it the default, and Recalculate. The nightly job keeps it current after that.

## 11. Limitations (known)

- **No engagement data.** Opens, clicks, visits and ad impressions aren't captured anywhere in the ERP, so they aren't touches, and there are no CTR or reach-by-impression metrics.
- **No ad-platform or provider costs.** Spend is what Finance records against the campaign (Phase 12). Cost isn't split by channel.
- **Account-level matching.** A message to any contact of a customer's CRM company can share credit for that customer's orders. There is no person-level matching for orders (Sales Orders have no contact).
- **Deleted source records** aren't detected by the sync (it reads changed rows). Cancelled orders are handled; a hard-deleted lead or enquiry keeps its conversion row.
- **Sales invoice credit notes / returns** aren't in the invoiced value: the ERP has no credit-note document for sales invoices. A cancelled invoice drops out.
- **Revenue ≠ profit.** ROI is revenue-based; no margin data is used.
- **INR only**, as in the rest of the ERP.
- **Not tested in a browser** in the sandbox (no app server here).

## 12. Acceptance criteria (spec `ref/13.md` §23)

| Criterion | Status |
|---|---|
| Models configurable, validated, versioned, reproducible | Done (schema + CHECKs + frozen versions; runs keep their version) |
| Touchpoints normalised and deduplicated | Done (stable dedup keys; idempotent sync tested) |
| Conversions reference authoritative records | Done (type + source id, unique) |
| Windows and eligibility explicit and deterministic | Done (§4; boundary tests) |
| Algorithms correct and tested | Done (all five; unit tests) |
| Weights reconcile | Done (exactly 1 at 10 dp; DB check in tests) |
| Revenue on a clearly identified basis | Done (three labelled bases) |
| Spend from Phase 12 / verified sources | Done (actual only) |
| Budgets not shown as spend | Done (budget and committed never in ROI) |
| ROI / ROAS only with valid data; no misleading % | Done ("n/a" with reason; tested) |
| Reversals, corrections, late events | Done (new run; tested) |
| Historical results keep provenance | Done (run → version; immutable results; retention documented) |
| Dashboards with drill-downs and data-quality indicators | Done |
| Privacy, tenant isolation, financial access | Done (tested: hidden records / amounts, cross-company) |
| Tests | Done (§13) |
| Documentation | This file |
| Phases 01–12 still work | Full suite (§13) |
| No duplicate CRM / campaign / finance / transaction module | Respected |
| No Phase 14+ features | Respected |

## 13. Verification (sandbox, 2026-11-06)

- **Type-check:** clean on the Sales & Marketing slice including all Phase 13 paths (`tsconfig.check-p9.json`, sandbox only).
- **ESLint:** 0 errors / 0 warnings on new and changed files.
- **Unit tests:** `attribution-math.test.ts`, 12/12. They cover:
  - window ends, post-conversion exclusion, identity, type and channel filters;
  - "sent" including "delivered";
  - ordering ties; collapse rules;
  - all five weightings, including n = 1 / 2 and 100% on the ends;
  - paisa allocation; ROI / ROAS / cost-per with zero and unknown cost;
  - end of business day;
  - a batch with attributed / unattributed / reversed conversions;
  - invalid model parameters.
- **Screen test:** `attribution-screens.test.tsx`, 1/1.
- **Integration tests:** `attribution.integration.test.ts`, 6/6 on a migrated + seeded Postgres with synthetic deliveries, leads, orders, an invoice and an expense. They cover:
  - model approval and frozen versions;
  - idempotent sync;
  - shared credit, with orders reached through the contact's customer;
  - exact reconciliation; immutable results;
  - ROI 225% with spend and n/a without;
  - the invoiced basis;
  - a late delivery and a cancelled order in a new run, with the old run unchanged;
  - a new version waiting for its own run;
  - one run at a time, idempotency, a run executed once, the 731-day limit;
  - drill-down hiding orders from a user without Sales Order access;
  - edit permission; other companies.
- **Regression:** see the progress doc for the full-suite result.
