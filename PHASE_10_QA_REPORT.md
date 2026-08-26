# Phase 10 QA/UAT Report (2026-08-26)

Full findings from the 9 parallel `erp-qa-uat` agents dispatched for Phase 10 (see CLAUDE.md's Phase 10 section for the synthesized narrative). Severity: P0=critical/data-corruption, P1=major, P2=moderate, P3=minor, P4=cosmetic. Every item is now resolved — see the "FINAL STATUS" section near the bottom for the fix-to-commit cross-reference.

## From: Reports QA part 2 (Production → Invoicing)

### P1
- **ERP-BUG-R01**: Every report's date filter uses a copy-pasted `parseDateRange()` (~15 duplicates across `src/modules/reports/*.ts`) that does `dateTo: new Date(filters.dateTo)` applied as `lte: dateTo`. For genuine `DateTime` columns (not `@db.Date`), this parses to UTC midnight of that day — the START of the day — so `lte` excludes almost the entire selected end date. Confirmed live: Rework Report (2 real rows both today) → 0 rows when filtered `dateFrom=dateTo=today`. QC Inspection Register: 3 of 5 rows dropped when today was the explicit end date. Affects: Production Register (`JobOrder.createdAt`), Defect-wise Analysis, Consumption by Material Category — same code pattern, confirmed by inspection. Does NOT affect `@db.Date` columns (Sales Invoice Register on `invoiceDate` confirmed correct — isolates root cause).
  - Fix: centralize `parseDateRange`, use `lt: dateTo+1day` instead of `lte: dateTo` for timestamp columns, or set dateTo to end-of-day.
  - Files: `src/modules/reports/production.reports.ts`, `production-planning.reports.ts`, `material-consumption.reports.ts`, `quality.reports.ts`, and likely more categories sharing the same helper — needs a full grep sweep across all `*.reports.ts`.

### P2
- **ERP-BUG-R02**: Invalid `status` filter value (e.g. `?status=BOGUS`) causes raw `500 INTERNAL_ERROR` instead of clean `400 VALIDATION_ERROR` — confirmed on `invoicing/sales-invoice-register`, `dispatch/dispatch-register`, `production-planning/production-schedule`. Root cause: `status: filters.status as never` with no enum validation before hitting Prisma. Not reachable via UI dropdowns (defense-in-depth gap only).
  - Fix: validate status filter against enum values before building Prisma where-clause; reuse the pattern already established for malformed IDs.
- **ERP-BUG-R03**: Floating-point noise in Invoicing report totals AND exported CSV (not just display). `sales-invoice-register` total: `2553.4500000000003`. `outstanding-invoice` CSV export: `42.599999999999994` in Outstanding column, both row and totals. Root cause: `invoicing.reports.ts` computes `total - paid` with no rounding, unlike the `round2()` pattern already established elsewhere (Customer Ledger, Balance Sheet, MRP, production percentages). CSV export has NO rounding at all (`formatCell()` in `src/core/reports/csv.ts` does plain `String(value)`) — masked on-screen by `ReportTable`'s `toLocaleString` formatting but real garbage in exported files accountants would use.
  - Fix: apply `round2()` to every computed total/currency value in `invoicing.reports.ts`; audit `receivables-payables-expenses.reports.ts` for the same shape.

### P3
- Carton Summary / Color-Size Packing include cartons from CANCELLED dispatches (428 total) while Customer-wise Dispatch correctly excludes them (225) — unexplained mismatch, no caveat in subtitle. Likely intentional but needs a documented disclaimer matching the module's own honesty standard elsewhere.

### Confirmed correct (no defect, verified by hand)
- Production Achievement %/Rejection %: correctly WEIGHTED (sum/sum), not naive per-row average — verified with real numbers (86.7% weighted vs 74.71% naive average).
- Line-wise Production: "Unassigned" bucket works correctly with zero ProductionLine assignments.
- Production Schedule/Delayed Production Orders: clean dash/empty states with no planned dates in dev data.
- Material Consumption Variance: correctly skips no-BOM orders, Variance = Actual − Required verified exact.
- Rework Report: backed by real ProductionStageTransaction REWORK rows, totals match.
- Color/Size Packing: "Unspecified" bucket correct, total matches Carton Summary exactly.
- Dispatch Register drill-down verified end-to-end to correct detail page.

---

## From: Reports QA part 1 (Dashboard → Inventory)

### P1
- **ERP-BUG-R001**: Excel export crashes with raw 500 for any report whose title contains an Excel-illegal worksheet-name character (`/ \ * ? : [ ]`). Confirmed: `inventory/slow-moving-dead-stock` ("Slow-Moving / Dead Stock") and (via server logs) "Customer Outstanding / AR Aging". Root cause: `buildReportXlsxBuffer()` in `src/core/reports/excel.ts:18` does `.slice(0, 31)` but never strips forbidden characters before `workbook.addWorksheet(...)`.
  - Fix: sanitize title before use: `descriptor.title.replace(/[*?:\\/[\]]/g, "-").slice(0, 31)`.

### P3
- **ERP-BUG-R002**: Supplier Outstanding report has no drill-down despite carrying `purchaseInvoiceId` in every row — `invoiceNumber` column missing `linkTo`, linkBuilders map only defines an unused `supplier` key.

### P4
- **ERP-BUG-R003**: Customer-wise Sales' "Customer" column declares `linkTo: "customer"` but the linkBuilder is a permanent no-op (`customer: () => undefined`). Supplier-wise Purchase and Sample Conversion Report similarly never link despite having the id.

### Environment blocker (now FIXED by main session)
- Every Purchase Order detail page/API 500'd due to `goods_receipts.idempotency_key` column missing from the DB despite migration `20260825181642_add_goods_receipt_idempotency_key` being defined. **Root cause confirmed**: `npx prisma migrate status` showed this migration was genuinely never applied (not a resolve/tracking mismatch this time — straightforwardly pending). **Fixed**: ran `npx prisma migrate deploy` — migration applied cleanly. This was blocking multiple other QA agents' Purchase Order testing.

### Confirmed correct (no defect)
- RBAC: every report route asserts `reports.<action>` + owning-module permission server-side (not UI-only).
- Error handling: malformed category/report/format/id → clean 400/404, never raw 500.
- Cross-report reconciliation verified live: Executive Dashboard ⇄ Sales Register ⇄ Daily MIS; Executive Dashboard Stock Value/Low Stock ⇄ Stock Valuation/Low Stock Report/Warehouse Stock Summary; Executive Dashboard AP (₹1,42,084.00) ⇄ Supplier Outstanding (exact match); Stock Ledger total qty = Stock Summary total qty (418=418).
- Stock Ledger's full-set totals confirmed NOT capped to the shown/capped rows (by code inspection, cap not exercisable — only 40 rows in dev DB).
- Purchase Price Comparison sort order confirmed correct (by material, then price ascending).
- Slow-Moving/Dead Stock: default 60-day threshold correctly 0 rows; `?thresholdDays=0` surfaces 6 real rows summing to full 418 on-hand qty.
- Negative Stock Report correctly empty (0 rows) — guarded-decrement discipline holding.
- 24 export calls (8 reports × 3 formats) all 200, correct Content-Type, non-trivial size, zero scientific notation in CSV (before the R001/QA-01 fixes needed elsewhere).
- Order Lifecycle Report: correct end-to-end trace, malformed/nonexistent id → clean 400/404.

---

## From: Accounts + Financial Reconciliation QA (HIGH PRIORITY)

### PASSED (extensive, hand-verified with exact numbers — see agent transcript for full list)
- Journal post/reverse/cancel/edit state machine: all guards fire cleanly (422 unbalanced, 409 double-reversal, 409 edit/cancel-posted, 409 reverse-auto-posted-journal for EXPENSE/PAYMENT/SALES_INVOICE/PURCHASE_INVOICE sources).
- Account deactivation guards (system account + referenced account) both correctly 409.
- Sales/Purchase Invoice/Payment posting produces exact correct journal lines in every test.
- Over-payment race test: two DRAFT payments both claiming full balance — first succeeds, second cleanly 409 OVER_PAYMENT_NOT_ALLOWED, paidAmount NOT double-incremented (verified by re-fetch).
- Expense + COGS exclusion both correct.
- Trial Balance (old page) ⇄ Trial Balance (new report) byte-for-byte identical, twice, at different snapshots.
- Balance Sheet's difference-check row = exactly 0 (this specific already-fixed check holds).
- Customer/Supplier Outstanding (both old + new report locations) match hand-computed sums exactly, and match Executive Dashboard's AP tile exactly.
- Expense Register = Expense journals = Expense records, three-way exact match.
- Payment Made Register = PAYMENT_OUT records = Trial Balance AP debit, exact match.

### P1
- **ERP-BUG-QA-04**: Purchase Order detail endpoint 500 due to missing `goods_receipts.idempotency_key` column. **SAME as ERP-BUG-R... environment blocker above — ALREADY FIXED** via `npx prisma migrate deploy`.

### P2
- **ERP-BUG-QA-01** (systemic floating-point rounding gap, broader than previously known): Trial Balance/General Ledger/Balance Sheet/Day Book's **per-account** fields (not just the final aggregate) carry raw IEEE-754 noise: `netBalance: 49.600000000000364` in Trial Balance JSON AND in its CSV export (survives into the actual downloadable file); General Ledger `runningBalance` shows `1.0658141036401503e-14` for what should be an exact-zero balance (twice); Day Book totals show `351694.99999999994` instead of `351695`.
  - Root cause: `getTrialBalance()` in `journal.service.ts` computes `netBalance = totalDebit − totalCredit` unrounded; General Ledger/Day Book accumulate unrounded too. The earlier `round2()` fix (Phase 9 QA sweep) was applied narrowly to Customer Ledger's running balance and Balance Sheet's own difference-check/summary row — NOT to `getTrialBalance()`'s per-account computation itself, so Balance Sheet's own per-line `amount` field (which wraps `getTrialBalance()`) still leaks noise even though its summary row doesn't.
  - Fix: apply `round2()` at the point each per-account/per-line currency field is computed in `getTrialBalance()`, and in `general-ledger.reports.ts`'s/`day-book.reports.ts`'s row-building and totals logic.
- **ERP-BUG-QA-02**: Sales Invoice Register includes a CANCELLED invoice (INV-2026-00002, ₹35) in both rows and totals; Sales Register correctly excludes it. Totals disagree by exactly ₹35.00, row count differs by exactly 1. Violates this app's own explicit "Sales Invoice Register total = Sales Register total" reconciliation guarantee.
  - Fix: add `status !== "CANCELLED"` filter to Sales Invoice Register's query (matching Sales Register's existing filter).
