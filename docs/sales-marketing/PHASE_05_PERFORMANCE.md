# Sales & Marketing — Phase 05 Targets, territories and team performance (2026-11-03)

Spec: `ref/05.md`. Plan: `RELEASE_PLAN.md` (Release 2, R2.1–R2.3, widened). Scope confirmed 2026-11-03:

- **Rep = login User** (the same people who own enquiries and quotations). **Team = a manager's CRM reporting tree** (`getTeamScope(…, "CRM")`: the manager's employee + everyone below, via `EmployeeReportingLine` / `Employee.reportsToId`). The Sales Agents master is not touched (commission is Phase 07).
- **Sales Orders get a stored sales credit**: `salesRepUserId` + `salesTerritoryId`, filled automatically when the order is created and changeable afterwards (with a reason, audited). History never moves when a customer or owner changes later.
- **Territories are a flat list** (no parent/child). A customer belongs to at most one territory; reps are assigned to territories with from/to dates.
- **Targets have approval and revisions**: Draft → Pending approval → Approved, approver ≠ preparer, changes = new revision, the old approved one is kept (Superseded).

**Not in this phase:** territory hierarchy and re-alignment history, split / shared credit, allocation of a parent target to children, collected-payment metric, multi-currency (the ERP is INR-only), commission (07), channels (07), forecasting (06), AI.

## 1. What existed (reused, not rebuilt)

Users and Employees; the CRM reporting hierarchy (`src/core/hierarchy/team-scope.ts`); `Customer`; Sales Orders (`createSalesOrder()` / `updateSalesOrder()`), Sales Invoices (posted = AR document of record), Quotations / revisions (S2–S4); `Company.fiscalYearStartMonth`; `PermissionService` incl. the self-approval guard; audit log; notifications; Report Center; the S6 metrics service. Nothing assigned a sales order to a salesperson (only `requestedByUserId` = who typed it) and there were no territories or targets.

## 2. Territories

- `sales_territories`: code (unique per company), name, description, active flag. Deactivate instead of delete (orders keep pointing at it). A territory with customers can be deactivated; it simply stops being suggested for new orders.
- **Customers**: `customers.sales_territory_id` (nullable). One territory per customer; moving a customer is an explicit action from the territory screen (audited). Moving never changes orders already booked (they store their own territory, §3).
- **Rep assignments** (`sales_territory_assignments`): territory, user, *primary* flag, start date, optional end date. Rules: the user must be an active user of the company; the same user can't have two overlapping assignments to the same territory; a territory can't have two overlapping *primary* reps; end date ≥ start date. Ending sets the end date; an assignment that hasn't started yet can be removed. A rep may cover several territories (explicit rows, never a single field on the user).
- Assignments drive: who is suggested as rep for a customer's new order (primary rep in force on the order date), and who may see a territory's performance (§7).

## 3. Sales credit on a Sales Order (attribution)

Stored on the order: `sales_rep_user_id`, `sales_territory_id`, `sales_credit_source` (how it was set), `sales_credit_changed_at/by`, `sales_credit_reason`.

When the order is **created** (`createSalesOrder`, every path incl. quotation conversion):

1. **Rep** = the converted quotation's owner → else the owner of the CRM company linked to the customer → else the territory's primary rep in force on the order date → else the user who created the order.
2. **Territory** = the customer's territory at that moment (if active), else none.

Source is stored (`QUOTATION_OWNER`, `CRM_OWNER`, `TERRITORY_PRIMARY`, `CREATOR`, `MANUAL`). Editing an order: if its customer changes and the credit was never set by hand, territory (and a territory-derived rep) are worked out again; otherwise it is left alone.

**Change credit** (Sales Order page → *Sales credit → Change*, `sales_performance.edit`): pick rep and/or territory, a reason is required; the change is audited and logged with the old and new values. Any status, since correcting attribution is always allowed; it changes every report for that order (it is one order, counted once).

**Single-owner rule:** each order credits exactly one rep and at most one territory — no split credit in this phase. Orders created before this phase were back-filled: rep = quotation owner if converted, else the creator; territory none (no territories existed).

**Team credit** = the sum of the rep credits of the manager and everyone currently below them in the CRM reporting tree. Because team membership is not stored on the order, moving a rep to another manager moves that rep's history with them (documented limitation; rep and territory credit are snapshotted and never move).

## 4. Metrics (one registry: `performance/performance-metrics.ts`)

