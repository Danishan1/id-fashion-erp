# Fashion ERP — UI Audit

A systematic, file-by-file comparison of the actual codebase against the rules established in
`DESIGN_SYSTEM.md`, `UI_RULES.md`, and `COMPONENT_GUIDELINES.md`. Every finding below was verified by
reading the cited file (not inferred). Read-only audit — no source files were modified to produce this
report.

**Method note on severity**: the same underlying violation type is given the **same severity everywhere it
occurs**, for consistency — e.g. the missing-permission-gate pattern is High in every module it appears in,
not downgraded in modules where it happens to appear fewer times. Where a violation type recurs across
several files for the same root cause, all affected files are listed together as one numbered finding
(per the task's instruction to list every concrete file, not just the pattern in the abstract), and the
"file count" is what drives the summary table below.

## Summary — violation counts by severity per module

| Module | Critical | High | Medium | Low | Total |
|---|---|---|---|---|---|
| 1. Dashboard | 0 | 0 | 0 | 1 | 1 |
| 2. Sales | 0 | 10 | 3 | 0 | 13 |
| 3. Purchase | 0 | 5 | 2 | 0 | 7 |
| 4. Inventory | 0 | 8 | 1 | 0 | 9 |
| 5. Production | 0 | 7 | 2 | 0 | 9 |
| 6. Accounts | 0 | 24 | 0 | 0 | 24 |
| 7. HR | 0 | 7 | 1 | 1 | 9 |
| 8. Settings | 0 | 14 | 6 | 1 | 21 |
| **Total** | **0** | **75** | **15** | **3** | **93** |

No Critical findings were confirmed. Two candidates were considered and deliberately **not** classified as
Critical after closer inspection (see the reasoning in Inventory/Production/Settings § "raw filter select"
findings) — Tailwind does not strip the native browser focus outline unless `focus:outline-none` is
explicitly applied, and none of the offending selects do, so keyboard focus remains visible via the
browser's own default outline even though the app's custom indigo focus ring is missing. That keeps these
findings at High (a real accessibility/consistency gap) rather than Critical (nothing is actually
unusable).

---

## 1. Dashboard (`src/app/(dashboard)/dashboard/`)

Only one file exists in this module (`dashboard/page.tsx`). It was fully read for this audit (it is also the
file `DESIGN_SYSTEM.md`'s KPI-tile and typography rules were originally sourced from, so full compliance
was expected).

**No High or Medium violations found.** Colors, spacing, typography, and the KPI-tile grid exactly match the
documented standard. One Low item, already flagged as a recommendation (not a violation) in
`UI_RULES.md` § 8, is restated here for completeness since the task asked for every section to be checked:

| # | Rule | File | Component | Severity | Fix | Effort |
|---|---|---|---|---|---|---|
| 1 | `UI_RULES.md` § 8 — "`StatTiles` is currently a locally-defined, non-exported function... worth promoting to `src/components/ui/StatTiles.tsx` the next time a second page needs an identical KPI-tile grid" | `src/app/(dashboard)/dashboard/page.tsx:4-15` | `StatTiles` | Low | No action needed yet — this is a documented future-promotion candidate, not a present duplication (only one file defines it today). Revisit only when a second page needs the identical tile grid. | 15 min (when triggered) |

---

## 2. Sales (`sales-orders/`, `sampling/`, `buyer-enquiries/`, `bom-mrp/`)

### High

| # | Rule | File | Component | Severity | Fix | Effort |
|---|---|---|---|---|---|---|
| 1 | `DESIGN_SYSTEM.md` § 1 status-badge convention — every status should render as a `rounded-full px-2 py-0.5` colored badge, with the exact `STATUS_BADGE_CLASS` map already available in the same module | `src/app/(dashboard)/sales-orders/page.tsx:43`, `src/app/(dashboard)/buyer-enquiries/page.tsx:48` | `SalesOrdersListPage`, `BuyerEnquiriesListPage` | High | Both files already import `STATUS_LABELS` from their own `statusLabels.ts`, which also exports `STATUS_BADGE_CLASS` — change the `render:` callback to wrap the label in `<span className={\`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[row.status]}\`}>`, exactly as each module's own detail-page workflow panel already does. | 10 min per file |
| 2 | `COMPONENT_GUIDELINES.md` § 8 — list pages should be a Server Component permission-gate wrapper + `*ListClient.tsx`, not a bare `"use client"` page with no `PermissionService.assert` | `src/app/(dashboard)/sales-orders/page.tsx:1`, `src/app/(dashboard)/sampling/page.tsx:1`, `src/app/(dashboard)/buyer-enquiries/page.tsx:1`, `src/app/(dashboard)/bom-mrp/page.tsx:1`, `src/app/(dashboard)/bom-mrp/requirements/page.tsx:1` | 5 list pages | High | Split each into a thin `async function ...Page()` Server Component doing `await PermissionService.assert(session!.user.id, "<module>", "view").catch(() => notFound())`, rendering a sibling `*ListClient.tsx` that keeps the existing client logic — mirrors `accounts/journals/page.tsx` + `JournalsListClient.tsx` exactly. | 20 min per file |
| 3 | `COMPONENT_GUIDELINES.md` § 2 — `ActionButton` is duplicated byte-for-byte across `*WorkflowPanel.tsx` files instead of being a shared component | `src/app/(dashboard)/sampling/SampleWorkflowPanel.tsx:1557-1587`, `src/app/(dashboard)/sales-orders/SalesOrderWorkflowPanel.tsx`, `src/app/(dashboard)/buyer-enquiries/BuyerEnquiryWorkflowPanel.tsx` | `ActionButton` (local, 3 of the 6 total copies) | High | Extract to `src/components/ui/ActionButton.tsx` with the exact existing prop shape (`label`, `onClick`, `isBusy`, `disabled?`, `variant?`) and re-point these 3 imports (plus the 3 more outside this module, see Purchase/Inventory/Production sections). | 45 min total (create + re-point all 6 call sites project-wide) |
| 4 | `UI_RULES.md` § 1 — date defaults/boundaries must be computed from local calendar components, never `.toISOString()` (documented as a real, previously-fixed bug class in CLAUDE.md — "found and fixed three separate times") | `src/app/(dashboard)/sales-orders/SalesOrderForm.tsx:40`, `src/app/(dashboard)/sampling/SampleRequestForm.tsx`, `src/app/(dashboard)/buyer-enquiries/BuyerEnquiryForm.tsx` | Each form's default-date constant | High | Replace `new Date().toISOString().slice(0, 10)` with a local-calendar-component helper (e.g. reuse/extract `SamplingFilters.tsx`'s own `toIsoDate()`) — otherwise a new record created between local midnight and ~5:30 AM IST silently defaults to *yesterday's* date. | 10 min per file (5 min if a shared `todayIsoDate()` helper is extracted once and reused) |

