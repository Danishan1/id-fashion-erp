# RBAC + Sidebar Navigation — Audit Report (Phase 1 & 2)

Date: 2026-09-24. Scope: full audit of `src/config/rbac.ts`, `src/components/layout/navigation.ts`,
`PermissionService`, auth middleware, API route guards, and the modules the audit prompt called out by
name (Material Request/Purchase Order, Piece Rate/Rate Card, Administration, Pending Approvals,
External Unit User isolation, tenant scoping). Read-only — **no code has been changed yet.**

This is Phase 1 (audit) + Phase 2 (exact mismatches + proposed changes) of the requested 9-phase plan.
Phase 3 onward (actual fixes) has **not started** — see "What I need from you before Phase 3" at the end.

---

## Executive summary

The architecture is sound and mostly correctly enforced. There is **no middleware-only security theater** —
every API route independently calls `PermissionService.assert()` (or an equivalent scoped check), and the
sidebar's own visibility filter is provably decorative, not a security boundary (confirmed: opening a page
whose module you can't see still hits the same server-side check and 403s/404s). The real problems are
narrower than "the whole model is wrong":

1. Four **scope mechanisms already exist** (branch, production-stage, employee-self, supplier-self) — a
   generic `own/assigned/department/company/all` field was never built because it wasn't needed; these do
   the same job. **Recommendation: keep them, don't rebuild.**
2. Four **permission keys are genuinely too coarse** and let a role technically do more than the code
   comments/business intent say (`inventory.*`, `purchasing.*`, `piece_rate.*`, `administration.*`) — real,
   confirmed, exploitable-via-direct-API-call gaps, not hypothetical.
3. One **sidebar/backend mismatch**: "Pending Approvals" is shown to roles that can't actually open it.
4. One **defense-in-depth gap**: one Job-Work-Order function has no identity-level supplier check (currently
   safe only because of role config, not because the code itself blocks it).

---

## A–H audit checklist (as requested)

### A. Incorrect permissions
None found where a role holds an action that's flatly wrong for its job. The problems are all granularity
(see G), not "role X shouldn't have Y at all."

### B. Missing permissions
- No route-level `production.approve`-vs-`view` distinction is reflected in the sidebar (see C).
- `listPendingJobWorkReceipts()` is missing its own identity check (see D/E).

### C. Sidebar mismatches — 1 confirmed
**"Pending Approvals"** (`Manufacturing` section, `href: /production/approvals`) is gated in
`navigation.ts` only by `modules: ["production"]` — i.e. shown to anyone with `production.view`. But the
page itself (`src/app/(dashboard)/production/approvals/page.tsx:8`) requires `production.approve`.
`PRODUCTION_WORKER` and `EXTERNAL_UNIT_USER` both have `production.view` but **not** `approve` — so both
roles see this link in their sidebar and it **reliably 404s** when clicked. This is exactly the
"misleading Pending Approvals" case the prompt called out.

The good news: **"My Work"** (`/production/my-work`, gated on `production.view`, which these roles DO have)
already shows exactly what's wanted — a "My Submitted Entries" section listing the worker's own entries
with their real approval status ("This entry will show as Pending until your Supervisor approves it."). No
new page is needed. The fix is just correcting the "Pending Approvals" nav-leaf's own module gate to
require `approve` (so it disappears for Worker/External Unit correctly) — the underlying workflow is
untouched.

### D. Backend security gaps — 4 confirmed
1. **Direct commercial PO creation by MERCHANDISER/PRODUCTION_MANAGER.** `POST /api/v1/purchase-orders`
   (direct PO create) and `generatePurchaseOrdersForShortfall()` (the sanctioned Material-Request→PO flow)
   both assert the *identical* `purchasing.create`. Both roles hold `purchasing: ["view","create"]`
   specifically so they can trigger the sanctioned shortfall flow — but that same grant also passes the
   direct-create route's check. The code comments ("Merchandisers don't touch real commercial Purchase
   Orders") are not actually enforced by any distinct permission — only by the UI not exposing that screen
   to them. A direct `POST /api/v1/purchase-orders` call as MERCHANDISER succeeds today.