All money in the company base currency (INR), before GST, 2 decimals, summed from stored 2-dp amounts (no further rounding). Dates are business dates (`@db.Date`), period boundaries inclusive.

| Metric | Source (authoritative) | Qualifies | Date basis | Credit |
|---|---|---|---|---|
| **Booked order value** | `sales_orders.base_total_amount` | status Confirmed, In production, Partially dispatched, Dispatched, Invoiced, Closed; On hold **only if** held from one of those. Draft and Cancelled never count. | order date | order's rep / territory |
| **Booked orders** (count) | `sales_orders` | as above | order date | as above |
| **Booked quantity** (pieces) | Σ `sales_order_item_breakdowns.ordered_quantity` | as above | order date | as above |
| **Accepted quotation value** | `quotation_revisions.taxable_total` (lines after discount, before charges and GST) | revision status Accepted | customer decision date | quotation owner (else creator); territory = customer's territory now |
| **Accepted quotations** (count) | `quotation_revisions` | as above | as above | as above |
| **Invoiced value** | `sales_invoices.subtotal_amount × exchange_rate` | status Posted, Partially paid, Paid, Closed (Draft / Cancelled never) | invoice date | the invoice's sales order rep / territory |

- **Quotations are never booked sales.** Accepted quotation value is its own metric and is never added to order or invoice value.
- **Invoiced value is not "revenue".** It is the posted AR invoice amount before GST. Sales returns have no credit note against sales invoices in this ERP, so they don't reduce it (limitation). Collected payments are not offered: payment allocations aren't a reliable per-rep source yet.
- **Amended orders** count once, at their current value (an order is one row; editing replaces its lines). **Cancelled** orders/invoices drop out. Each source row is read once per query; nothing is copied or cached, so corrections show immediately.
- Quotation credit follows the quotation's current owner and the customer's current territory (quotations store no snapshot) — documented limitation.

## 5. Targets

`sales_targets` (what is measured) + `sales_target_revisions` (the value).

- **Scope**: *Rep* (a user), *Team* (a manager user — actual = §3 team credit), *Territory*, *Company*. **Metric**: §4. **Period**: Month, Quarter, Year. Quarters and years follow the company's fiscal year start month (`Company.fiscalYearStartMonth`); the server derives start/end from the chosen period, so every target covers exactly one whole period (leap years and month lengths handled by the date maths, no free-form ranges).
- **No duplicates**: one live (not archived) target per company + scope + subject + metric + period (partial unique index).
- **Revisions**: value, notes. Status **Draft → Pending approval → Approved**; Approved → **Superseded** when a later revision is approved. One open (draft / pending) revision at a time; only a Draft is edited; a Pending revision can be sent back (reason, `reject`) or returned to draft by the preparer; a Draft can be discarded (the whole target if it never had an approved revision).
- **Approval** needs `sales_performance.approve` and someone other than whoever created, last saved or submitted the revision (SUPER_ADMIN may approve their own — same rule as everywhere). Approved revisions are never edited.
- **Changes after the period has started** are allowed (a new revision through approval); the page marks revisions approved after the period start. **After the period has ended** nothing can be submitted or approved (no retrospective target changes); the target can only be archived.
- **Archive** (with reason) hides a target from boards; it stays readable.
- A target with no approved revision shows "Not approved yet" — its draft value is never presented as the target.

## 6. Attainment

For a target / board row: target (latest approved revision), actual (§4, same period and credit rule), gap = target − actual (negative = over-achieved), attainment % = actual ÷ target × 100 rounded to 1 dp; **target 0 or no approved target → no %** ("—"), never ∞. Also shown: period dates, days elapsed / remaining, the expected-to-date pace (target × elapsed share) for the current period, and when the figures were calculated (always live — no cache). Over 100 % is shown as such (green), under as amber/red by pace.

## 7. Who sees what (`sales_performance` module)

| Action | Meaning |
|---|---|
| view | performance board and targets in the viewer's scope |
| view_all | every rep, team, territory and company figures |
| create / edit | create targets and draft revisions; manage territories, assignments and customer moves; change an order's sales credit |
| approve / reject | approve / send back target revisions |
| export | performance reports |

Scope without `view_all`: the viewer's own figures, their CRM team (each member and the team total), and territories they are assigned to (in force today). Company totals and the "no rep / no territory" bucket need `view_all`. Targets follow the same rule by subject. Drill-down lists only orders the viewer may see under that rule (and only with `sales_orders.view`).