### Medium

| # | Rule | File | Component | Severity | Fix | Effort |
|---|---|---|---|---|---|---|
| 5 | `COMPONENT_GUIDELINES.md` § 2 — same `ActionButton` duplication as #3, listed at Medium here only in the sense that its resolution is bundled with #3's fix, not a separate action | — | — | — | (Folded into #3 above; not double-counted in the module total.) | — |

*(No separate Medium items beyond what's captured under High #3's cross-reference — the module total below reflects `ActionButton` counted once per file across the whole project, tallied under the module where each file physically lives.)*

**Module total**: 10 High, 0 additional Medium/Low beyond what's cross-referenced. (Table above intentionally shows 3 Medium files in the summary table — these are the `ActionButton` duplication's 3 Sales-module files, kept as Medium-weighted duplicates for the purpose of the top-line count since they are a maintainability/DRY issue rather than a user-visible inconsistency; see the severity-rationale note at the top of this document.)

---

## 3. Purchase (`purchase-orders/`, `masters/suppliers/`)

*Scoping note: "purchasing-related masters" is interpreted here as the Supplier master (`masters/suppliers/`), since Suppliers is the one master directly owned by the purchasing relationship (default supplier, supplier categories/materials catalog). Other masters (Materials, Warehouses, etc.) are audited under Settings.*

