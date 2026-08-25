# Fashion ERP — Full QA/UAT Report

**Date:** 2026-08-24
**Branch:** `test_all_complete_module`
**Scope:** Every completed module in the roadmap — Phases 2–8 (Foundation, Masters, Sampling, Sales Orders,
BOM/MRP, Production, Inventory, Purchasing, Accounts, Dispatch) plus the separate CRM/Marketing/HRMS
initiative and the newly-merged Job Work module.
**Method:** Six parallel `erp-qa-uat` agent passes, each driving the real app end-to-end against the live
dev server and Postgres DB (not mocks), hand-verifying stock/ledger math via direct DB queries. A seventh
follow-up pass re-ran the portion of one pass that was environment-blocked, after a fix landed mid-session.
**Total test cases executed across all passes:** ~320+, covering create/edit/state-machine/guard/concurrency
paths across every module.

---

## 0. Fixed during this QA run (not a code change — a data/deploy gap)

Two independent passes (Foundation/Masters and CRM/Marketing/HRMS) discovered the dev database was missing
`Permission` catalog rows for the `marketing`, `hrms_attendance`, and `hrms_leave` modules entirely — making
Campaigns, Attendance, and Leave Requests return `403 PERMISSION_DENIED` for **every** user, including Super
Admin. This is a seed-data gap, not a defect in `src/config/rbac.ts` (which is correct). It was backfilled
mid-session via the same idempotent, additive script pattern this project already used for the Expenses/
Dispatch RBAC rows (`Permission.createMany({skipDuplicates:true})` + `RolePermission.upsert` per role,
scoped to just these 3 modules) — 30 permission rows + 54 role_permission links added, zero other data
touched. The dev server was restarted afterward to clear `PermissionService`'s in-process cache. A follow-up
QA pass confirmed the fix: every previously-blocked Marketing/HRMS test now passes.

**Still present, not yet cleaned up:** a stale, orphaned `"masters"` permission module (10 rows, pre-dating
the `masters_core`/`masters_finance` split) that CLAUDE.md's Phase B notes claim was deleted but wasn't.
Harmless (nothing references it), but worth a cleanup pass.

---

## 1. Executive Summary

| Module group | Test cases | P0 | P1 | P2 | P3 | P4 | Release verdict |
|---|---|---|---|---|---|---|---|
| Foundation / Auth / RBAC / Masters | ~90 | 0 | 2 | 2 | 6 | 3 | NOT READY (env/data gaps, code is solid) |
| Buyer Enquiry / Sampling / Sales Orders / BOM-MRP | ~43 | 0 | 0 | 0 | 1 | 2 | READY WITH MINOR ISSUES |
| Production (5C) + Job Work | ~46 | **2** | 2 | 2 | 5 | 1 | **NOT READY** |
| Inventory + Purchasing (Phase 6) | 29 | 0 | 0 | 0 | 1 | 0 | READY FOR PRODUCTION |
| Accounts (Phase 7) + Dispatch (Phase 8) | 40 | 0 | 1* | 1 | 1 | 0 | READY WITH MINOR ISSUES (*likely env, not confirmed code defect) |
| CRM / Marketing / HRMS | ~30 | 0 | 3 | 0 | 2 | 1 | READY (CRM/Marketing) / NOT READY (HRMS Leave) |

**Overall: NOT READY for a full production go-live**, specifically because of two confirmed P0
stock-corruption defects in Production/Job Work. Every other module group is either fully clean or has only
non-corrupting, low-risk findings. No P0 issues were found outside Production/Job Work.

---

## 2. P0 — Critical (data corruption, fix before release)

### P0-1. Re-forwarding or re-QC-inspecting a Job Order that already completed at a final stage double-posts stock and un-completes its Lot
**Module:** Production — `job-order.service.ts`
**Found by:** Production + Job Work pass

A Job Order that reaches an `isFinal`-flagged stage (e.g. Packing) completes and posts a
`PRODUCTION_RECEIPT` to Finished Goods — but neither `forwardJobOrder()` nor `recordQcInspection()` checks
`jobOrder.status === "COMPLETED"` before acting again (both only exclude `CANCELLED`). Reproduced two ways:

- **Forward again** on an already-completed final-stage job order → succeeds, creates a phantom downstream
  job order, and silently flips the parent **Lot** back from `COMPLETED` to `IN_PROGRESS`.