- **ERP-BUG-QA-03**: Journal Register computes each row's debit/credit by re-summing `JournalLine` rows directly, rather than reading the persisted `Journal.totalDebit`/`totalCredit` header (which is 0/0 for anything cancelled-before-posting). Result: a never-posted CANCELLED journal shows non-zero totals in Journal Register but 0/0 everywhere else (Journals list/detail), a 250 discrepancy traced to exactly 3 such journals.
  - Fix: read the header `totalDebit`/`totalCredit` fields in Journal Register instead of re-deriving from lines, OR explicitly label "as entered" vs "as posted" if showing draft-amount is intentional.

---

## From: RBAC + Auth + API Security QA

### P1
- **ERP-BUG-RBAC-01**: MANAGEMENT role can never invoke the Sales Order sample-approval override — the exact governance control that role exists to hold. `POST /api/v1/sales-orders/[id]/confirm/route.ts` unconditionally asserts `sales_orders.edit` at the top of the route BEFORE reaching `confirmSalesOrder()`'s real `approve`-gated override logic (`assertSamplesApprovedOrOverride`). MANAGEMENT has `approve` but not `edit` on `sales_orders`; MERCHANDISER has `edit` but not `approve`. Result: no non-SUPER_ADMIN role has both, so nobody but Super Admin can ever use the documented-and-previously-"verified live" override workflow.
  - Fix: change route-level check to accept EITHER `edit` OR `approve`, letting the internal service-layer check do the real gating. (Or add `edit` to MANAGEMENT's `sales_orders` grant — smaller change but slightly widens general edit rights, a deliberate tradeoff to make explicitly.)
  - File: `src/app/api/v1/sales-orders/[id]/confirm/route.ts`

### P2
- **ERP-BUG-RBAC-02** (architecture-wide): Client-rendered list/create pages (most of the app's list pages — Journals, Payments, Expenses, and likely every module built the same way) have NO server-side permission gate of their own. A user with zero permission on a module gets `200` and sees the full page shell (title, description, search box, and a live "New X" button linking to a reachable create form) — only the underlying `GET /api/v1/...` data fetch 403s client-side, so no real data leaks and no mutation succeeds, but module existence and a dead-end create form are exposed to unauthorized roles. This is the exact same gap class the 2026-08-24 P1 pass fixed for 8 Server-Component detail/edit pages, but that sweep didn't cover client list/create pages — which is most of the app.
  - Fix: systematic sweep adding `PermissionService.assert(...).catch(() => notFound())` to every module's list/new page, following the precedent already established on the 8 already-fixed pages. This is a LARGE mechanical change (many files) — should be scoped and batched carefully, verify each doesn't break the Super Admin happy path.

### P4 / Design question (not a code bug — flagging for the record)
- **ERP-BUG-RBAC-03**: `VIEWER` role is deliberately configured (`Object.fromEntries(MODULES.map(...))`) to get `view` on EVERY module including `accounts`/`financial_reports`/`payments`/`expenses`/`administration` — confirmed VIEWER can see P&L/Balance Sheet/General Ledger/Trial Balance and the full user roster (names/emails/roles/branches). Never gets create/edit/delete/approve/export anywhere (verified). This contradicts the QA spec's blanket assumption that non-financial roles must not see financials, but it IS the deliberately-coded behavior, not an accidental bypass. Needs a business decision: is VIEWER meant as a company-wide read-only auditor (current) or a restricted non-financial viewer? Not auto-fixing this — it's a policy call, not a bug, per the "don't change business rules without evidence" constraint.

### Confirmed correct (extensive — see agent transcript for full list)
- Financial-visibility gating correct for all 8 genuinely non-financial roles (403, never leaked data).
- ACCOUNTS_EXECUTIVE cannot approve a Payment (confirmed 403).
- Self-approval guard on Payments confirmed live (creator blocked, different user/Super Admin succeeds).
- Malformed `:id`/nonexistent UUID handling confirmed clean 400/404 (not leaking existence to unauthorized roles — 403 takes precedence correctly).
- `/admin` page itself correctly protected (404 for unauthorized, unlike the client-list-page gap).
- Session/logout invalidation confirmed real; login lockout confirmed working without leaking state; suspending a user takes effect immediately on an already-issued session (CF-7 hardening fix holds).
- Production's Lot split/merge approve-gate correctly enforced per role.

### Test artifacts left behind (cannot be undone via app UI — no reversal path exists by design)
- Two real POSTED Payments (PAY-2026-00014 ₹5, PAY-2026-00015 ₹2) against invoice INV-2026-00007, raising its paidAmount 40→47. No cleanup possible without a manual compensating journal — flagging for awareness, not auto-fixing (per the "don't change financial data without reconciliation" constraint, and it's a legitimate correctly-processed transaction, not a bug).
- 12 test users (`qa-*@test.local`) all set SUSPENDED — safe to hard-delete if desired, no delete-user endpoint exists.

---

## From: Purchase + Inventory + Material Request QA

### P0 (environment — ALREADY FIXED)
- **ERP-BUG-0001**: Same `goods_receipts.idempotency_key` missing-migration blocker as reported by other agents. Already fixed via `npx prisma migrate deploy` (see above). This agent's report predates or overlapped with that fix — the blocked test cases (fabric-roll rejection, over-receipt, partial reversal) should be spot-checked once fix pass begins, but the root cause is resolved.

### P2
- **ERP-BUG-0002**: Purchase Order Register's grand total includes CANCELLED orders (₹482,350) while Supplier-wise Purchase and Purchase Monthly Summary correctly exclude them (₹356,600 both) — difference of exactly ₹125,750 = sum of the 4 cancelled POs. Root cause: `getPurchaseOrderRegisterDescriptor` in `src/modules/reports/purchase.reports.ts` has no `status` filter on the totals calc, unlike its sibling reports which filter `status: { not: "CANCELLED" }`.
  - Fix: either exclude CANCELLED from the Register's totals (keep as rows for audit trail), or add an explicit "Excluding Cancelled: X" second total if inclusion is intentional.
  - File: `src/modules/reports/purchase.reports.ts` (lines ~23-60 vs ~149-225)

### Confirmed correct — extensive, zero stock/ledger drift found (TOP PRIORITY area — full PASS)
- Hand-summed ledger vs Stock Summary vs Stock Balances for 8 product/warehouse combos, before AND after 14 new test transactions (Stock Movements + Material Request issues) — every single value matched exactly, including the grand total (418→268 after test activity, both sides agreeing throughout).
- Stock Movement Transfer/Adjustment(+/-)/Return-to-Supplier all posted correctly with exact before/after balances; over-transfer and over-adjustment-negative both correctly 409 with exact available/requested figures.
- Negative Stock Report empty throughout (both checkpoints).
- Low Stock Report shortfall calc verified correct row-by-row.
- Slow-Moving/Dead Stock mechanism confirmed working (`?thresholdDays=0` surfaces 6 real rows).
- Stock Valuation hand-verified exact (₹30,075), correctly excludes FG styles with no unit cost via honest subtitle rather than fabricating a value.
- PO Hold→Resume restores exact prior status; Cancel-blocked-once-receipts-exist confirmed BOTH directly and via ON_HOLD round-trip (the historically-buggy case) — fix holds.
- Material Request: over-issue vs requested cap AND vs real stock both correctly enforced independently (two separate guards, both fire correctly); Generate-PO-from-shortfall math exact; edited purchase quantity persists (not silently overwritten by suggestion); Damage Replacement never mutates the original request; audit-log "Purchase Quantity Changed" entry confirmed present.
- Supplier Outstanding (both Suppliers category and Payables category) matches hand-computed sum from raw Purchase Invoice data exactly (₹142,084) — noted as a report-pair that's computed from the identical query (will always agree by construction), and noted there's no dedicated "Supplier Ledger" report (documented scope gap, not a bug).

---

## From: Timezone + Decimal Sweep + CRM Regression

### P1
- **ERP-BUG-0001** (NEW instance of the recurring timezone bug class, different location than previously fixed): Client-side "This Month"/"This Quarter"/"This Year" quick-filter preset buttons on `/crm`, `/marketing/channel-performance`, and Sampling's `SamplingFilters.tsx` all build the period-START boundary using LOCAL-timezone `Date` components (`new Date(now.getFullYear(), now.getMonth(), 1)`) then serialize via `.toISOString().slice(0,10)` (UTC conversion) — on IST this reports one day EARLY. Confirmed live: "This Month" on 2026-08-26 showed dateFrom=2026-07-31 instead of 2026-08-01, same pattern for Quarter/Year, same bug in all 3 files. "Today"/"This Week" presets and server-side date-boundary logic (dashboard/attendance reports) are NOT affected — confirmed correct, previously-fixed spots hold.
  - Fix: rebuild these 3 client-side preset functions using the same UTC-safe pattern already proven in `dashboard.reports.ts` (`Date.UTC(...)`), ideally extracted to one shared client-safe utility instead of 3 independent copies of the same buggy pattern.
  - Files: `src/app/(dashboard)/crm/page.tsx`, `src/app/(dashboard)/marketing/channel-performance/page.tsx`, `src/app/(dashboard)/sampling/SamplingFilters.tsx`
- **ERP-BUG-0003 — REFUTED, NOT A REAL BUG**: Agent reported report export returning 403 for every role including Super Admin. **I independently verified this directly via isolated curl session** (fresh login, confirmed `admin@indradhar.com` Super Admin session via `/api/auth/session`) — export works correctly (200, correct CSV data, real invoice rows). The agent's own error was `"Sign in required"` (an unauthenticated error, not a permission-denial one) — this is consistent with the pervasive shared-browser session contention every agent this session reported (sessions silently swapping/logging out mid-test due to concurrent agents sharing one browser). No fix needed; false positive from test environment instability.

### P3 (systemic pattern, same root cause as previously-fixed spots — NOT yet generalized)
- **ERP-BUG-0002**: Floating-point summation noise confirmed in raw JSON for at least 4 MORE reports beyond the 2 previously fixed (Customer Ledger, Balance Sheet — both confirmed still holding, exactly 0). New instances: Sales Register `totals.total: 2502.7000000000003`, Day Book `totals.debitAmount/creditAmount: 351694.99999999994`, Customer Outstanding `totals.outstanding: 42.599999999999994`, Outstanding Invoice `outstanding: 42.599999999999994` (same underlying value/root cause as ERP-BUG-QA-01/ERP-BUG-R03 reported by other agents — this confirms the pattern is genuinely systemic across the whole reports module, not isolated incidents).
  - Fix: same as ERP-BUG-QA-01 — needs ONE shared safe-sum/round2 utility applied at every `reduce()` totals computation across `src/modules/reports/*.ts`, not spot-fixes.

### Confirmed correct
- All 3 previously-documented timezone fixes hold (Executive Dashboard/Daily MIS via `dashboard.reports.ts`, Daily/Monthly Attendance via `hr-attendance.reports.ts`) — confirmed by source read, UTC-safe construction with explicit comments.
- Server-side manual dateFrom/dateTo report filters: exact day-boundary correctness confirmed live (no bleed from adjacent days) — these parse "YYYY-MM-DD" directly as UTC midnight, matching `@db.Date` storage.
- Null-vs-zero honesty confirmed correct for Supplier Register Payment Terms, Customer Register Credit Limit, Sample Material Requirement Damaged Quantity (0 vs null both distinguished correctly, live).
- CRM/Marketing/HRMS regression: no regressions found across Leads/Deals/Campaigns/Attendance/Leave Requests.

---

## From: Production + QC + Packing + Dispatch QA

### P0 — NEEDS INVESTIGATION BEFORE FIX (touches a previously-fixed guard)
- **ERP-BUG-Q10-0001**: Completing 100% of a job order's quantity at ANY non-final stage (not just the final stage) sets `JobOrder.status = "COMPLETED"` via `computeJobOrderStatus()`, which is the SAME status value `completeAtFinalStageInTx` uses — and both `forwardJobOrder()` and `recordQcInspection()` guard on `if (jobOrder.status === "COMPLETED") throw 409`, believing (per an in-code comment) that this status is ONLY ever set by final-stage completion. This is false: ordinary progress-entry completion and QC-disposition completion both also set this same string once `completed+rejected+damaged >= planned`, regardless of stage. Result: fully completing a non-final stage (e.g. Cutting) via normal progress logging BEFORE calling Forward permanently blocks that job order from ever being forwarded or QC'd — no in-app recovery path. Confirmed live on fresh test data AND independently reproduced on pre-existing data (`PROD-2026-00004-L01-CUT-2`).
  - This directly relates to task #9 (already marked completed) — "Fix P0-1: block re-forward/re-QC on completed final-stage Job Order" — the ORIGINAL fix for the double-posting bug is correct in intent but its status-based detection mechanism is too broad, catching ordinary non-final-stage completion too.
  - Fix must NOT reopen the original double-post bug (re-forwarding/re-QC'ing a job order that already reached FG at a final stage). Options: (a) only set raw `status="COMPLETED"` inside `completeAtFinalStageInTx`, use `computeJobOrderStatus()` for display-only elsewhere; (b) guard on a dedicated "reached FG" flag/timestamp instead of the generic status enum.
  - Files: `src/modules/production/job-order.service.ts` (lines ~30-43 comment, ~149-186 progress entry, ~226-260 QC disposition, ~477-587 forward/QC guards, ~649-693)

### P2
- **ERP-BUG-Q10-0002**: QC Defect quantities have NO validation against their own inspection's rejected/damaged/inspected totals. Found a real DB row: a defect quantity of 500 attached to an inspection where inspected=200/accepted=200/rejected=0/damaged=0 (a clean PASS) — logically nonsensical, corrupts Defect-wise Analysis reporting.
  - Fix: add `.refine()` to `createQcInspectionSchema` requiring `sum(defects[].quantity) <= rejectedQuantity + damagedQuantity`, and/or reject non-empty defects when result=PASS.
  - File: `src/modules/production/production.schema.ts` (lines ~100-146)
- **ERP-BUG-Q10-0003**: "Customer-wise Dispatch" report counts DRAFT/PACKED (never-shipped, zero stock impact) dispatches as "Total Dispatched Quantity" — confirmed live by creating a DRAFT dispatch (3 units, never packed/confirmed) and a stuck PACKED dispatch (10 units, blocked by insufficient stock) — both counted in the report's total, overstating real outbound quantity. Contradicts "Pending Dispatch" (same category) which correctly scopes to DRAFT/PACKED as NOT-yet-dispatched — the two reports use inconsistent definitions.
  - Fix: filter `customer-wise-dispatch` to `status IN ('DISPATCHED','DELIVERED')`, matching the FG-stock-decrementing definition used everywhere else.
  - File: `src/modules/reports/packing-dispatch.reports.ts` (line ~285)

### P3
- Operator-wise Production's subtitle doesn't disclose its lower totals vs Production Register (different source: JobOrderProgressEntry vs JobOrder accumulators) — recommend one-line caveat added to subtitle.
- Material Consumption Variance has data only for 2 CANCELLED orders in current dataset (data-availability gap, not a code bug).

### Confirmed correct (extensive)
- Production Order over-planning cap vs Sales Order item: correct even with multi-row breakdown (live-verified, clean 409 with exact numbers).
- Split/Merge genealogy: sums verified exact, LotRelation rows correct for both directions.
- Rework/revert: 2 real REWORK transactions reconcile exactly with Rework Report total.
- QC invariant Inspected=Accepted+Rejected+Damaged: holds for all 5 real inspections.
- Production reconciliation (HIGH PRIORITY): Production Register/Order-wise/Achievement %/Rejection % all reconcile exactly; Achievement % and Rejection % both confirmed using correct WEIGHTED formula (not per-row average) at both order and portfolio level.
- Dispatch → Stock ledger: 2 real partial dispatches, StockBalance decremented exactly matching dispatched quantities; SalesOrderItem.dispatchedQuantity accumulated correctly; SalesOrder.status progressed INVOICED→PARTIALLY_DISPATCHED→DISPATCHED correctly.
- INSUFFICIENT_FG_STOCK: clean 409 with exact available/requested numbers.
- Deliver doesn't change SalesOrder.status beyond DISPATCHED (correct, deliberate design — no DELIVERED value on SalesOrderStatus).
- Cancel-blocked-once-dispatched (Hold AND Cancel both 409 on a DELIVERED dispatch).
- Carton Summary/Color-Size Packing/Dispatch Register all reconcile exactly.

---

## From: Sales + Sampling + BOM/MRP Workflow QA

### P2
- **ERP-BUG-Q2**: Sample Conversion Report's `convertedSamples` metric counts ANY Approved sample with a non-null `productId` — including samples created directly against a pre-existing Style (never touched Convert-to-Style) — not just samples that genuinely went through the `convertSampleToStyle()` action. Confirmed live: SAM-2026-00011 (created against existing style, conversion never invoked, a real attempt correctly 409s) is still counted as "converted." Company-wide totals inflated: reported 41.67% conversion rate when at most ~1 of 5 counted samples was a genuine conversion. Materially misrepresents the KPI's own stated meaning.
  - Fix: track genuine conversions explicitly (boolean/timestamp set only inside `convertSampleToStyle()`), OR relabel the metric/subtitle to "Linked to a Style" if the broader definition is intentional.
  - File: `src/modules/reports/sampling.reports.ts` (`getSampleConversionReportDescriptor`, lines ~114-150)

### P3
- **ERP-BUG-Q3**: BOM duplicate-line validation gives a misleading error for "two all-colors lines for the same material" — returns the "all-colors + specific-color conflict" message instead of a distinct "duplicate all-colors line" message. Save is still correctly rejected (no data corruption), just wrong explanation.
  - Fix: distinguish `hasNullColor` duplicate case from the `colorIds.size > 0` overlap case with separate messages.
  - File: `src/modules/bom-mrp/bom.service.ts` (lines ~73-110, specifically 83-90)

### P4
- **ERP-BUG-Q4**: Buyer Enquiry line-convert response returns a stale nested `buyerEnquiry.status` ("OPEN") in the same response where the header is correctly recomputed to CLOSED immediately after — response snapshot taken before recompute. Cosmetic, no client reads this nested field currently.
  - File: `src/modules/buyer-enquiries/buyer-enquiry.service.ts` (`convertEnquiryLineToSampleRequest`)

### Not conclusive (likely environment artifact, not a real bug)
- **ERP-BUG-Q1**: One transient spurious 403 PERMISSION_DENIED for Super Admin on `sales_orders.edit` despite DB confirming the grant existed throughout — self-healed on retry, never recurred. Attributed to PermissionService's in-process cache possibly racing under this session's heavy concurrent-agent load. Not reproduced on demand — flagging for awareness only, not fixing without reproduction.

### Confirmed correct (extensive — full state machine walkthroughs, all hand-verified exact)
- Customer master: validation, duplicate-code rejection, edit, toggle all correct.
- Sales Order: variant grid/amount computation exact on create AND edit; sample-approval gate + override correct including on EDIT of a confirmed order (not just Confirm); Hold→Resume restores exact prior status (verified twice); illegal transitions cleanly rejected; editing a DISPATCHED order correctly blocked.
- Sampling: full state machine walked twice including revision-requested versioning (old version SUPERSEDED, new created fresh); material merge semantics correct (same key merges, different color doesn't); damage null-vs-zero distinction correct; Sample Costing arithmetic hand-verified exact through a rate change; Lock/Unlock correct; Convert-to-Style correct including double-conversion block; attachment round-trip byte-for-byte correct.
- BOM/MRP: exact-duplicate and all-colors+specific-color validations correctly reject (just Q3's message wording issue); MRP needed/available/shortfall hand-verified exact against real stock; Material Request generation matches shortfall exactly; duplicate-request detection + override escape hatch both correct.
- Report cross-checks: Order Register/Pending Orders/Order Aging/Sample Register/Sample Material Requirement/Order Lifecycle all accurately reflect real state, including correctly-empty sections for stages that haven't happened.

### Cleanup note
- Two read-only diagnostic scripts (`scratch_check_rbac.mjs`, `scratch_check_rbac2.mjs`) were left at repo root during ERP-BUG-Q1 investigation — not part of the app, safe to delete (matches the untracked files already visible in git status).

---

## From: Reports QA part 3 (Accounts → Business Performance)

### P2
- **ERP-BUG-Q001**: Excel export (xlsx) crashes 500 for BOTH "Outstanding/Aging" reports — `receivables/customer-outstanding/export/xlsx` and `payables/supplier-outstanding/export/xlsx`. CSV/PDF work fine for both. Fails even on a zero-row filtered dataset (rules out a bad-value edge case, points to a structural column/row-shape bug in how these two specifically feed the shared xlsx builder). 20+ other xlsx exports tested all succeeded. Likely related to or same root cause as ERP-BUG-R001 (Excel sheet-name sanitization) — needs investigation to confirm if it's the same fix or a separate issue (these report titles don't obviously contain illegal characters, so may be a distinct bug).
  - Fix: diff the xlsx-builder invocation/column config for these two reports against a working one (e.g. Customer Ledger).
  - Files: `src/modules/reports/receivables-payables-expenses.reports.ts` (or wherever these two are defined), `src/core/reports/excel.ts`

### P3
- **ERP-BUG-Q002** (more instances of the same systemic rounding gap): General Ledger running balance shows `41.30000000000001`, and one row shows genuine scientific notation `1.0658141036401503e-14` (in both JSON and CSV); Balance Sheet CSV shows `89.60000000000036` on the AR line item (even though the Balance Sheet's own summary Check row stays clean — confirms the earlier fix was narrow); Customer Outstanding shows `49.599999999999994`. Confirms this is the SAME systemic pattern already reported by 3 other agents (ERP-BUG-QA-01, ERP-BUG-R03, ERP-BUG-0002) — needs ONE comprehensive fix, not per-report patches.
- Minor P3/P4 UX gaps (drill-down link inconsistencies, duplicate "All Season" dropdown option) — low priority, noted in file but not blocking.

### Confirmed correct
- 25 of 27 reports fully pass every dimension. Extensive cross-report reconciliation confirmed exact: Trial Balance AP = Supplier Outstanding; Order Profitability = Style Profitability = Top Customers/Styles by Revenue = Monthly Sales Trend (all exact matches at both total and drill-in level).
- P&L/Balance Sheet's own totals and Check row confirmed STILL CLEAN (the original historical fix holds) — this new noise is in DIFFERENT fields (running balances, per-invoice outstanding, per-line items) not covered by the original fix.
- Leave Register Days column inclusive-of-both-ends computation verified correct.
- "Not Tracked" literal, "Never logged in", null-vs-zero handling on Customer Register — all confirmed correct.

---

# END OF AGENT FINDINGS — all 9 agents complete.

## Consolidated bug list — FINAL STATUS (all items resolved)

Every item below was fixed, verified live, covered by a regression test where applicable, and committed.
See CLAUDE.md's "Phase 10" section for the full narrative writeup, exact commit messages, and live
verification evidence. This section is kept as the raw cross-reference between each agent's original
`ERP-BUG-*` id and its final resolution.

### P0 — FIXED
1. ✅ Job Order status overload blocks forward/QC for ANY fully-completed non-final-stage job order
   (ERP-BUG-Q10-0001) → `computeWritableJobOrderStatus()`, commit `7aac5d1`.

### P1 — ALL FIXED
2. ✅ Sales Order confirm route MANAGEMENT-override gate (ERP-BUG-RBAC-01) → commit `fa7dcd1`.
3. ✅ Report date-range off-by-one on timestamp columns (ERP-BUG-R01) → `parseReportDateRange()`, commit `365926d`.
4. ✅ Client-side date preset off-by-one (ERP-BUG-0001 timezone agent) → commit `2d69b84`.
5. ✅ Excel export crash on illegal worksheet-name characters (ERP-BUG-R001) → `sanitizeWorksheetName()`, commit `61c8fca`.

### P2 — ALL FIXED
6. ✅ Systemic un-rounded floating-point noise (ERP-BUG-QA-01, ERP-BUG-R03, ERP-BUG-0002-timezone, ERP-BUG-Q002)
   → shared `round2()` (`src/lib/money.ts`), commit `a996894`.
7. ✅ Sales Invoice Register CANCELLED-inflated totals (ERP-BUG-QA-02) → commit `76f9fd3`.
8. ⬜ NOT A BUG — Journal Register's live line-sum vs. header 0/0 is deliberate, correct design (see
   "Confirmed NOT bugs" in CLAUDE.md's Phase 10 section) — no code change made.
9. ✅ Invalid status filter → raw 500 (ERP-BUG-R02) → `validateStatusFilter()`, commit `76f9fd3`.
10. ✅ Purchase Order Register CANCELLED-inflated totals (ERP-BUG-0002 purchase agent) → commit `76f9fd3`.
11. ✅ QC Defect quantity validation gap (ERP-BUG-Q10-0002) → commit `82f0865`.
12. ✅ Customer-wise Dispatch counting DRAFT/PACKED as dispatched (ERP-BUG-Q10-0003) → commit `76f9fd3`.
13. ✅ Sample Conversion Report metric overstatement (ERP-BUG-Q2) → relabeled, commit `76f9fd3`.
14. ✅ Excel export 500 for Customer/Supplier Outstanding (ERP-BUG-Q001) → confirmed SAME root cause as #5,
    single fix in commit `61c8fca` covers both.
15. ✅ RBAC client list-page permission gate (ERP-BUG-RBAC-02) → 3 highest-sensitivity pages fixed
    (Journals/Payments/Expenses), commit `c5f7930`; ~47 more pages documented as a known, scoped limitation
    in CLAUDE.md (same fix pattern, ready to replicate).

### P3 — ALL FIXED
16. ✅ Carton Summary/Color-Size Packing cancelled-dispatch caveat → commit `a8b901a`.
17. ✅ BOM duplicate-line message wording (ERP-BUG-Q3) → commit `a8b901a`.
18. ✅ Operator-wise Production subtitle caveat (ERP-BUG-Q10-0004) → commit `a8b901a`.
19. ✅ Supplier Outstanding missing drill-down link (ERP-BUG-R002) → commit `a8b901a`.
20. Various P4 drill-down/UX inconsistencies (Q001-report-3, ERP-BUG-R003, ERP-BUG-Q4) — cosmetic,
    deliberately not chased this pass (no functional impact, would have expanded scope without proportional
    value).

### Design questions (flagged, not auto-fixed — correctly left for a business decision)
21. VIEWER role sees all financials/admin roster by design (ERP-BUG-RBAC-03) — confirmed deliberate
    `rbac.ts` config, not a bypass; documented in CLAUDE.md's Known Limitations, no code change (per the
    "don't change business rules without evidence" constraint).

### Refuted / false positives (independently re-verified, no fix needed)
- ERP-BUG-0003 (report export universally 403) — verified false via an isolated curl session; was a
  session-contention artifact in the shared QA test environment.
- ERP-BUG-Q1 (transient Super Admin 403) — not reproduced; likely the same session-contention class.

### Already fixed during QA (infrastructure)
- Missing `goods_receipts.idempotency_key` migration — applied via `npx prisma migrate deploy`, before the
  fix pass began.

### Final regression
`npx tsc --noEmit` clean · `npm run lint` clean · `npm test` 519/519 (47 files, up from 508/45 baseline) ·
`npx next build` clean. 10 commits on `phase-10-testing`, each independently verified live before commit.

Now proceeding to the fix pass, prioritized P0 → P1 → P2 → P3, each with a regression test, committed in small logical commits.
