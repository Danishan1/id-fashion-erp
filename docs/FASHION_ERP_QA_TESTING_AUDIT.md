# Fashion ERP — QA & Testing Audit

**Date:** 2026-10-21 (baseline audit) · **Updated:** 2026-10-23 (runtime verification and fixes — see §1a)
**Mode:** §1–§19 record the original read-only audit of commit `fc45956`. §1a records the later, approved work: runtime reproduction on a throwaway database, the fixes, and their re-verification. Where the two differ, §1a is current.
**Verdict:** **NOT READY** (improved) — see §18.

---

## 1. Executive summary (baseline, 2026-10-21)

- The codebase builds cleanly: typecheck passes, lint has 0 errors.
- Unit tests: 3,304 passed, 2 failed, 211 skipped (3,517 total). The 2 failures are UI tests that passed when re-run in isolation; root cause not confirmed.
- **No test runs against a real database.** All 18 integration test files are skipped unless an environment variable is set, and CI does not set it. Every row lock, conditional update and DB CHECK constraint is therefore untested against Postgres.
- No end-to-end test covers Sales Order → Production → Lot → Finished Goods → Dispatch → Invoice → Payment.
- **7 defects verified by reading the code** (§12), including 3 rated High: a custom invoice can reference another company's customer, Sales Order buyer/customer are not validated on edit, and an unapproved job-work receipt can be reversed. None had yet been reproduced at runtime at this point; they have since been reproduced and fixed (§1a).
- About 15 further **suspected** defects (§13) in inventory, dispatch, invoicing and concurrency need verification.
- Most findings in the 10 historical audit reports are fixed (§12.3); several remain open or partially fixed.

---

## 1a. Update — runtime verification and fixes (2026-10-21 to 2026-10-23)

### Method

- **Throwaway database:** `fashion_erp_qa_20261021` was created on the local Postgres server, used, and dropped afterwards. It was created twice: once to reproduce the defects, once to re-check the fixes.
  - **Guard:** every reproduction script refused to run unless the connected database name was exactly that.
- **Data:** fresh `prisma migrate deploy` plus `prisma db seed`; every test record was synthetic and prefixed `QA-`/`QS-`/`QR-`.
- **Real code paths:** the scripts called the real, unmocked services against real Postgres, using the real `PermissionService` with the seeded Super Admin. The API routes pass the affected fields straight to these services with no extra checks.
- **Live database untouched:** after each run, a read-only query confirmed that the live `fashion_erp` database contained none of the test records.

### Database integration tests (previously skipped)

| Run | Result |
|---|---|
| 17 integration files, sequential, on the throwaway DB (before fixes) | 208 passed, 1 failed of 209 |
| Same, after fixes and merging `main` | 208 passed, 1 failed of 209 |
| `bulk-queue.integration.test.ts` | **NOT RUN** — needs Redis; the only Redis available is a shared cloud instance, deliberately not used |

The one failure both times is `crm/workflows/default-workflows.integration.test.ts`:
- **First run:** it hit the 5 s timeout. **Second run:** an expected task was missing.
- **On its own:** it passes 4/4, three separate times.
- **Assessment:** an order- and timing-dependent flaky test that predates the fixes. It touches none of the fixed modules.

### Defects: reproduced, fixed, re-verified

| ID | Severity | Runtime result before fix | Fix | Runtime result after fix |
|---|---|---|---|---|
| FERP-QA-001 | High | Invoice saved in company A with company B's customer; B's GSTIN (27) vs A's (07) made it IGST ₹180 | Customer lookup scoped to company + `deletedAt: null`; `NOT_FOUND` otherwise (create and edit) | Rejected: `NOT_FOUND` "Customer not found." |
| FERP-QA-002 | High | Create with another customer's buyer, and with company B's buyer, both accepted; edit to company B's customer accepted and saved | `assertCustomerAndBuyer()` on create **and** edit | All 3 rejected (`VALIDATION_ERROR` / `NOT_FOUND`) |
| FERP-QA-003 | High | Approved receipt of 6, then a contractor's PENDING receipt of 4; reversing the pending one was accepted and real counts dropped **6 → 2** | Refuse PENDING/REJECTED receipts; conditional `COMPLETED→CANCELLED` claim inside the transaction; refuse if completed would fall below forwarded | Rejected: `INVALID_STATE_TRANSITION`; counts stay 6 |
| FERP-QA-004 | Medium | Production Order created against a Draft Sales Order | Sales Order must be Confirmed / In Production / Partially Dispatched / Dispatched / Invoiced; style must match the line | Draft rejected; wrong style rejected |
| FERP-QA-005 | Medium | Code-confirmed only | Editor may only **add** permissions they hold (`PermissionService.can`); keeping/removing is unrestricted | Unit-tested |
| FERP-QA-006 | Medium | Code-confirmed only | Prisma `P2003` → 409 `REFERENCED_RECORD_IN_USE` | Unit-tested |
| FERP-QA-007 | Low | Code-confirmed only | `listHandbacks` filtered to the worker's own hand-backs for assigned-only users | Unit-tested |
| S-01 | High (data) | PO 100 YDS / roll 91.44 MTR; reversing the whole roll left the PO line at 8.56 YDS received and the receipt "Partially Reversed" | Roll quantity converted back to the PO line's unit (rounded to 4 dp) before updating receipt-line and PO-line counters | PO line 0, receipt line reversed 100 YDS, receipt `CANCELLED`, stock 0 |
| S-08 | Medium | Invoice ₹1,000 with ₹400 advance accepted a ₹1,000 payment → balance −₹400 | Payment cap = balance due (net of advance and payable) | Rejected: "Available: 600.00" |
| S-09 (concurrent) | Medium | Payment ₹800 + credit note ₹800 at the same moment on ₹1,000 → both accepted, balance −₹600 | Payment and credit note each guard on **both** `paidAmount` and `creditedAmount` | Credit note loses the race; balance ₹200 |
| S-10 | Medium | 3 simultaneous creates for one SO line → **2** active Production Orders, plus a raw P2002 from the document-number counter | Partial unique index `production_orders_one_active_per_so_line`; P2002 mapped to `PRODUCTION_ORDER_EXISTS`; first-use document-number race retries once | Exactly **1** created; the other two get `PRODUCTION_ORDER_EXISTS`; no raw P2002 |