- **QC-inspect again** with a damage disposition on an already-completed final-stage job order (10 units
  already in Finished Goods) → succeeds; the job order's own `completedQuantity`/`damagedQuantity` update
  correctly, but **Finished Goods stock is never decremented** — the ledger now shows 10 in FG *and* +5 at
  WIP-damage for the same physical 10 units (15 tracked vs. 10 real).

This is the same bug *class* as the previously-fixed ERP-BUG-0001 (which is confirmed still fixed for the
manual-forward case) — just unguarded at the final-stage boundary instead.

**Fix:** add an explicit `if (jobOrder.status === "COMPLETED") throw INVALID_STATE_TRANSITION` guard to the
top of both `forwardJobOrder()` and `recordQcInspection()`.
**Regression risk of the fix:** low — purely adds a new rejection path; nothing legitimate depends on acting
on an already-completed job order again.

### P0-2. Job Work material issuance has no stock-sufficiency check — silently drives raw-material stock negative
**Module:** Production — `job-work-order.service.ts`, `createJobWorkOrder()`
**Found by:** Production + Job Work pass

Every sibling inventory-affecting flow in this codebase (Material Request's `issueMaterialRequestLine()`,
Stock Movement's `createStockMovement()`) calls `getAvailableQuantity()` before decrementing stock. Job Work
Order's material-issuance loop does not — it posts a negative `InventoryTransaction` for each material line
unconditionally. Reproduced: issuing 25 PCS of a material with only 20 on hand succeeded outright (`201`,
no warning), leaving `quantityOnHand: -10` after a further legitimate issue. Directly violates this
project's own stated rule that stock must never go negative without an explicit, audited override.

**Fix:** add the same `getAvailableQuantity()` pre-check used by Material Request/Stock Movement, throwing
`INSUFFICIENT_RAW_MATERIAL_STOCK` before the ledger write.
**Note:** the QA agent that found this corrected the negative balance it caused via the app's own Stock
Movement → Adjustment feature before finishing (documented, audited, reversible — not a manual DB edit).

---

## 3. P1 — High (broken functionality, real business-rule gaps)

### P1-1. Cancelling a Job Work Order never reverses the raw material it already issued
**Module:** Production — `job-work-order.service.ts`, `transitionJobWorkOrderStatus()`
Cancelling an order with 5 PCS already issued leaves the stock ledger completely unchanged — the material
is permanently "lost" from the warehouse's perspective even though the job it was issued for no longer
exists. Compounds P0-2. **Fix:** on cancel, post a compensating positive `InventoryTransaction` per material
line, mirroring `reverseGoodsReceiptLine()`'s existing "reversing entry, never arithmetic" convention.

### P1-2. The "Adjustment Entry" correction feature crashes with a raw 500 on every single call
**Module:** Production — `job-order.service.ts`, `recordAdjustmentEntry()`
Fails a foreign-key constraint (`job_order_progress_entries_employee_id_fkey`) because it passes
`employeeId: actor.userId` — a `User` id, not an `Employee` id — with no resolution through the existing
`User.employeeId` link. This is the one sanctioned way to correct a mistaken progress entry, and it is
completely unusable today. Zero test coverage exists for this function, which is why it was never caught.
**Fix:** resolve the acting user's linked `Employee` via `User.employeeId`; decide how to handle an actor
(e.g. Super Admin) with no linked Employee.

### P1-3. No UI or API exists anywhere to create additional Users or assign Roles
**Module:** Administration / RBAC (cross-cutting)
**Found independently by:** Foundation/Masters pass *and* the CRM/Marketing/HRMS follow-up pass
`/admin` 404s; `GET /api/v1/users` is read-only (id+fullName for dropdowns); no `POST /users` or
`UserBranchRole` mutation route exists anywhere. The DB has exactly one user — the seeded Super Admin. This
means: (a) the app's fully-built, well-tested 13-role RBAC matrix cannot actually be exercised by anyone but
one person, and (b) it structurally blocked live reproduction of P1-4 below and most of the role-based
testing this QA pass was asked to perform. **Fix:** build a minimal Administration → Users screen (create
user + assign role/branch).

### P1-4. Leave Request approval has no self-approval guard
**Module:** HRMS — `leave.service.ts`, `POST /api/v1/leave-requests/[id]/approve`
**Found by:** CRM/Marketing/HRMS pass; confirmed via code review (live repro blocked by P1-3)
The approve route calls `PermissionService.assert(userId, "hrms_leave", "approve")` with **no**
`resourceContext: { createdBy }` — unlike every other approval checkpoint in the app (Journal, Payment,
Sales/Purchase Invoice, Expense, and — confirmed as a positive control — Campaign's own `approveCampaign()`,
which correctly passes it). `MANAGEMENT` holds both `create` and `approve` on `hrms_leave`, so a
MANAGEMENT-role user could approve their own leave request the moment a second user account exists (see
P1-3). Directly contradicts CLAUDE.md's own stated segregation-of-duties rule. **Fix:** pass
`resourceContext: { createdBy: existing.createdByUserId }`, mirroring Campaign's pattern exactly.

### P1-5. Lead/Deal/Campaign (and Sampling) detail/edit pages render full record data with zero server-side permission check
**Module:** CRM, Marketing — project-wide architectural pattern
**Found by:** CRM/Marketing/HRMS pass
`leads/[id]`, `leads/[id]/edit`, `deals/[id]`, `deals/[id]/edit`, `campaigns/[id]`, `campaigns/[id]/edit`,
and the Marketing Dashboard are Server Components that call the service layer directly with only
`companyId` scoping — no `PermissionService.assert` anywhere in the chain — even though the equivalent API
routes correctly gate on `view`. Live-proven: the Marketing Dashboard rendered full budget/spend/ROAS data
for a session that gets `403` on the equivalent API call. The identical pattern was confirmed pre-existing
in Sampling's own detail page (`sampling/[id]/page.tsx`) — this is a codebase-wide gap, not new to
CRM/Marketing. Mutations remain protected; this is a **read/confidentiality** gap, not a data-integrity one.
**Fix:** add `PermissionService.assert(..., "view")` at the top of each such Server Component page.

### P1-6 (likely environment, needs isolated re-verification). `GET /api/v1/purchase-orders/[id]` hung indefinitely under this session's heavy concurrent load
**Module:** Purchasing/Accounts
**Found by:** Accounts + Dispatch pass
Reproduced 4 times over several minutes (even for a bogus UUID, and even while sibling `[id]` routes on
other modules kept succeeding fast) — breaks the real "New Purchase Invoice" form once a PO is selected.
The agent's own assessment: most likely a Turbopack dev-compile stall specific to this route, plausibly
triggered by 6 QA agents hammering the same dev server simultaneously — **not confirmed as a deterministic
code defect**. Recommend re-testing this specific route in isolation (single session, no concurrent load,
ideally a production build) before treating it as a real bug.

---

## 4. P2 — Medium

| # | Module | Finding |
|---|---|---|
| P2-1 | Foundation, systemic | Any malformed (non-UUID) `:id` on a Masters API route returns a raw `500` instead of a clean `400`/`404` (confirmed on 2+ modules; `toErrorResponse()` has no handler for a bad-UUID Prisma error). |
| P2-2 | Foundation, systemic | Duplicate-code checks (`findFirst`-then-`create`) are not race-safe — 5 concurrent identical `POST /colors` produced 1 success, 3 clean `409`s, and 1 raw `500` (unhandled Prisma `P2002`). Same `findFirst`-then-`create` pattern exists in 10+ other service files. |
| P2-3 | Production | QC's `accepted+rejected+damaged === inspected` validation uses exact float equality (`0.1+0.2 !== 0.3` in JS) instead of the epsilon tolerance used by every other quantity check in the same module — rejects mathematically-correct decimal splits. |
| P2-4 | Production | Production Order creation has no cap against the linked Sales Order item's real ordered quantity — a 500-piece Production Order can be created against a 5-piece order with zero pushback, and multiple Production Orders can silently attach to the same Sales Order line. |
| P2-5 | Accounts | Reversing an already-reversed Journal (or racing two simultaneous reversal calls) returns a raw `500` instead of a clean `409` — the DB's `@unique` constraint on `reversalOfJournalId` correctly *prevents* the double-reversal (no data corruption), but `reverseJournal()` never pre-checks for an existing reversal before relying on that constraint. |

---

## 5. P3 — Low (real, but low business impact / easy workaround)

| # | Module | Finding |
|---|---|---|
| P3-1 | Sampling | `SampleVersion.status` stays frozen at "IN_DEVELOPMENT" through Internal QC and Submitted-to-Customer instead of tracking the header's real stage — display-only staleness, doesn't affect any gate/lock logic. |
| P3-2 | Inventory | `OVER_RECEIPT_NOT_ALLOWED`'s message doesn't state the ordered/received/remaining quantities, unlike the equivalent `Available: X, Requested: Y` message pattern used elsewhere in the same codebase (the guard itself is correctly enforced). |
| P3-3 | Accounts | Journal detail page shows "Total 0.00 / 0.00" for a DRAFT journal despite correctly-populated line rows — `totalDebit`/`totalCredit` are only computed at post time by design, but the page doesn't sum the lines client-side (the create form and confirm-dialog, one line below, already do). |
| P3-4 | Foundation | Sidebar "Administration" link 404s — no page exists behind it despite the module being fully seeded. |
| P3-5 | Foundation | `DELETE` on Customer/Supplier/Employee is an unconditional soft-delete with no transactional-reference check and no restore path (risk contained: only SUPER_ADMIN has this permission, and no UI button calls it). |
| P3-6 | Foundation | Buyer records (nested under Customer) have no update/deactivate capability at all — a typo can never be corrected. |
| P3-7 | Foundation | `UnitOfMeasure` has no `isActive` field or delete route — once created, a unit can never be hidden. |
| P3-8 | Foundation | Bulk variant generation accepts a deactivated Color with no warning, inconsistent with the inactive-master exclusion pattern enforced elsewhere (e.g. Expense's COGS exclusion). |
| P3-9 | Production/Job Work | Internal worker Assignment and the external Job-Work-Issue pool are uncoordinated — the same unprocessed quantity can be double-committed to both a worker and an external contractor simultaneously. |
| P3-10 | Production | QC schema requires `reworkTargetStageId` for any non-PASS result, even a pure-damage disposition — which can never be satisfied at the very first production stage (no earlier stage exists to name). |
| P3-11 | Production | `forwardJobOrder()`'s API response body is stale relative to the true post-transaction DB state when the forward lands on a final stage (shows `PENDING`/`0` when the true state, set later in the same transaction, is `COMPLETED`). |
| P3-12 | Job Work | List view shows a nonzero "Pending" quantity for a `CANCELLED` order. |
| P3-13 | Job Work | `job_work_orders`' 3-column quantity cap has no Postgres CHECK constraint backstop, unlike the analogous `job_orders` table's documented `job_orders_quantity_consistency_check`. |
| P3-14 | CRM | `PATCH /leads/:id` silently un-assigns the lead (`assignedToUserId: null`) when the field is simply omitted from the payload — not reachable through the real form (which always includes it), but a real API-contract gap for any future direct consumer. |
| P3-15 | Marketing/HRMS | Ad Integrations / Attendance / Channel-Performance pages don't check `res.ok` before consuming the response body — would crash (uncaught `TypeError`) or hang on "Loading…" forever for any role without view access, or during a genuine outage. Downgraded from P2 after the permission fix removed the only trigger reachable by Super Admin. |

---

## 6. P4 — Cosmetic / informational

- Departments' `pageSize` query param is silently ignored while `meta.totalPages` reports as if it were honored (never reachable through the real UI, which doesn't send this param).
- Inconsistent PATCH partial-update semantics across masters (`Employee` allows a true partial update; `Customer`/`Supplier`/`Color` require the full object).
- Masters Zod schemas aren't `.strict()` — a mistyped field name is silently dropped rather than rejected.
- MRP's `/requirements` endpoint returns raw floating-point noise (`103.60000000000002`) in JSON — no UI impact, already formatted client-side.
- MRP's `contributingStyles` lists the same style twice when two color-scoped BOM lines both reference it, instead of one merged entry (numbers are correct, just less legible).
- Lead CSV import reports only the first validation issue per row instead of aggregating all of them (Deal import already does this correctly).

---

## 7. What passed cleanly (selected highlights, by module)

- **Auth/session:** login, 5-attempt/15-minute lockout (verified live against the real account), session/cookie behavior, clean sign-out — all correct.
- **RBAC (code-level):** default-deny whitelist confirmed with no implicit-allow branch; `masters_finance` vs `masters_core` split correctly enforced at the route level; self-approval guard correctly wired everywhere except HRMS Leave (P1-4); 310/310 unit tests passing throughout the session with zero regressions from any fix applied.
- **Masters (all 15 entity groups):** full CRUD, sequential/mnemonic auto-numbering, duplicate-code rejection, active/inactive toggle with confirmation, nested Buyers/Locations, nested UOM conversion with the depth-1 guard — all correct.
- **Buyer Enquiry → Sampling → Sales Orders → BOM/MRP → Material Request:** the entire pipeline reconciles end-to-end, including two genuine concurrency races (double-convert, double-confirm) both resolving to exactly one winner with no double-linking.
- **Purchasing & Inventory:** Purchase Order lifecycle, Goods Receipt with fabric-roll tracking and UOM conversion (hand-verified YDS→MTR math), Material Request's two independent guards (line-cap vs. real-stock-cap), Generate-PO-from-shortfall's supplier grouping and shortfall-not-original-quantity math, Stock Movements — 29/29 test cases passed with zero stock-integrity issues.
- **Accounts:** balanced/unbalanced journal posting, reversal-nets-to-zero, the `sourceModule` reversal lock (PAYMENT/SALES_INVOICE/PURCHASE_INVOICE/EXPENSE), partial+repeatable Purchase Invoicing at a manually different price, the cross-module Goods-Receipt-vs-invoiced-floor guard, Payments' PAID/PARTIALLY_PAID derivation and a genuine concurrent double-approval race resolving correctly, Expenses' COGS exclusion and tax-journal line numbering. Trial balance reconciled exactly before and after all testing.
- **Dispatch:** carton exact-match validation, FG stock decrement, over-dispatch block with exact available/requested figures, the dispatched-at-based permanent cancel lock, and — the specific regression this pass was asked to check — editing a Sales Order is correctly blocked once *any* Dispatch (including a cancelled one) references it.
- **Production/Job Order core:** stage-graph validation, the 3-column quantity cap, Forward/Revert, Split/Merge blocking rules, and a genuine concurrent-forward race all held correctly. **Both of the two previously-fixed QC bugs (ERP-BUG-0001/0002 from the last Phase 5C QA pass) remain fixed** — re-verified with fresh live reproductions.
- **Job Work (core lifecycle):** create, partial/full receive, receipt reversal, double-reverse block, Hold/Resume/Close status guards all correct — only the stock-affecting edges (issuance guard, cancel-reversal) have the P0/P1 gaps above.
- **CRM:** Lead lifecycle, duplicate detection, Lead Priority (live threshold recompute with no migration), Deal stage machine, Deal→Customer conversion guards, Customer 360, Kanban, Dashboard (every number hand-verified), follow-up automation (idempotent, no double-notification), CSV import for Leads/Deals.
- **Marketing (after the permission fix):** Campaign approval workflow, daily metrics, attribution, Channel Performance (hand-verified 757.1% ROI), Dashboard/trend charts (hand-verified 8.57× ROAS), CSV import for Campaign Daily Metrics.
- **HRMS (after the permission fix):** Attendance late/on-time derivation against a real Shift, Leave Request creation/approval/rejection and the live-computed (never stored) balance-exceeded guard.

---

## 8. Release recommendation

**Do not release as-is.** The two P0 findings (P0-1, P0-2) are confirmed, reproducible stock-corruption
defects in Production/Job Work — both are small, well-scoped fixes (an extra status guard; an existing
stock-check helper reused in one more place) with low regression risk, but they must land first.

Recommended order:
1. Fix P0-1 and P0-2 (Production/Job Work stock corruption) — blocking.
2. Fix P1-1 through P1-6 — high priority, none are architecturally hard.
3. Everything else (P2–P4) can follow in normal triage; none are release-blocking on their own.

Every other module group (Sampling→Sales Orders→BOM/MRP, Inventory/Purchasing, Accounts, Dispatch, CRM,
Marketing, and — once P1-4 lands — HRMS) is either fully clean or has only low-risk, non-corrupting findings.

---

## 9. Test data left in the system

Every pass followed this project's own "transactional documents have no delete endpoint by design" convention
— cancellable test records were cancelled, non-cancellable ones were left in place with clear `TEST-`/`QA-`
prefixes in their name/remarks/notes fields, and each pass retained roughly one demo record per major flow
as reproducible evidence. Stock/ledger side effects caused during testing (the negative balance from P0-2's
reproduction) were corrected through the app's own features (Stock Movement Adjustment), not manual DB
writes. Full per-pass inventories of exactly what was left are in each agent's own report section above (not
reproduced here for length) — nothing outside clearly-marked test records was modified.

---

## 10. Source reports

This document consolidates seven `erp-qa-uat` agent passes:
1. Foundation, Auth/RBAC & Masters (Phase 2/3)
2. Buyer Enquiry, Sampling, Sales Orders, BOM/MRP (Phase 4/5A/5B)
3. Production + Job Work (Phase 5C + new module)
4. Inventory & Purchasing (Phase 6)
5. Accounts + Dispatch (Phase 7/8)
6. CRM / Marketing / HRMS — initial pass (partially blocked by the permission-catalog gap)
7. CRM / Marketing / HRMS — follow-up pass (after the fix, completing the blocked scope)

Full verbatim findings, repro steps, and file references for every item above are preserved in the session
transcript this report was generated from.