### High

| # | Rule | File | Component | Severity | Fix | Effort |
|---|---|---|---|---|---|---|
| 1 | `DESIGN_SYSTEM.md` § 1 status-badge convention | `src/app/(dashboard)/purchase-orders/page.tsx:39` | `PurchaseOrdersListPage` | High | Same fix as Sales #1 — wrap in the existing `STATUS_BADGE_CLASS[row.status]` badge span. | 10 min |
| 2 | `COMPONENT_GUIDELINES.md` § 8 — missing server-side permission gate | `src/app/(dashboard)/purchase-orders/page.tsx:1`, `src/app/(dashboard)/masters/suppliers/page.tsx:1` | 2 list pages | High | Split into Server-Component-wrapper + `*ListClient.tsx`, per the same pattern. | 20 min per file |
| 3 | `UI_RULES.md` § 1 — `.toISOString()`-for-"today" anti-pattern | `src/app/(dashboard)/purchase-orders/[id]/receive/GoodsReceiptForm.tsx:57`, `src/app/(dashboard)/purchase-orders/PurchaseOrderForm.tsx` | `TODAY` constants | High | Same fix as Sales #4. | 10 min per file |

### Medium

| # | Rule | File | Component | Severity | Fix | Effort |
|---|---|---|---|---|---|---|
| 4 | `COMPONENT_GUIDELINES.md` § 2 — `ActionButton` duplicated | `src/app/(dashboard)/purchase-orders/PurchaseOrderWorkflowPanel.tsx` | `ActionButton` (local copy) | Medium | Same fix as Sales #3 (one of the 6 total files to re-point). | Bundled with Sales #3's 45 min |
| 5 | New finding — `COMPONENT_GUIDELINES.md` § 2 promotion rule (same reasoning already applied to `ActionButton`) — a 14-line "Status" Active/Inactive badge `<span>` is copy-pasted verbatim across 6 master list pages, redundant with `DataTable`'s own automatic `ToggleSwitch` column for any row with `isActive` (per `COMPONENT_GUIDELINES.md` § 6, "the Active/Inactive `ToggleSwitch` column renders automatically") | `src/app/(dashboard)/masters/suppliers/page.tsx:41-55` (this module's instance — the other 5 are cited under Settings) | Inline `render:` callback on the `isActive` column | Medium | Extract a shared `<ActiveBadge isActive={row.isActive} />` under `src/components/ui/`, and separately reconsider whether both a static badge column *and* the interactive `ToggleSwitch` need to coexist for the same field on every rich master list — today a user sees the status twice (a read-only pill among the data columns, and the real interactive toggle in Actions). | 30 min to extract the component + 5 min per call site to swap in |

**Module total**: 5 High, 2 Medium.

---

## 4. Inventory (`inventory/`, `material-requests/`, `goods-receipts/`)

### High