### Still open after this work

- **S-09 (sequential):** a credit note after full payment is still accepted (balance −₹500). It may be a legitimate refund; this needs a business decision.
- **Not done:**
  - **Role assignment:** the role-assignment guard still ignores DENY overrides (part of the FERP-QA-005 recommendation).
  - **Sales Order edit:** there is still no pre-check for an active Production Order; FERP-QA-006 now returns a clean 409 instead.
  - **Job-work reversal:** a reversal does not cancel the receipt's piece-rate earning.
- **Not runtime-verified:** S-02 to S-07 and S-11 to S-15 are still code-review findings only (see §13).

### Code delivered

| Commit | Content |
|---|---|
| `b744779` | The fixes above, with 31 new regression tests across 11 test files |
| `22d9b8e` | New migration renamed to `20261021230000_one_active_production_order_per_so_line` (a `main` migration had the same timestamp) |
| `3f1483e`, `9775d91` | Unrelated UI follow-ups requested during the session (Sales Order quantity boxes and full-width form) |

- **Branches:** pushed to `main` as fast-forwards (`main` now includes all of the above).
- **Live database:** migrations applied with `prisma migrate deploy`, after confirming it had no duplicate active Production Orders, then verified by direct query.

### Checks after the fixes

| Check | Result |
|---|---|
| Unit suite | 3,376 passed, 0 failed, 211 skipped (after merging `main`) |
| Lint | 0 errors (22 pre-existing warnings) |
| Typecheck (`tsc --noEmit`) | **BLOCKED locally**: out of memory on every attempt, including a changed-files-only run. Not verified; relies on GitHub CI, whose result has not been checked |

---

## 2. Verified repository and environment

| Item | Value |
|---|---|
| Repository | https://github.com/TeamsIndradhar/fashion-erp.git |
| Audited checkout | Worktree `.claude/worktrees/pull-lo-maon-se-639be5` |
| Branch | `claude/git-pull-main-7f6146` |
| Audited commit | `fc45956` (2026-10-20, "Merge P0-P6 …") |
| Working tree at audit start | Clean |
| `origin/main` now | `a708c6e` (package.json build heap 4096 → 6144 MB; pushed on request during this session, not part of the audited code) |
| Node / npm | v24.15.0 / 11.12.1 |
| Stack | Next.js 16.3.1 (Turbopack), React 19.2.8, Prisma 7.9 + `@prisma/adapter-pg`, NextAuth 5.0.0-beta.32, BullMQ 6, Zod 4, Vitest 4 |
| Database | Local PostgreSQL dev DB `fashion_erp` (shared dev data, **not** disposable) |
| Env keys present (values not inspected) | DATABASE_URL, NEXTAUTH_SECRET, AUTH_TRUST_HOST, REDIS_URL, OPENAI/ANTHROPIC/GEMINI/CLOUDFLARE keys, IMAGE_GENERATION_PROVIDER, AI_TEXT_PROVIDER |
| Integration-test env (`CRM_IT_DATABASE_URL`, `BULK_IT_REDIS_URL`) | **Not set** |
| CI | `.github/workflows/ci.yml` (migrate deploy on a Postgres 16 service, typecheck, lint, `npm test`, build), `codeql.yml` |
| Host constraint | ~7.9 GB RAM, ~0.4 GB free during the audit (a second dev server was running) |