Grants: Management view, view_all, create, edit, approve, reject, export; Merchandiser (salespeople) view, export; Super Admin all.

## 8. Screens

- **Sales & Marketing → Territories**: list, create, detail (edit, deactivate, rep assignments, customers with *Add / Move / Remove*).
- **Targets**: list (period, scope, metric, status filters) with live attainment; *New target*; detail (attainment, revision history, actions, activity).
- **Team Performance**: metric + period picker; my figures; rep ranking, team, territory tables with target, actual, gap, attainment, pace; click a row → the orders / invoices / quotations behind the number.
- **Sales Order page**: *Sales credit* (rep, territory, how it was set) with *Change*.
- **Reports** (Report Center → Sales & Marketing): *Target attainment*, *Sales credit register*.

## 9. Code map

- Migration `prisma/migrations/20261103090000_sales_performance_phase5` (rollback `prisma/rollback/20261103090000_sales_performance_phase5.down.sql`): 5 tables, customer territory, order credit columns + back-fill, partial unique indexes (one live target per subject/metric/period; one open and one approved revision per target), CHECKs (scope ↔ subject, dates, value ≥ 0), `sales_performance` permissions.
- `src/modules/sales-marketing/performance/`: `performance-registry.ts` (metrics, scopes, labels — client-safe), `performance-periods.ts` (fiscal periods, progress, attainment — pure), `performance-actuals.ts` (**the only metric calculation**, visibility scope), `territory.service.ts`, `sales-credit.service.ts` (default credit, change credit), `target.service.ts`, `performance-board.service.ts` (board + drill-down), `performance-common.ts`, `performance-page.ts`.
- `createSalesOrder()` stores the default credit; `updateSalesOrder()` re-derives it when the customer changes (unless MANUAL).
- APIs: `/api/v1/sales-marketing/performance/{territories…, targets…, board, documents, orders/[id]/credit, reps}`.
- Screens: `/sales-marketing/{territories, targets, performance}`; Sales Order page → *Sales credit* panel (`SalesCreditPanel`).
- Reports: `src/modules/reports/sales-performance.reports.ts` (Target Attainment, Sales Credit Register; both also need `sales_performance.view`).

## 10. Verification (sandbox, 2026-11-03)

- Real-DB integration (`performance.integration.test.ts`, 8 tests): territory code uniqueness, overlap rules (same rep, two primaries), remove vs end, one territory per customer; default credit (territory primary / CRM owner / creator); a customer move keeps booked orders' territory; credit change needs a reason and a real change; booked rules (draft, cancelled, held-from-draft excluded; held-from-confirmed counted), posted-only invoices before GST, accepted quotations separate from booked sales; drill-down totals = board totals; target validation (period start, ended period, whole numbers, team needs a team), duplicate refused, self-approval refused, revision supersedes, send-back needs a reason, team actual = manager + reports, discard / archive; visibility (rep, manager, view_all); both reports.
- Unit: periods (month lengths, leap year, April and November fiscal years, labels), progress, attainment (no ∞ %, zero target), registry; routes (permissions and pass-through); screens (target approve flow, preparer can't approve, ended period frozen, board + drill-down, credit change).
- Rollback rehearsed on a copy of the dev DB: down script removes everything Phase 05 added and leaves orders intact; re-applying the migration back-fills credit again.

## 11. Known limitations

- Single-owner credit only (no split credit). Team totals follow today's reporting tree (moving a rep to another manager moves their history with them); rep and territory credit are stored per order and never move.
- Quotation metrics follow the quotation's current owner and the customer's current territory (quotations store no snapshot).
- Invoiced value isn't reduced by sales returns (no sales credit notes exist). Collected cash isn't offered.
- Targets cover exactly one month / quarter / year; no custom ranges, no allocation of a parent target to children.
- Figures are calculated live on every request (fine at this ERP's size; no cache to go stale).

## 12. Phase 06 (forecasting) groundwork

Phase 06 can reuse: `metricTotals()` for history by period and rep/territory, `periodContaining()/shiftPeriod()` for fiscal buckets, approved targets (`sales_targets` + latest APPROVED revision) as the comparison line, `getPerformanceScope()` for visibility, and the stored order credit for per-rep history. Pipeline inputs already exist: CRM opportunities (amount, stage probability) and open quotations (issued revisions).