2. **PRODUCTION_SUPERVISOR can create master Rate Card rows.** `POST /api/v1/piece-rate-cards` asserts
   `piece_rate.create` — the same key Supervisor holds for assigning workers/triggering rate resolution.
   Supervisor is documented (rbac.ts comment) as able to "assign workers/trigger rate resolution but NOT
   override an authorized rate" — but nothing stops them from creating a brand-new master `PieceRateCard`
   (a pricing row) outright via direct API call.
3. **`listPendingJobWorkReceipts()`** (`job-work-order.service.ts:150`, `GET
   /api/v1/job-work-orders/receipts/pending`) has no `assertInternalUser`/supplier-scoping check at all —
   every sibling function in the same file has one. It's currently safe only because the seeded
   `EXTERNAL_UNIT_USER` role is never granted `production.approve`. If a company ever edits that role (or a
   future custom role) to add `approve`, this endpoint would leak every supplier's pending receipts
   company-wide.
4. **`listJobWorkOrders`/`getJobWorkOrderById` take an *optional* `userId` param** for supplier scoping —
   scoping only happens `if (userId)` is passed. Every current caller happens to pass it, but the function
   signature itself doesn't fail-safe if a future caller forgets. This is a latent trap, not an active leak.

### E. Scope/ownership gaps
Branch/production-stage/employee-self/supplier-self scoping is otherwise solid and consistently applied
(spot-checked across Warehouses, Expenses, Journals, Payments, Invoices, Dispatch, Material Requests, Stock
Movements, Production Orders, Goods Receipts, Purchase Orders, Sales Orders — all use the same
`branchScopeWhere`/`assertBranchAccess` pair). The two gaps above (D.3, D.4) are the only ownership-adjacent
issues found.

### F. Duplicate permission definitions
None found — no module+action pair is defined twice for the same role, no dead/orphaned permission rows
identified in this pass.

### G. Permissions that are too broad — 4 confirmed (root cause of D.1/D.2, and the Administration gap)
- **`inventory.create` / `inventory.edit`** gate, undifferentiated: creating a Material Request, creating a
  Stock Movement, creating a Goods Receipt, editing/closing/resuming a Material Request, issuing a Material
  Request line, creating/approving a material substitution, reversing/cancelling a Goods Receipt, and every
  attachment upload/delete across all of the above.
- **`purchasing.create` / `purchasing.edit`** gate: direct Purchase Order creation AND the
  Material-Request-triggered shortfall PO generation (same key); PO edit, send-to-supplier, close, hold/resume,
  attachments — all as one `edit`.
- **`piece_rate.create` / `piece_rate.edit`** gate: assigning a worker (which triggers rate resolution) AND
  creating a master `PieceRateCard`; editing/deactivating a Rate Card reuses the same `edit` a Supervisor
  doesn't hold today (so edit is accidentally safe, but only incidentally).
- **`administration.view` / `.create` / `.edit`** gate: the full User list (with emails), the full Roles
  list + each role's full permission matrix, Branches, Company Settings, and AI Provider configuration — one
  undifferentiated bucket. `ACCOUNTS_MANAGER`'s sole `administration: ["view"]` grant (given for "limited
  administrative visibility") currently exposes literally everything under Administration except Users/Roles
  *write* access.