**Disclosure — changes made in this session *before* the audit prompt** (at the user's request to pull and run the app): `npx prisma migrate deploy` applied the pending migrations up to `20261021180000_user_permission_overrides` to the dev DB; `scripts/sync-permission-catalog.mjs` added 3 role grants; `npm ci` was run in the worktree; `npx prisma generate` was run in the worktree and the main checkout. No changes were made after the audit started.

---

## 3. Architecture and module inventory

| Measure | Count |
|---|---|
| Prisma models / enums | 305 / 184 |
| Migrations / rollback scripts | 196 / 10 |
| API `route.ts` files | 920 |
| `page.tsx` files (all) / dashboard pages | 215 / 198 |
| `*.service.ts` / `*.repository.ts` | 164 / 101 |
| Test files / integration test files | 243 / 18 |

**API routes by area (top):** crm 222, ai-designer 98, ai-garment-projects 71, platform 30, sampling 29, administration 25, material-requests 19, dispatches 19, production-orders 16, sales-orders 14, custom-invoices 14, purchase-orders 13, job-orders 13.

**Module scope versus the audit brief:**
- **Core:** auth, companies, branches, users/roles/overrides, platform portal, support access, entitlements — implemented.
- **AI Designer:** implemented (plus the separate AI Garment Flow module).
- **CRM + Marketing:** CRM rebuilt (phases 01–22). Marketing has campaigns, ad integrations and a channel-performance report.
- **HRMS:** attendance, attendance corrections, leave, shifts/holidays. **Payroll is not implemented** — the schema stores pay-basis data only ("no payroll", `prisma/schema.prisma:1570`). Recruitment/performance not found.
- **Manufacturing:** sampling, sales orders, BOM/MRP, purchase, GRN with fabric rolls, inventory ledger, material requests, production orders/lots/job orders/QC/job work, finished-goods inventory with reservations, packing, dispatch, returns — implemented.
- **Accounts:** chart of accounts, journals, sales/purchase invoices, custom invoices with GST and credit notes, payments, expenses, advances — implemented.

Architecture: feature modules under `src/modules/*` (schema / service / repository), cross-cutting `src/core/*` (auth, RBAC `PermissionService`, entitlements, logging, numbering, file storage), routes under `src/app/api/v1`, page gate in `src/proxy.ts`.

---

## 4. Business workflow coverage matrix

| Workflow | Key rules in code | Tests | Main gaps |
|---|---|---|---|
| Tenant & branch isolation | `actor.companyId` on reads/writes; `getAllowedBranchIds` / `branchScopeWhere` (`src/lib/branch-access.ts`) | `company-scoping.contract.test.ts`; per-module "branch access enforcement" describes | Contract test checks only `update*`/`transition*` names and accepts any mention of `actor.companyId`; branch checks are read-side only in dispatch, accounts, inventory, purchasing |
| Sampling | state machine, costing lock, version append-only | `sample.service.test.ts` | Mocked only |
| Sales Order | customer check on create, design/style validation, sample gate | `sales-order.service.test.ts` (+2) | Buyer/customer not validated on edit (D-02); variant not validated against product |
| Production (lots, job orders, QC, job work) | qty caps under `FOR UPDATE` (`production.repository.ts:174`); forward/revert/QC caps; shared assignment pool | `job-order`, `assignment-capacity`, `job-work-order`, `production-order`, `lot` tests | No race test; JWO tests mock the cascade (`job-work-order.service.test.ts:36-39`); split/merge lightly tested |
| Inventory ledger | single entry `recordInventoryTransaction` with guarded decrement (`inventory.service.ts:75`) | `inventory`, `material-request`, `goods-receipt` tests | Floor guard never run on real DB; roll reversal units (S-01) |
| Finished goods | variant/location/status balance; reservations via raw SQL | receipt, putaway, reservation tests (raw SQL mocked) | Raw-SQL guards never executed; re-reservation (S-03) |
| QC / packing / dispatch | draft + confirm FG checks, packing gate, carton reconciliation, reversal guard | `dispatch.service.test.ts` (extensive, mocked) | Packing gate outside transaction (S-04); reversal path (S-05) |
| Returns | restock units | `customer-return.service.test.ts` (3 cases) | S-06 |
| Invoices & GST | `computeLines`, `calculateInvoiceGst` (`src/lib/gst.ts:89`), CAS caps, journal balance | custom-invoice, payment, credit-note, journal, sales/purchase invoice tests | No dedicated `gst.ts` test; cross-tenant customer (D-01); payment/credit caps (S-08, S-09) |
| Cross-module chain | status hand-offs SO → PO → lot → FG → dispatch → invoice | None end-to-end | Every boundary mocked; nothing sets SO `IN_PRODUCTION` |
| HRMS | attendance, leave with self-approval guard, team scope | `attendance`, `leave`, `hrms-scope`, `attendance-correction` tests | Payroll not implemented |
| AI Designer | provider capability checks, versioning, exports | `ai-designer` / `core/ai*` tests | Live provider behaviour not tested (credits) |

---

## 5. Existing test inventory and baseline results

| Command | Exit | Result |
|---|---|---|
| `npx tsc --noEmit` (after `npx next typegen`, `NODE_OPTIONS=--max-old-space-size=6144`) | 0 | No errors |
| `npx eslint .` | 0 | 0 errors, 22 warnings: 11 `@next/next/no-img-element`, 5 `no-unused-vars`, 6 `no-unused-expressions` (all in `scripts/qa/rehearse-rollback.mjs`) |
| `npx vitest run` | **1** | Files: 223 passed, 2 failed, 18 skipped (243). Tests: 3,304 passed, 2 failed, 211 skipped (3,517). Duration 117 s |
| Re-run of the 2 failing files in isolation | 0 | 14/14 passed |

**Failing tests (first run):**
1. `src/components/crm/crm-phase02-components.test.tsx` › DataTable selection › selects single rows and the whole page — `Unable to find role="checkbox" and name "Select Alpha"` at line 51.
2. `src/components/crm/dashboard/dashboard-components.test.tsx` › CRM dashboard › shows KPIs … — `Unable to find role="link" and name /Active leads/` at line 67.

**Analysis:** both use `findByRole` with Testing Library's default 1,000 ms timeout after a mocked `fetch`, in a jsdom environment. The full run spent 110 s in environment setup and 300 s in imports under ~0.4 GB free RAM. Both pass alone. Status: **flaky, root cause not confirmed**; no prior baseline exists to say whether they failed before.

**Skipped:** the 18 `*.integration.test.ts` files (17 CRM, 1 bulk-actions) — gated on `CRM_IT_DATABASE_URL` / `BULK_IT_REDIS_URL`.

**Test distribution (files):** crm 42 (+11 route, +9 component, +10 page-component), ai-garment-flow 17, accounts 17, production 13, platform 9, finished-goods-inventory 8, inventory 5, hrms 4, ai-designer 4 (+5 core), sales-orders 3, bom-mrp 3, others 1–2 each.

**Services with no matching test file** include `accounts/chart-of-account`, `custom-invoice-ledger`, `invoice-series`, `administration/branch`, `company-settings`, `document-sequence`, `audit-log`, `ai-designer/tech-pack-master`, `production/piece-rate-card`, `production-operation`, `production-timeline`, `defect-type`, `customers/customer-360`, and many CRM services (some CRM services are covered by integration tests that are skipped).

---

## 6. Functional and negative test coverage

- Unit tests cover many negative paths (over-receipt, over-issue, invalid transitions, self-approval, missing fields) — against mocks.
- Route-level tests: **13 of 920 routes**, 12 of them CRM/bulk; dispatch has only a PDF route test.
- Concurrency: races are simulated with `count: 0` mocks; no real concurrent test exists.
- Not covered anywhere: browser refresh/interrupted workflows, large result sets, real file import/export round-trips, DB/network failure mid-transaction.

---

## 7. Role-based access and tenant isolation findings

**Confirmed working (code evidence):**
- All 920 routes reviewed by grep: only 4 lack a session check, all intentionally public (`api/auth/[...nextauth]`, `health`, two signed CRM webhooks).
- Platform-admin bypass removed (`src/core/rbac/PermissionService.ts:203-206`); company switcher removed; platform portal separate (`src/core/auth/route-access.ts`).
- Suspended company blocked at login, API, permissions and proxy (`src/proxy.ts:140-148`).
- Support access: customer Super Admin approval, expiry, code lockout, read-only by method (`support-access.service.ts:264-273`, `proxy.ts:77-109`).
- Per-user overrides: cannot edit own overrides, can only GRANT held permissions (`permission-override.service.ts:47`, `:76-82`).
- Worker portal scopes to the linked employee (`job-order.service.ts:630-657`, `:1468-1485`).

**Defects / gaps:** D-01, D-02, D-05, D-07 (§12); suspected S-07 (branch write checks).

**Partial:**
- Page gate checks module *view* only, and pages without a sidebar link are allowed through (`src/core/entitlements/route-modules.ts:47-50`).
- Permission cache is in-process (`PermissionService.ts:28`); role/override changes reach other app instances late. JWT uses the NextAuth default 30-day lifetime; no global revoke.
- Role-assignment guard builds the actor's permissions from roles only, ignoring DENY overrides (`user-admin.repository.ts:116-132`).
- `listJobWorkOrders` / `getJobWorkOrderById` skip contractor scoping if `userId` is omitted (`job-work-order.service.ts:146-156`, `:195-201`); current callers are safe.

**Policy question:** VIEWER has `view` on every module including financials and the user list (`src/config/rbac.ts:471-474`).

---

## 8. Database and transaction integrity findings

- Ledger floor guard: guarded decrement with `quantityOnHand >= amount` (`inventory.service.ts:126-144`, `inventory.repository.ts:81`) — correct pattern, never run on a real DB.
- Job order quantity cap uses `SELECT … FOR UPDATE` (`production.repository.ts:174`) plus a DB CHECK — not race-tested.
- **Unhandled foreign-key error:** Prisma `P2003` is not mapped in `src/core/errors/BusinessRuleError.ts` (only P2002 and P2007), so FK-blocked operations return a raw 500 (D-06).
- Uniqueness not enforced by the DB for one Production Order per Sales Order line — check-then-create without a unique index (S-10).
- Idempotency keys exist on ledger-writing documents but are optional (`String?`), so direct API callers can double-post.
- `cancelGoodsReceipt` uses one transaction per line, so a mid-way failure leaves a partial cancel.

---

## 9. Integration and regression risks

- Every module boundary in the order-to-cash chain is mocked in tests; a change to one module's contract will not be caught by another's tests.
- Sales Order status: dispatch eligibility includes `INVOICED` but not `IN_PRODUCTION`; nothing sets `IN_PRODUCTION`. Dispatch confirm overwrites SO status unconditionally (`dispatch.service.ts:1162`) and reversal resets to `CONFIRMED` (`:1481`).
- QC damage posts a flat `DAMAGE` ledger entry without a stock status, so the `REJECTED` finished-goods balance is fed only by manual putaway (`job-order.service.ts:1835`).
- AI providers: live calls depend on account credits; not exercised.

---

## 10. Performance and reliability observations

- Not measured (blocked — §14). No SLOs found in the repo.
- Observed: full unit run 117 s; `tsc`/`eslint` need a raised Node heap (documented project gotcha).
- Worker warns that Redis eviction policy is `volatile-lru`; BullMQ requires `noeviction` (risk of lost jobs under memory pressure).
- Login rate limiter is in-memory (`src/core/auth/rateLimiter.ts`); exports/imports are not rate-limited.

---

## 11. Security findings

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| D-01 | High | Cross-tenant customer on custom invoice | §12 |
| D-02 | High | Cross-tenant / mismatched customer & buyer on Sales Order | §12 |
| D-05 | Medium | Role permissions can be widened beyond the editor's own | §12 |
| SEC-1 | Low | CSP keeps `script-src 'unsafe-inline'` | `next.config.ts:16` |
| SEC-2 | Low | No 2FA | no TOTP/MFA code in `src` |
| SEC-3 | Low | Ad-integration OAuth callback does not bind state to the session user | `ad-integration.service.ts:75-81` |
| SEC-4 | Low | Stored file keeps the client's extension | `src/core/file-storage/FileStorage.ts:108` |
| SEC-5 | Hygiene | Unused `isPlatformAdmin` column remains | `prisma/schema.prisma:854` |

---

## 12. Confirmed defects (baseline: verified by reading the code)

> **Update 2026-10-23:** all seven are now **Fixed and Retested**. FERP-QA-001…004 were reproduced at runtime before the fix and are rejected after it; 005…007 are covered by regression tests. Details in §1a. The entries below are kept as originally written.

> "Confirmed" here means the defect is visible in the code at the cited lines and was re-checked by the auditor directly. None has been reproduced in a running app; runtime reproduction is pending (§14).

### FERP-QA-001 — Custom invoice accepts another company's customer
- **Module:** Accounts / Custom Invoices · **Severity:** High · **Priority:** P1 · **Type:** Security / Data integrity
- **Commit:** fc45956 · **Roles:** any user with custom-invoice create
- **Steps:** POST a custom invoice with `customerId` belonging to another company.
- **Expected:** 404 / validation error. **Actual (from code):** accepted; that customer's GSTIN state decides CGST/SGST vs IGST.
- **Code evidence:** `src/modules/accounts/custom-invoice.service.ts:174` — `prisma.customer.findUnique({ where: { id: customerId } })` with no `companyId`; `createCustomInvoice` stores `input.customerId` (around line 251) without a company check.
- **Impact:** cross-tenant reference, wrong tax split. **Root cause:** confirmed (missing scope).
- **Fix:** look up the customer by `{ id, companyId }` and reject if absent. **Regression test:** cross-company `customerId` rejected.

### FERP-QA-002 — Sales Order buyer/customer not validated
- **Module:** Sales Orders · **Severity:** High · **Priority:** P1 · **Type:** Security / Data integrity
- **Code evidence:** `src/modules/sales-orders/sales-order.service.ts:224` (create loads the customer with its buyers but never checks `buyerId` belongs to it); `:416-417` (update writes `customerId` and `buyerId` with no lookup at all).
- **Expected:** buyer must belong to the customer, customer to the company. **Actual:** any ids are stored.
- **Fix:** validate on create and update. **Regression tests:** foreign buyer, foreign customer on update.

### FERP-QA-003 — Unapproved job-work receipt can be reversed
- **Module:** Production / Job Work · **Severity:** High · **Priority:** P1 · **Type:** Data integrity
- **Code evidence:** external submissions are created with `status: "COMPLETED"`, `approvalStatus: "PENDING"` (`src/modules/production/job-work-order.service.ts` around line 798); `reverseJobWorkReceipt` checks only `status !== "COMPLETED"` (`:1058`) and then subtracts the receipt's quantities (`:1072-1088`).
- **Actual:** reversing a pending receipt subtracts pieces that were never added to the job-work order or job order.
- **Fix:** also require `approvalStatus` approved (or treat pending receipts as reject-only). **Regression test:** reverse a pending receipt → rejected.

### FERP-QA-004 — Production Order allowed against a non-active Sales Order
- **Module:** Production · **Severity:** Medium · **Priority:** P2 · **Type:** Functional
- **Code evidence:** `src/modules/production/production-order.service.ts:182-205` — the Sales Order line is scoped to the company but its order status (Draft / On Hold / Cancelled) is never checked; the order's product is not matched to the line's product.
- **Needs clarification:** which Sales Order statuses may feed production.

### FERP-QA-005 — Role permissions can be widened past the editor's own
- **Module:** Administration · **Severity:** Medium · **Priority:** P1 · **Type:** Security (privilege escalation)
- **Code evidence:** `src/modules/administration/role-admin.service.ts:89-130` (`updateRolePermissions`) blocks Super Admin's row and roles the actor holds, but never limits the new keys to permissions the actor holds.
- **Scenario:** a user with `administration_roles.edit` assigns a narrow role to a second account, then widens that role.
- **Fix:** require granted keys ⊆ actor's effective permissions (same rule as overrides). Apply the same to branch/stage restrictions where relevant.

### FERP-QA-006 — Foreign-key violations return raw 500
- **Module:** Core errors · **Severity:** Medium · **Priority:** P2 · **Type:** Functional
- **Code evidence:** `src/core/errors/BusinessRuleError.ts:298-308` maps P2007 and P2002 only. Example: editing a confirmed Sales Order with an active Production Order deletes items (`sales-order.repository.ts:188-189`) and hits a Restrict FK.
- **Fix:** map P2003 to 409 with a clear message, and add an explicit pre-check in `updateSalesOrder`.

### FERP-QA-007 — Hand-back list shows other workers' hand-backs
- **Module:** Production / Worker portal · **Severity:** Low · **Priority:** P3 · **Type:** Security (information exposure)
- **Code evidence:** `src/modules/production/work-portal.service.ts:134-143` (`listHandbacks`) is not filtered to the worker, unlike assignments and entries.

### 12.3 Historical findings revalidated

| Source | Finding | Status | Evidence |
|---|---|---|---|
| HARDENING CF-1 | JobOrder lost update | Fixed | `production.repository.ts:174-175` |
| HARDENING CF-2 | Sampling / Buyer Enquiry cross-tenant refs | Fixed | `sample.service.ts:254-263`; `buyer-enquiry.service.ts:120-125` |
| HARDENING CF-3 | passwordHash in admin API | Fixed | `user-admin.repository.ts` (`USER_SELECT`) |
| HARDENING CF-4 | Supplier bank details on PO | Fixed | `purchase-order.repository.ts:34` |
| HARDENING CF-5 | No idempotency | Partially fixed | keys optional in schema |
| HARDENING CF-6 | MIME spoofing | Fixed | `FileStorage.ts:90-106` |
| HARDENING CF-7 | Suspension doesn't revoke | Fixed (API) / partial (pages) | `api-route.ts:61-72` |
| READINESS §10.1 | Negative stock under concurrency | Fixed (pattern) | `inventory.service.ts:126-144` |
| READINESS §10.2/3 | Job work stock check; UOM conversion | Fixed | `job-work-order.service.ts:307-326`; `stock-movement.service.ts:107-118` |
| QA_UAT P0-1 / Phase 10 | Double FG posting on re-forward/QC | Fixed | `job-order.service.ts:110` |
| QA_UAT P1-1/2/4 | JWO cancel, adjustment employee, leave self-approval | Fixed | `job-work-order.service.ts:1144`; `job-order.service.ts:1129`; `leave.service.ts:253` |
| QA_UAT P3 | Worker vs job-work double commit | Fixed | `computeAvailableToCommit` |
| Phase 10 | QC defect sum / float equality | Fixed | `production.schema.ts:279-308` |
| RBAC D.1–D.3, C, G | PO/rate-card perms, pending receipts, sidebar, admin split | Fixed | `rbac.ts:248,317-323,74-76`; `job-work-order.service.ts:189-191` |
| RBAC | ~50 ungated pages | Partially fixed | `proxy.ts:34-44` (view-level) |
| PLATFORM | isPlatformAdmin bypass, company switcher, support access, suspension | Fixed | see §7 |
| PRACTICAL §4 | BOM versioning | Fixed | `schema.prisma:3912,3937` |
| PRACTICAL §5 | PO against inactive SO | **Still present** | FERP-QA-004 |
| PRACTICAL §6 | Short-delivered PO cannot close; no PO tax | **Still present** | `purchase-order.service.ts:374,408-414` |
| PRACTICAL §7 | QC optional before FG; no GRN inspection | **Still present** | `schema.prisma:2013` |
| READINESS §9 | Purchase invoice price not compared to PO | **Still present** | `purchase-invoice.service.ts:88-91` |
| READINESS §11 | `creditLimit` never enforced | **Still present** | only written in `customer.service.ts` |
| READINESS §13 | No credit note for Sales/Purchase Invoice; no period lock | **Still present** | `journal.service.ts:300-308` |
| READINESS §6 | SO variant not validated against product | **Still present** | `sales-order.service.ts:296,408` |
| Phase 10 | VIEWER sees everything | Still present (policy) | `rbac.ts:471-474` |
| ENTERPRISE B1 | Rate limiting | Partially fixed | in-memory only |

---

## 13. Suspected issues (code-read by review agents; not yet verified by the auditor)

> **Update 2026-10-23:** four of these were reproduced at runtime and then fixed: **S-01, S-08, S-09 (concurrent case) and S-10** (see §1a).
> - **S-09 (sequential):** a credit note after full payment is still allowed, pending a business decision.
> - **S-13:** partly addressed by the FERP-QA-003 fix, which added a conditional claim and the forwarded-quantity check. The piece-rate earning is still not cancelled.
> - **Not runtime-verified:** S-02 to S-07, S-11, S-12, S-14 and S-15 remain unverified.

| ID | Area | Suspected issue | Location |
|---|---|---|---|
| S-01 | Inventory | Roll-scoped GRN reversal applies base-unit qty to PO-unit counters | `goods-receipt.service.ts:504-547`, `:615-618` |
| S-02 | Inventory | Fabric roll status never set to partially used / consumed | no writer found |
| S-03 | Finished goods | After a reservation is FULFILLED, next packing completion re-reserves the full ordered qty | `finished-goods-reservation.service.ts:185` + repository ON CONFLICT |
| S-04 | Dispatch | Packing-produced re-check runs outside the confirm transaction | `dispatch.service.ts:964`, `:1091` |
| S-05 | Dispatch | Reversal re-derives variant mode at reversal time; reservations and units not restored | `dispatch.service.ts:1396-1401`, `:1453-1467` |
| S-06 | Returns | No-variant RESTOCK always fails; duplicate unit codes restock twice; unconditional unit update | `customer-return.service.ts` |
| S-07 | Branch scope | No branch check on dispatch confirm/reverse, invoice post, material issue | e.g. `dispatches/[id]/confirm/route.ts` |
| S-08 | Invoices | Custom-invoice payment cap ignores advance/payable | `custom-invoice-payment.service.ts:23` |
| S-09 | Invoices | Payment and credit note capped on different columns; together can exceed total | payment / credit-note services |
| S-10 | Production | One Production Order per SO line not unique in DB | `production-order.service.ts:196-219` |
| S-11 | Production | `createLot` material gate outside transaction | `lot.service.ts:147` |
| S-12 | Production | Forward/QC guarded increments use a pre-transaction `completedQuantity` | `job-order.service.ts:1535,1591,1714,1783,1799` |
| S-13 | Job work | Receipt reversal race; ignores forwarded qty; piece-rate earning not cancelled | `job-work-order.service.ts:1088-1090` |
| S-14 | Invoices | Sales invoice bills ordered (not dispatched) qty; single GST line, no CGST/SGST/IGST | `sales-invoice.service.ts:56` |
| S-15 | Inventory | `guardedDecrementRemaining` has no epsilon tolerance | material request / fabric roll repo |

**Needs business-owner clarification:** SO statuses allowed to feed production (D-04); whether QC is mandatory before FG posting; whether sales invoices should bill dispatched quantity; VIEWER scope; whether a short-delivered PO may be closed.

---

## 14. Blocked and unexecuted tests

| Test | Status | Reason |
|---|---|---|
| 18 integration test files (211 tests) | **Run 2026-10-21/22:** 17 files run on a throwaway DB, 208/209 pass (1 known flaky CRM test); `bulk-queue` still BLOCKED | Needs a non-shared Redis |
| Runtime reproduction of FERP-QA-001…007 | **Run 2026-10-21:** 001–004 reproduced; then fixed and re-verified 2026-10-22 | 005–007 covered by unit regression tests only |
| Runtime check of the remaining suspected issues (S-02…S-07, S-11…S-15) | NOT RUN | Need longer setup chains (packing, reservations, dispatch, returns) |
| Typecheck after the fixes | BLOCKED locally | Out of memory; relies on GitHub CI (result not checked) |
| Browser end-to-end workflows | BLOCKED | ~0.4 GB free RAM; deferred |
| Performance / load | BLOCKED | No staging environment; low RAM |
| Live DB role catalog vs `rbac.ts` | NOT RUN | Read-only DB query not performed |
| AI provider live calls | NOT RUN | Would consume paid credits |
| Payroll workflows | NOT APPLICABLE | Not implemented |

---

## 15. Critical gaps and risk matrix

| Risk | Likelihood | Impact | Rating |
|---|---|---|---|
| Cross-tenant references (D-01, D-02) | Medium | High | **High** |
| No real-DB testing of concurrency guards | Medium | High | **High** |
| Job-work / dispatch reversal corruption (D-03, S-05, S-13) | Medium | High | **High** |
| Role escalation (D-05) | Low | High | Medium |
| Invoice over-payment / credit (S-08, S-09) | Medium | Medium | Medium |
| Raw 500s on FK errors (D-06) | High | Low | Medium |
| No end-to-end chain test | High | Medium | Medium |
| Flaky UI tests | Medium | Low | Low |

---

## 16. Recommended fixes

> **Update 2026-10-23:** status of each recommendation below:
> - **Done:** 1, 2 (except cancelling the piece-rate earning), 4 (the P2003 mapping only), 5 (using a default status rule, still to be confirmed by the owner), 6 and 7.
> - **Partly done:** 3. The subset check is done; DENY overrides in the role-assignment guard are not.
> - **Not done:** 4's pre-check for an active Production Order, and 8.

1. Scope `customerId` in custom invoices and validate SO customer/buyer on create and update (D-01, D-02).
2. Block reversal of unapproved job-work receipts; make the receipt status update conditional (D-03, S-13).
3. Add a subset check to `updateRolePermissions`; include DENY overrides in the role-assignment guard (D-05).
4. Map Prisma P2003 to a 409; pre-check active Production Orders before editing a Sales Order (D-06).
5. Decide and enforce SO status rules for production (D-04).
6. Filter `listHandbacks` to the worker (D-07).
7. Add a unique partial index for active Production Order per SO line (S-10).
8. Set Redis `maxmemory-policy noeviction` for the worker.

---

## 17. Regression test recommendations

- Regression tests for each FERP-QA-001…007.
- A real-DB integration suite for: ledger floor guard under concurrent decrements, job-order `FOR UPDATE` caps, finished-goods reservation raw SQL, dispatch confirm race.
- One end-to-end chain test SO → PO → lot → FG → dispatch → invoice → payment on a disposable DB.
- Extend `company-scoping.contract.test.ts` to cover `create/delete/cancel/post/reverse/*` and to reject audit-log-only mentions.
- A dedicated `src/lib/gst.ts` test (intra/inter-state, rounding, reverse charge).
- Stabilise the 2 flaky CRM UI tests (explicit `findBy` timeout or awaiting the fetch).
- Run the integration suite in CI with a Postgres service and `CRM_IT_DATABASE_URL` set.

---

## 18. Release readiness assessment

**Baseline (2026-10-21) — NOT READY.** Three High-severity defects are visible in the code (FERP-QA-001…003), none of the transaction-safety guards has been tested against a real database, and no end-to-end business chain is tested. A passing typecheck, lint and unit suite does not establish business or security correctness.

**Current (2026-10-23) — still NOT READY, but improved.** All seven confirmed defects and four suspected ones are fixed. The ones that could be reproduced were re-verified on a real database. To reach **READY WITH CONDITIONS**, at minimum:

1. **Typecheck:** confirm it passes in GitHub CI for the current `main`; it could not run locally.
2. **High-impact suspected issues:** verify or fix S-03 (re-reservation), S-04 (packing gate race), S-05 (dispatch reversal) and S-13's remaining piece-rate gap.
3. **Business decisions:**
   - the Sales Order statuses allowed to feed production (a default is in place);
   - credit notes after full payment;
   - the VIEWER role's scope.
4. **Integration tests in CI:** run the integration suite in CI so the concurrency guards stay covered.

Release approval belongs to the authorised owner.

---

## 19. Prioritised remediation roadmap

| Priority | Item | Status (2026-10-23) |
|---|---|---|
| P0 | Provision a disposable test DB; run the 18 integration files; reproduce FERP-QA-001…005 | **Done** (except `bulk-queue`, needs Redis) |
| P1 | Fix FERP-QA-001, 002, 003, 005 with regression tests | **Done** |
| P1 | Verify suspected S-01, S-03, S-04, S-05, S-08, S-09, S-13 | S-01, S-08, S-09 **done and fixed**; S-03, S-04, S-05, S-13 (earning) **open** |
| P1 | Confirm typecheck in CI for the current `main` | **Open** (new) |
| P2 | FERP-QA-004, 006; S-10 unique index; S-07 branch write checks | 004, 006, S-10 **done**; S-07 **open** |
| P2 | Real-DB concurrency tests and one end-to-end chain test; run integration tests in CI | **Open** |
| P3 | FERP-QA-007; flaky tests; Redis eviction policy; CSP/2FA/rate-limit hardening; VIEWER policy decision | 007 **done**; the rest **open** |