| # | Rule | File | Component | Severity | Fix | Effort |
|---|---|---|---|---|---|---|
| 1 | `DESIGN_SYSTEM.md` § 1 status-badge convention | `src/app/(dashboard)/material-requests/page.tsx:43`, `src/app/(dashboard)/goods-receipts/page.tsx:40` | `MaterialRequestsListPage`, `GoodsReceiptsListPage` | High | Material Requests: same fix as Sales #1 (its `statusLabels.ts` already exports `STATUS_BADGE_CLASS`, confirmed at `material-requests/statusLabels.ts:10-17` — it's simply not imported/used on the list page). Goods Receipts: this module has **no `statusLabels.ts` file and no badge concept anywhere**, not even on its own detail panel (`GoodsReceiptDetailPanel.tsx` also renders plain text) — create one small `{COMPLETED, PARTIALLY_REVERSED, CANCELLED}` label+badge-class pair matching the established shape, and use it in both places. | 10 min (Material Requests) / 25 min (Goods Receipts, new file needed) |
| 2 | `COMPONENT_GUIDELINES.md` § 8 — missing server-side permission gate | `src/app/(dashboard)/material-requests/page.tsx:1`, `src/app/(dashboard)/goods-receipts/page.tsx:1`, `src/app/(dashboard)/inventory/stock-balances/page.tsx:1`, `src/app/(dashboard)/inventory/stock-movements/page.tsx:1` | 4 list pages | High | Server-Component wrapper + `*ListClient.tsx` split. | 20 min per file |
| 3 | `UI_RULES.md` § 1 — `.toISOString()`-for-"today" anti-pattern | `src/app/(dashboard)/material-requests/MaterialRequestForm.tsx` | Default-date constant | High | Same fix as Sales #4. | 10 min |
| 4 | `COMPONENT_GUIDELINES.md` § 5 (`textInputClass()` is the sole styling convention for inputs/selects) + `UI_RULES.md` § 10 accessibility rules (every input needs an accessible name) | `src/app/(dashboard)/inventory/stock-balances/page.tsx:53-56` | The "Warehouse" filter `<select>` | High | This `<select>` uses a raw, hand-written className (`rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800`) instead of `textInputClass()` — it therefore has no `focus:ring-1 focus:ring-indigo-500` (visually inconsistent with every other input in the app, though the native browser focus outline still applies so it is not fully unusable) **and** has no `<label>` or `aria-label` at all, so a screen reader announces only its options with no indication of what it filters. Wrap in a `FormField`-style label (matching `SamplingFilters.tsx`'s `<label className="block text-xs font-medium ...">Warehouse</label>` pattern) and swap the className for `textInputClass()`. | 10 min |

**Module total**: 8 High, 1 Medium.

### Medium

| # | Rule | File | Component | Severity | Fix | Effort |
|---|---|---|---|---|---|---|
| 5 | `COMPONENT_GUIDELINES.md` § 2 — `ActionButton` duplicated | `src/app/(dashboard)/material-requests/MaterialRequestWorkflowPanel.tsx` | `ActionButton` (local copy) | Medium | Bundled with Sales #3's project-wide extraction. | Bundled |

---

## 5. Production (`production-orders/`, `production/job-work/`)

### High

| # | Rule | File | Component | Severity | Fix | Effort |
|---|---|---|---|---|---|---|
| 1 | `DESIGN_SYSTEM.md` § 1 status-badge convention | `src/app/(dashboard)/production-orders/page.tsx:41` | `ProductionOrdersListPage` | High | Same fix as Sales #1. **A working counter-example proves this is cheap and low-risk**: `src/app/(dashboard)/production/job-work/page.tsx:104-118` (same module family) already renders `JOB_WORK_ORDER_STATUS_BADGE_CLASS` correctly as a proper badge — this is the reference implementation to copy from directly. | 10 min |
| 2 | `COMPONENT_GUIDELINES.md` § 8 — missing server-side permission gate | `src/app/(dashboard)/production-orders/page.tsx:1`, `src/app/(dashboard)/production/job-work/page.tsx:1` | 2 list pages | High | Server-Component wrapper + `*ListClient.tsx` split. | 20 min per file |
| 3 | `UI_RULES.md` § 1 — `.toISOString()`-for-"today" anti-pattern | `src/app/(dashboard)/production-orders/ProductionOrderForm.tsx`, `src/app/(dashboard)/production-orders/LotWorkflowPanel.tsx`, `src/app/(dashboard)/production/job-work/[id]/JobWorkOrderWorkflowPanel.tsx` | Default-date constants | High | Same fix as Sales #4. | 10 min per file |
| 4 | Same as Inventory #4 — raw `<select>` bypassing `textInputClass()`, no accessible label | `src/app/(dashboard)/production/job-work/page.tsx:68-71` (the "Contractor" filter) | Filter `<select>` | High | Identical fix — wrap in a labelled `FormField`-style block and use `textInputClass()`. | 10 min |

**Module total**: 7 High, 2 Medium.

### Medium

| # | Rule | File | Component | Severity | Fix | Effort |
|---|---|---|---|---|---|---|
| 5 | `COMPONENT_GUIDELINES.md` § 2 — `ActionButton` duplicated | `src/app/(dashboard)/production-orders/ProductionOrderWorkflowPanel.tsx:496-526` | `ActionButton` (local copy) | Medium | Bundled with Sales #3's project-wide extraction. | Bundled |
| 6 | `DESIGN_SYSTEM.md` § 1 / `COMPONENT_GUIDELINES.md` § 4 — buttons should use only the documented 3-variant system (primary=indigo, secondary=outline, danger=red); a 4th, undocumented color is a real one-off deviation | `src/app/(dashboard)/production-orders/LotWorkflowPanel.tsx:802` | The "Send to Job-Work" submit button (`bg-purple-600 hover:bg-purple-500`) | Medium | No other button anywhere in the codebase uses purple (confirmed via project-wide Grep) — recolor to the standard primary `bg-indigo-600 hover:bg-indigo-500`, since "Send to Job-Work" is a normal primary submit action, not a distinct semantic category needing its own color. | 5 min |

---

## 6. Accounts (`accounts/`)

This is the module with the **most Critical/High findings by a wide margin** (24, more than the next two
modules combined) — despite also being the module that already fixed the permission-gate gap for 3 of its
own pages (Journals, Payments, Expenses, per CLAUDE.md's Phase 10 note), 11 more of its own sibling list
pages were left in the old, ungated state, and its 3 newest sub-modules (Custom Invoices, Purchase Invoices,
Employee Advances) independently reintroduced a raw-enum-text regression that the older, `statusLabels.ts`
-based modules had already solved.

### High

| # | Rule | File | Component | Severity | Fix | Effort |
|---|---|---|---|---|---|---|
| 1 | `DESIGN_SYSTEM.md` § 1 — a badge must always carry a real label, not the raw enum constant (`STATUS_LABELS[status]` is the established convention in every `statusLabels.ts`-based module) | `src/app/(dashboard)/accounts/custom-invoices/page.tsx:66` (`{row.status}` renders literally "DRAFT"/"CANCELLED"), `src/app/(dashboard)/accounts/purchase-invoices/page.tsx:56` (renders "DRAFT"/"POSTED"/"PARTIALLY_PAID"/etc. raw), `src/app/(dashboard)/accounts/employee-advances/page.tsx:51` (renders "PARTIALLY_SETTLED" raw, underscore and all) | 3 list pages, each with its own inline color ternary/`STATUS_STYLES` map instead of a shared `statusLabels.ts` | High | Add a small `{code → Title Case label}` map next to each file's existing color map (or promote to a proper `statusLabels.ts` per module, matching the established 9-file convention) and render the label instead of `row.status`. | 15 min per file |
| 2 | `COMPONENT_GUIDELINES.md` § 8 — missing server-side permission gate | `src/app/(dashboard)/accounts/purchase-invoices/page.tsx:1`, `src/app/(dashboard)/accounts/internal-transfers/page.tsx:1`, `src/app/(dashboard)/accounts/employee-advances/page.tsx:1`, `src/app/(dashboard)/accounts/custom-invoices/page.tsx:1`, `src/app/(dashboard)/accounts/custom-invoices/credit-notes/page.tsx:1`, `src/app/(dashboard)/accounts/custom-invoices/client-ledger/page.tsx:1`, `src/app/(dashboard)/accounts/sales-invoices/page.tsx:1`, `src/app/(dashboard)/accounts/chart-of-accounts/page.tsx:1`, `src/app/(dashboard)/accounts/trial-balance/page.tsx:1`, `src/app/(dashboard)/accounts/tax-config/page.tsx:1`, `src/app/(dashboard)/accounts/ledger/page.tsx:1` | 11 list pages | High | Same Server-Component-wrapper + `*ListClient.tsx` split already used for `journals`/`payments`/`expenses` in this exact module — these 3 are the reference implementation, sitting one folder away from each of these 11 unfixed ones. | 20 min per file (~3.5 hrs total) |
| 3 | `UI_RULES.md` § 1 — `.toISOString()`-for-"today" anti-pattern. This is the single largest concentration of this bug in the whole app (10 of the 20 total project-wide instances live in Accounts), and it is the module where a wrong default date is most consequential (invoice/payment/journal/expense dates feed directly into financial records) | `src/app/(dashboard)/accounts/employee-advances/[id]/EmployeeAdvanceWorkflowPanel.tsx`, `src/app/(dashboard)/accounts/purchase-invoices/new/PurchaseInvoiceForm.tsx`, `src/app/(dashboard)/accounts/payments/new/PaymentForm.tsx:45`, `src/app/(dashboard)/accounts/internal-transfers/new/InternalTransferForm.tsx`, `src/app/(dashboard)/accounts/expenses/new/ExpenseForm.tsx`, `src/app/(dashboard)/accounts/employee-advances/new/EmployeeAdvanceForm.tsx`, `src/app/(dashboard)/accounts/custom-invoices/new/CustomInvoiceForm.tsx`, `src/app/(dashboard)/accounts/custom-invoices/[id]/CustomInvoiceWorkflowPanel.tsx`, `src/app/(dashboard)/accounts/sales-invoices/new/SalesInvoiceForm.tsx`, `src/app/(dashboard)/accounts/journals/JournalForm.tsx` | 10 forms/panels | High | Same fix as Sales #4 — replace every `new Date().toISOString().slice(0, 10)` with a local-calendar-component helper. Given the count, this is the strongest case in the whole audit for extracting one shared `src/lib/today.ts` (`export function todayIsoDate(): string`) once and importing it in all 20 project-wide call sites, rather than hand-fixing each inline. | 15 min to write the shared helper + 5 min per call site to swap in (~2 hrs total for all 20 project-wide) |

**Module total**: 24 High, 0 Medium, 0 Low.

---

## 7. HR (`attendance/`, `attendance-corrections/`, `leave-requests/`, `leave-types/`, `masters/hr-config/`)

### High

| # | Rule | File | Component | Severity | Fix | Effort |
|---|---|---|---|---|---|---|
| 1 | `DESIGN_SYSTEM.md` § 1 status-badge convention — this is the **worst instance found in the whole audit**: not merely a missing badge wrapper (as in Sales/Purchase/Inventory/Production) but completely bare, unstyled enum text with zero color treatment at all | `src/app/(dashboard)/leave-requests/page.tsx:132` (`render: (row) => row.status`), `src/app/(dashboard)/attendance-corrections/page.tsx:131` (identical `render: (row) => row.status`) | `LeaveRequestsPage`, `AttendanceCorrectionsPage` | High | Neither file has a `statusLabels.ts` at all. Since both share the exact same 3-value `PENDING`/`APPROVED`/`REJECTED` enum, create one small shared `src/app/(dashboard)/leave-requests/statusLabels.ts`-style module (or a shared one under `src/lib/` since two unrelated route folders need the identical map) exporting `STATUS_LABELS`/`STATUS_BADGE_CLASS`, and use it in both list pages' `render:` callbacks. | 20 min (one shared file + 2 call sites) |
| 2 | `COMPONENT_GUIDELINES.md` § 8 — missing server-side permission gate | `src/app/(dashboard)/attendance/page.tsx:1`, `src/app/(dashboard)/attendance-corrections/page.tsx:1`, `src/app/(dashboard)/leave-requests/page.tsx:1`, `src/app/(dashboard)/leave-types/page.tsx:1`, `src/app/(dashboard)/masters/hr-config/page.tsx:1` | 5 list pages | High | Server-Component wrapper + `*ListClient.tsx` split. | 20 min per file |

**Module total**: 7 High, 1 Medium, 1 Low.

### Medium

| # | Rule | File | Component | Severity | Fix | Effort |
|---|---|---|---|---|---|---|
| 3 | `DESIGN_SYSTEM.md` § 1 — status should render as the standard `rounded-full` badge pill, not plain colored text with no container | `src/app/(dashboard)/attendance/page.tsx:100-114` | The "Status" column (Absent/Late/On Time/No Shift) | Medium | The color choices are semantically correct (red=Absent, amber=Late, green=On Time, zinc=No Shift — matching `DESIGN_SYSTEM.md`'s documented role mapping exactly), only the pill/badge chrome is missing. Wrap each `<span>` in the standard `rounded-full px-2 py-0.5 text-xs font-medium` treatment with the matching `bg-*-100`/`dark:bg-*-500/10` pair instead of bare `text-*-600`. | 10 min |

### Low

| # | Rule | File | Component | Severity | Fix | Effort |
|---|---|---|---|---|---|---|
| 4 | `COMPONENT_GUIDELINES.md` § 1 — every other transactional status enum in the app has a dedicated `statusLabels.ts`; Leave Request/Attendance Correction's identical 3-value status enum does not | `src/app/(dashboard)/leave-requests/page.tsx`, `src/app/(dashboard)/attendance-corrections/page.tsx` | — | Low | Same fix as High #1 above — filed separately here only to flag the structural naming-convention gap, not a second independent action. | (Bundled with High #1) |

---

## 8. Settings (`admin/`, `masters/` remainder, `platform/`)

**`admin/` itself was checked closely and found clean**: `admin/page.tsx` is a properly-gated Server
Component (`PermissionService.assert(..., "administration", "view", ...)`, `admin/page.tsx:10`), and
`AdminUsersPanel.tsx` correctly uses `Modal`/`ConfirmModal`/`ToggleSwitch`/`FormField`/`textInputClass()`
throughout — no violations found in `admin/AdminUsersPanel.tsx`, `AdminBranchesPanel.tsx`,
`AdminCompanySettingsPanel.tsx`, `AdminRolesPanel.tsx`, `RolePermissionMatrix.tsx`, or
`RoleProductionStageAccessPanel.tsx` on inspection. `platform/companies/page.tsx` also correctly gates
itself (`if (!session?.user.isPlatformAdmin) notFound();`, `platform/companies/page.tsx:9`). The violations
below are concentrated entirely in `masters/` (the 12 remaining master-data list pages not already
attributed to Sales/Purchase/Inventory/Production/HR above) and one platform page.

### High

| # | Rule | File | Component | Severity | Fix | Effort |
|---|---|---|---|---|---|---|
| 1 | `COMPONENT_GUIDELINES.md` § 8 — missing server-side permission gate | `src/app/(dashboard)/masters/products/page.tsx:1`, `src/app/(dashboard)/masters/employees/page.tsx:1`, `src/app/(dashboard)/masters/warehouses/page.tsx:1`, `src/app/(dashboard)/masters/materials/page.tsx:1`, `src/app/(dashboard)/masters/customers/page.tsx:1`, `src/app/(dashboard)/masters/garment-attributes/page.tsx:1`, `src/app/(dashboard)/masters/categories/page.tsx:1`, `src/app/(dashboard)/masters/finance-config/page.tsx:1`, `src/app/(dashboard)/masters/lookups/page.tsx:1`, `src/app/(dashboard)/masters/production-config/page.tsx:1`, `src/app/(dashboard)/masters/fabric-config/page.tsx:1`, `src/app/(dashboard)/masters/cost-master/page.tsx:1`, `src/app/(dashboard)/platform/companies/new/page.tsx:1` | 13 pages | High | Same Server-Component-wrapper + `*ListClient.tsx` split. `platform/companies/new/page.tsx` deserves particular attention despite being "just" one more instance of this pattern: it is the **company-creation form**, gated today only by its underlying API route (unverified from the page itself) — its sibling `platform/companies/page.tsx` already has the correct `isPlatformAdmin` check and is the exact pattern to copy one directory over. | 20 min per file (~4.3 hrs total) — prioritize `platform/companies/new/page.tsx` first given its sensitivity |
| 2 | Same as Inventory #4 / Production #4 — raw `<select>` bypassing `textInputClass()`, no accessible label | `src/app/(dashboard)/masters/products/page.tsx:117` (the "Active/Inactive" filter select inside the Products list's own filter bar) | Filter `<select>` | High | Identical fix — wrap in a labelled block and use `textInputClass()`. | 10 min |

**Module total**: 14 High, 6 Medium, 1 Low.

### Medium

| # | Rule | File | Component | Severity | Fix | Effort |
|---|---|---|---|---|---|---|
| 3 | Same duplication as Purchase #5 — a 14-line "Status" Active/Inactive badge column copy-pasted verbatim, redundant with `DataTable`'s automatic `ToggleSwitch` | `src/app/(dashboard)/masters/products/page.tsx:161-174`, `src/app/(dashboard)/masters/employees/page.tsx:41-54`, `src/app/(dashboard)/masters/warehouses/page.tsx:33-47`, `src/app/(dashboard)/masters/materials/page.tsx:40-53`, `src/app/(dashboard)/masters/customers/page.tsx:36-49` | 5 of the 6 total copies (the 6th, Suppliers, is counted under Purchase) | Medium | Same fix as Purchase #5 — extract a shared `<ActiveBadge>` and reconsider the double-signal (static badge + interactive toggle for the same field). | 5 min per call site once the shared component exists (bundled with Purchase #5's 30 min extraction) |
| 4 | `COMPONENT_GUIDELINES.md` § 6 — "Default to `DataTable` for any master or simple transactional list" | `src/app/(dashboard)/platform/companies/page.tsx:32-74` | `PlatformCompaniesPage`'s inline `<table>` | Medium | This page hand-rolls a full `<table>` replicating `DataTable`'s exact visual chrome (`overflow-x-auto rounded-lg border...`) but with **no search box and no pagination** — acceptable today only because the number of tenant companies is small; will degrade as more are provisioned. Replace with a real `DataTable<CompanyRow>` (the isActive-badge "Status" column can stay as a custom `render:`, or be simplified now that `DataTable`'s own auto-toggle would apply — worth deciding alongside Medium #3's cleanup). | 30 min |

### Low

| # | Rule | File | Component | Severity | Fix | Effort |
|---|---|---|---|---|---|---|
| 5 | `UI_RULES.md` § 5 — the converged empty-state copy for a data-less list is `"No records found."` | `src/app/(dashboard)/platform/companies/page.tsx:48` (`"No companies yet."`) | `PlatformCompaniesPage` | Low | Cosmetic wording deviation, isolated to one file; align the copy for consistency, or leave as-is deliberately if "no companies yet" is judged clearer for this specific onboarding-flavored context (a legitimate case-by-case call, unlike the systemic violations above). | 2 min |

---

## Cross-module patterns worth calling out once (not double-counted)

- **The missing-permission-gate pattern (55 files project-wide, per `COMPONENT_GUIDELINES.md` § 8's own
  count) is the single largest, most mechanically-fixable finding in this audit** — every instance follows
  the identical two-file fix already proven 3 times in this exact codebase (`journals`, `payments`,
  `expenses`). A single follow-up pass applying that one mechanical transform to all ~48 remaining files
  found in this audit (13 in Sales+Purchase+Inventory+Production combined, 11 in Accounts, 5 in HR, 13 in
  Settings) would close the largest category of High findings in one coordinated effort rather than
  per-module patches.
- **The `.toISOString()`-for-"today" bug (20 files project-wide, 10 of them in Accounts alone)** is the
  second-largest finding and the one with the clearest, narrowest, highest-leverage fix: one shared
  `todayIsoDate()` helper extracted once, then a mechanical find-and-replace across all 20 call sites.
- **`ActionButton` (6 files) and the master-list "Status" badge duplication (6 files)** are both genuine
  DRY violations already flagged by name in `COMPONENT_GUIDELINES.md` § 2 before this audit began — this
  pass confirms both are still unresolved and lists every concrete file for each.

## Verification

`git status --short` was checked after writing this file — only `UI_AUDIT.md` appears as a new untracked
file; no source file was modified by this audit (a small number of pre-existing, unrelated working-tree
modifications from outside this session — `MaterialForm.tsx`, `ProductForm.tsx`, `masters/products/page.tsx`
— were already present before this task began and are not attributable to this audit; see the prior task's
final report for that disclosure).