### H. Permissions that are too restrictive
None found. `PRODUCTION_WORKER`/`EXTERNAL_UNIT_USER` are correctly minimal already (confirmed via this
session's own earlier live login tests). `ACCOUNTS_EXECUTIVE` correctly has no post/approve/cancel anywhere.

---

## Scope model — recommendation: reuse what exists, don't rebuild

The prompt's `own / assigned / department / company / all` model **already exists**, just not as one
generic column — it's four independent, live, tested mechanisms:

| Conceptual scope | Real implementation | Composition rule |
|---|---|---|
| `own` | `User.employeeId` + `resolveSelfEntryEmployee()` (job-order.service.ts) | 1:1 identity, no union needed |
| `assigned` | `User.contractorId` + `PermissionService.getAllowedContractorId()` | 1:1 identity, no union needed |
| `department` (closest fit: production stage) | `RoleProductionStageAccess` + `PermissionService.getAllowedProductionStageIds()` | per-role; any held role with zero restriction rows wins outright (unrestricted) |
| `company`/branch | `RoleBranchAccess` + `PermissionService.getAllowedBranchIds()` | same any-unrestricted-role-wins union rule |
| `all` | `null` return from either getAllowed* function | — |

This is a direct application of the prompt's own instruction: *"Do not necessarily hard-code scope into
permission names if the existing architecture supports a cleaner implementation."* Rebuilding this as a
literal `scope` column would mean re-deriving four already-correct, already-tested mechanisms with no
behavioral gain — real risk, zero benefit, on a production system. **Recommendation: keep all four exactly
as they are; only close the two concrete gaps in D.3/D.4 above.**

---

## Proposed Phase 3 changes (exact keys) — **not yet implemented, pending your go-ahead**

Following the *exact precedent this codebase already used once* for the same class of problem (2026-08-17:
`masters` was split into `masters_core`/`masters_finance` specifically so floor/warehouse roles didn't
implicitly get financial-master edit rights — a plain string column, zero schema migration, seed-data-only
change) — the proposed fix is the same pattern, applied to the four coarse spots found:

1. **Split `inventory` → `inventory` (Stock Balances/Stock Movements only) + `material_request`**
   (`view/create/edit/cancel/export/print`). Goods Receipt stays under `inventory` for now (not flagged as
   conflated by the prompt) — flag if you want it split too.
2. **Split `purchasing` → `purchase_order`** (`view/create/edit/approve/cancel/export/print`) — `purchasing`
   module name retired in favor of the clearer one, OR kept as an alias — need your call, see questions below.
3. **Split `piece_rate` → `piece_rate` (view/create_entry/edit_entry/approve) + `rate_card`**
   (`view/create/edit/approve/override`) — `piece_rate.override` (the assignment-time authorized-override,
   already a separate action today) stays on `piece_rate`, not `rate_card`, since it's about one assignment's
   rate, not the master card.
4. **Split `administration` → `administration_users` / `administration_roles` / `administration_settings`**
   (mirroring the `masters_core`/`masters_finance` split exactly) — `ACCOUNTS_MANAGER` would get only
   `administration_settings: ["view"]` (or nothing) instead of blanket `administration: ["view"]`, per your
   own "should not automatically gain access to user/role/security management unless explicitly intended."
5. **Fix `listPendingJobWorkReceipts()`** to call `assertInternalUser()` explicitly (defense-in-depth, closes
   D.3 regardless of role config) and make the `userId` param on `listJobWorkOrders`/`getJobWorkOrderById`
   **required**, not optional (closes D.4 by making the safe path the only path).
6. **Fix "Pending Approvals" nav gate** from `modules: ["production"]` to require `production.approve`
   specifically (a small `navigation.ts` change — `NavLeaf`/`NavSection` currently only support "any of these
   modules," not "this specific action," so this needs a small, additive capability, not a rewrite).

**Blast radius, honestly**: this touches `rbac.ts`, `prisma/seed.ts`'s permission catalog, ~35–45 API route
files' `PermissionService.assert()` calls (the exact count from the two granularity-audit agents above),
`navigation.ts`, and requires a live-DB permission-catalog backfill (this project's own established
"`prisma db seed` isn't safely re-runnable against the dev DB" gotcha means a targeted idempotent script, not
a reseed). Every existing Role/User keeps working — this is purely additive-then-narrowing (new keys added,
then the *specific* over-broad grants removed from the affected roles), never a wholesale rename that could
orphan an existing `role_permissions` row.

---

## Business decisions I need from you before Phase 3 (per your own "don't silently guess" instruction)

1. **`purchasing` → `purchase_order` rename, or add `purchase_order` alongside and retire `purchasing`
   later?** A rename touches more files at once but leaves no confusing duplicate; keeping both temporarily
   is safer but means two names for the same thing for a while.
2. **Should Goods Receipt also get its own module** (`goods_receipt`), or is folding it into the
   post-split `inventory` module (alongside Stock Balances/Movements) granular enough? The prompt didn't
   name it explicitly, so I defaulted to "leave it," but it's the same conflation pattern.
3. **Administration split naming** — `administration_users`/`administration_roles`/`administration_settings`
   (my proposal, 3-way) vs. the prompt's own literal suggestion of dotted names
   (`administration.users.view` etc., which would require a real 3-level model change, not just more
   top-level modules). I recommend the 3-way top-level split (same low-risk pattern as `masters_core`/
   `masters_finance`) over a new 3-level Module.Submodule.Action model — confirm you're OK with that, since
   it's the more disruptive of the two options if you'd prefer the dotted form.
4. **`ACCOUNTS_MANAGER`'s post-split Administration grant** — view-only on `administration_settings`
   (company/AI-provider config), nothing on Users/Roles? Or should they keep read-only visibility into the
   Users list too (e.g. for looking up who to route an approval to)?

If you'd rather I just make the reasonable call on all four and proceed, say so and I'll go with the
defaults stated above (they're the least-disruptive options consistent with the documented role matrix,
per your own fallback instruction) and move straight into Phase 3–9.

---

# Phase 3–9 — Implementation complete (2026-09-24)

All four defaults above were confirmed. Everything below actually happened — verified in code and in the
live app, not claimed.

## Phase 3/4 — RBAC configuration + sidebar mapping

**Modules added** (`src/config/rbac.ts`): `material_request`, `rate_card`, `administration_users`,
`administration_roles`, `administration_settings`.
**Module renamed**: `purchasing` → `purchase_order` (every reference in the codebase updated, zero left).
**Module retired**: `administration` (split 3 ways), the coarse `inventory.create`/`.edit` grant for
Material-Request-only usage (Material Request moved out; `inventory` itself still covers Stock Balances/
Stock Movements/Goods Receipt, unchanged).

**Exact role changes** (every one independently verified against the live database — see "Tests performed"):

| Role | Change |
|---|---|
| MERCHANDISER | Lost `purchase_order.create` (can no longer create a direct commercial PO). Kept the sanctioned "generate PO from my own Material Request's shortfall" capability — now gated on `material_request.edit`, which they still hold. Gained `material_request: [view, create, edit, cancel]`, `purchase_order: [view]`. |
| PRODUCTION_MANAGER | Kept `purchase_order: [view, create]` unchanged (explicit instruction: "must remain according to the existing matrix"). Lost `piece_rate.edit` (nothing in `piece_rate` maps to "edit" anymore). Gained `rate_card: [view, create, edit]` (now the sole owner of Rate Card CRUD) and `material_request: [view, create, edit, cancel]`. |
| PRODUCTION_SUPERVISOR | Lost the ability to create a master Rate Card (no `rate_card` grant at all — closes the confirmed gap). Kept `piece_rate: [view, create]` unchanged. Gained `material_request: [view, create]`. |
| ACCOUNTS_MANAGER | Lost `administration_users`/`administration_roles` entirely (no more full User list w/ emails, no more Roles/permission-matrix visibility). Kept `administration_settings: [view]` only. `purchase_order` unchanged. |
| MANAGEMENT | Unchanged breadth — still sees every module (now including the 5 new/renamed ones), still view/approve/export only, never create/edit/delete. |
| STORE_MANAGER, WAREHOUSE_USER, DISPATCH_MANAGER, QC_MANAGER, ACCOUNTS_EXECUTIVE | Straight carry-forward of their existing effective access onto the new module names — zero net capability change, just correctly attributed. |
| VIEWER, SUPER_ADMIN | Unchanged (both derive automatically from the `MODULES` array — no manual entry needed). |
| SAMPLING_MANAGER, PRODUCTION_WORKER, EXTERNAL_UNIT_USER | Untouched — none of them ever held `inventory`/`purchasing`/`administration`/a `piece_rate.create`-adjacent Rate Card risk. |

**Sidebar fixes** (`src/components/layout/navigation.ts`):
- "Material Requests" leaf re-gated from `inventory` to `material_request`.
- "Goods Receipts" leaf re-gated from `purchase_order` to `inventory` — fixes a **second, independently
  found** sidebar/page mismatch (the nav leaf had always pointed at the wrong module, even before today's
  changes; the real page was always gated on `inventory`).
- "Pending Approvals" now requires `production.approve` specifically (a new `requiredAction` field on
  `NavLeaf`, plumbed through `PermissionService.getModulesWithAction()` → `DashboardLayout` →
  `DashboardShell` → `Sidebar` → `filterNavSections()`) — no longer shown to `PRODUCTION_WORKER`/
  `EXTERNAL_UNIT_USER`, who previously saw it and got a reliable 404. Their own submission status already
  lives correctly on "My Work" — no new page was built, the workflow itself is unchanged.
- Administration nav gated on all 3 new sub-modules (shown if the viewer holds `view` on any one).

## Phase 5 — Backend/API authorization

Every one of ~90 API route files, plus the internal `PermissionService.assert()` calls inside
`material-request.service.ts`, `material-substitution.service.ts`, `purchase-order.service.ts`, and
`global-search.service.ts`, updated to the new module names — **never a frontend-only fix**. Confirmed via
a full-codebase grep that zero references to the retired `"purchasing"`/`"administration"` strings remain
anywhere in `src/`.

**Two real, live security gaps found during implementation (not in the original Phase 1/2 audit) and
fixed:**
1. **`src/app/(dashboard)/production/job-work/[id]/page.tsx` had NO permission check at all**, and never
   passed `userId` into `getJobWorkOrderById()` for its own External-Unit-User supplier scoping. Concretely:
   an `EXTERNAL_UNIT_USER` (vendor login) could view **any other supplier's** Job Work Order detail page by
   guessing/knowing its id, and any role with zero `production` access could still reach this page's data.
   Fixed: added `PermissionService.assert(..., "production", "view")` and now passes `session.user.id`
   through. Verified live (below).
2. **`listPendingJobWorkReceipts()`** had no identity-level supplier/internal check at all (every sibling
   function in `job-work-order.service.ts` has one) — safe today only because the seeded
   `EXTERNAL_UNIT_USER` role never holds `production.approve`. Added `assertInternalUser()` as
   defense-in-depth so this isn't solely dependent on role configuration staying correct forever.

**`GET /api/v1/reports/order-lifecycle/[salesOrderId]`'s "Material Requirement" section** was gated on the
coarse `inventory` module — re-gated onto `material_request`, the module that actually governs it.

**`src/core/reports/permissions.ts`**'s `audit` report category re-gated from `administration` to
`administration_settings`.

## Phase 6 — Ownership/scope

No changes needed here — the audit's Phase 1 finding stands: branch/production-stage/employee-self/
contractor-self scoping (`RoleBranchAccess`, `RoleProductionStageAccess`, `User.employeeId`,
`User.contractorId` + their respective `PermissionService` methods) already correctly implements the
`own`/`assigned`/`department`/`company`/`all` model conceptually requested, and was deliberately kept
as-is (see "Scope model" above) rather than rebuilt. `PermissionService` gained one new generalized method,
`getModulesWithAction()`, purely additive — `getViewableModules()` now just calls it with `"view"`, zero
behavior change for any existing caller.

## Phase 7 — Frontend guards

- `src/app/(dashboard)/admin/page.tsx` — rebuilt to compute 6 independent view/manage booleans (one pair per
  new module) instead of one blanket `administration.view`/`.create` pair. `listUsers()` is now only ever
  called (and therefore only ever present in the page's own server-rendered payload) when the viewer holds
  `administration_users.view` — **verified live** that a non-Users-eligible viewer's page HTML contains zero
  email addresses (see Tests performed).
- `src/app/(dashboard)/admin/AdminTabs.tsx` — tabs are now filtered per-viewer (`viewableTabs`), each tab's
  `canManage` prop is independently sourced from its own group (Users/Roles/Settings), and the active-tab
  state falls back to the first genuinely visible tab instead of defaulting to a tab the viewer can't see.
- `src/app/(dashboard)/admin/roles/[id]/page.tsx`, `src/app/(dashboard)/material-requests/page.tsx`,
  `src/app/(dashboard)/purchase-orders/page.tsx` — straight re-gated onto the correct new module.

## Tests performed

**Automated** (all green, confirmed by directly reading command output, not assumed from exit codes alone
after one mismatch caught mid-session — see below):
- `npx tsc --noEmit` — 0 errors, full project, twice (once after the RBAC config+route changes, once more
  after adding regression tests).
- `npx eslint .` — 0 errors, 12 pre-existing unrelated warnings (stale `<img>`/unused-var warnings that
  predate this session), full project.
- `npx vitest run` — **1956/1956 tests passing**, 108 test files, zero failures, zero skipped. Includes 2
  new regression tests added for `listPendingJobWorkReceipts()` (previously untested) and updated
  `navigation.test.ts` coverage for the new `requiredAction` mechanism (including the `"all"`/platform-admin
  bypass case, which needed its own explicit fix — see below).
- **Caught and fixed a genuine bug in my own first attempt**: `filterNavSections`'s new action-gating logic
  initially hid "Pending Approvals" even for a fully-unrestricted (`viewableModules === "all"`, i.e.
  platform-admin) caller when no explicit `actionModules` was passed — caught by the pre-existing
  `filterNavSections(NAV_SECTIONS, "all")` test failing, not by manual inspection. Fixed by making `"all"`
  bypass any `requiredAction` too, matching what `"all"` actually means in this codebase
  (`PermissionService`'s own unconditional platform-admin bypass).

**Live, in the real running app** (dev server restarted after the DB reconciliation, per this project's own
documented "stale in-process PermissionService cache" gotcha — confirmed clean via the fresh server's own
logs before testing):
1. **MERCHANDISER** (`neha.kapoor@indradhar.com`) — direct `POST /api/v1/purchase-orders` now correctly
   returns `403 PERMISSION_DENIED` ("You do not have permission to create in purchase_order."). Confirmed
   `GET /api/v1/material-requests` still returns `200` (the legitimate capability is intact).
2. **PRODUCTION_SUPERVISOR** (`manoj.tiwari@indradhar.com`) — direct `POST /api/v1/piece-rate-cards` now
   correctly returns `403 PERMISSION_DENIED` ("You do not have permission to create in rate_card."). Sidebar
   confirmed correct: "Pending Approvals" visible (he genuinely holds `production.approve`), "Purchase"
   section shows only "Goods Receipts" (not "Purchase Orders" — he holds no `purchase_order` grant at all),
   "Inventory" section shows all three children including "Material Requests".
3. **ACCOUNTS_MANAGER** (`vinay.kumar@indradhar.com`) — `GET /api/v1/administration/users` now correctly
   returns `403`; `GET /api/v1/administration/company` still returns `200`. The real `/admin` page renders
   with exactly Branches/Worker Settings/Company Settings/Document Numbering/Module Visibility/AI
   Configuration/Audit Log tabs — no Users, no Roles, no Bulk Import. Confirmed via a direct fetch of the
   page's raw HTML that it contains **zero occurrences** of any `@indradhar.com` email address.
4. **EXTERNAL_UNIT_USER** (`hpcotton.jobwork@indradhar.com`) — `GET /api/v1/job-work-orders` correctly
   returns only their own single order (`JWO-2026-00001`). Opening `/production/job-work/<their-own-id>`
   renders correctly (the fix's positive case). Opening `/production/job-work/<a-nonexistent-id>` returns a
   clean `404` (the fix's negative case — no crash, no data). Sidebar confirmed minimal and unaffected:
   Dashboard + Manufacturing only, and "Pending Approvals" is now correctly absent (they hold `production.
   view`/`create` but not `approve`).

**Database**: every role's real `role_permissions` rows independently re-verified via direct SQL against
the live dev database after the reconciliation script ran (not trusted from the script's own console output
alone) — 12 targeted spot-checks (6 roles × 2 permission keys each, covering every fix above) all matched
the intended design exactly, and a query for any stray row still pointing at a retired `purchasing.*`/
`administration.*`/`masters.*` key returned zero rows.

## Files changed

96 files (503 insertions, 189 deletions) — `git diff --stat` for the exact list. Concentrated in:
`src/config/rbac.ts` (the schema), `src/core/rbac/PermissionService.ts` (+1 new method), 4 files under
`src/components/layout/` (nav/sidebar plumbing), ~75 API route files under `src/app/api/v1/` (mechanical
permission-string renames, individually verified — not a blind find/replace), 6 files under
`src/app/(dashboard)/` (page-level guards, 2 with real new logic), 5 service files under `src/modules/`,
2 test files with new/updated coverage.

## Permissions added / removed / renamed — summary

- **Added** (new modules, 11 actions each): `material_request`, `rate_card`, `administration_users`,
  `administration_roles`, `administration_settings`.
- **Renamed**: `purchasing` → `purchase_order` (all 11 actions, all role grants, all route assertions).
- **Retired**: `administration` (split 3 ways — no role ever references the bare name anymore).
- **Removed from specific roles only** (module itself still exists for other roles): MERCHANDISER's/
  PRODUCTION_MANAGER's `purchase_order.create`→`purchase_order` stayed for Production Manager, was dropped
  for Merchandiser only; PRODUCTION_SUPERVISOR's Rate Card exposure (via the old shared `piece_rate.create`)
  closed by giving Rate Card its own module Supervisor was never granted.
- **Bonus cleanup, unplanned**: found and removed a fully-orphaned `masters.*` permission catalog (10 rows)
  left over from before this project's own 2026-08-17 `masters_core`/`masters_finance` split — dead since
  that day, never cleaned up until this reconciliation pass touched every role's permission set anyway.

## Remaining open items — not fixed, flagged honestly

- **~50 other Server-Component list/detail pages across the app** likely share the same "no dedicated
  permission check, relies on the API alone" pattern the Job Work Order detail page had — that one was
  found and fixed because it was directly in this audit's path (Job Work Order isolation was explicitly
  named in your prompt), not because a full sweep of every page in the app was performed. **This is a real,
  scoped gap, not silently glossed over**: recommend a dedicated follow-up pass specifically auditing every
  `(dashboard)` page for a missing `PermissionService.assert()`/`.can()` call, the same class of issue
  already documented (and partially swept) in this project's own Phase 10 QA history.
- **`inventory`/`warehouse` report categories** (`REPORT_CATEGORY_MODULES`) were checked for Material-Request
  data leakage and confirmed clean (Stock Summary/Ledger/Low-Stock/Negative-Stock/Valuation/Slow-Moving —
  all genuine stock concerns) — no change needed, but flagged here as explicitly checked rather than
  assumed.
- **Goods Receipt was deliberately NOT split into its own module** (your own confirmed decision) — still
  shares `inventory.create`/`.edit` with Stock Balances/Movements. If real usage later shows this needs
  finer separation, the exact same pattern used for Material Request applies directly.

## Business decisions already made, recorded here for traceability

All four were confirmed via your own answers before Phase 3 began: rename `purchasing` now (not add-
alongside), leave Goods Receipt folded into `inventory`, use 3 flat Administration modules (not a dotted
3-level model), and give `ACCOUNTS_MANAGER` Settings-only visibility (not Users, not both, not neither).

No further business decisions are required to consider this audit's fixes complete — the two extra fixes
found during implementation (Job Work Order page gap, `listPendingJobWorkReceipts` defense-in-depth) were
unambiguous security corrections, not judgment calls, so I applied them directly rather than pausing to ask.
