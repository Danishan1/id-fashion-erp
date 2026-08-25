# Independent Final Security & Production-Readiness Audit — `Hardening` Branch

**Audit date:** 2026-08-25
**Branch audited:** `Hardening`, commit `a1ac202`
**Method:** Full independent re-verification. No finding in this report is taken on trust from `CLAUDE.md`, `FASHION_ERP_COMPLETE_READINESS_AUDIT.md`, or the commit message — every claim below was re-derived from the current code, migration SQL, or a live command run during this audit. Eight independent research passes covered authentication, multi-tenancy/IDOR, API security, database/Prisma/transactions, ERP business logic, input validation/file upload/headers, logging/testing/performance, and CI-CD/dependencies/architecture. Nothing was modified, committed, or pushed during this audit; nothing was merged.

---

## Executive Summary

### 🔴 NOT READY FOR PRODUCTION

**The `Hardening` branch's own commit (`a1ac202`) is clean, correctly scoped, and safe as a standalone change** — independently re-verified: exactly 9 files touched, all matching the stated scope, zero unrelated changes, zero regressions, all six of its claims hold up under fresh scrutiny (see the verification table below).

**But this audit surfaced new, independently-confirmed HIGH-severity findings that predate this branch and are not fixed by it** — they exist on `main` today exactly as much as on `Hardening`. The most serious:
- A live, exploitable cross-tenant data-disclosure vulnerability in Sampling and Buyer Enquiries (full Customer/Buyer/Product records of another tenant), confirmed independently and reproduced step-by-step.
- The Administration module's own user-list endpoint returns every user's bcrypt `passwordHash` in the JSON response.
- Purchase Order detail responses leak a supplier's bank account details and tax registration number to anyone with mere `purchasing:view`.
- File uploads accept an executable disguised with a spoofed `Content-Type`, store it, and serve it back for a user to download and run.
- A genuine, freshly-discovered lost-update race in Production's core quantity accumulator (`JobOrder.completedQuantity`/`rejectedQuantity`/`damagedQuantity`) — the one accumulator in the whole codebase that does **not** use this project's own established atomic-guard pattern.
- Suspending a user via the new Administration module does not revoke their already-issued session; they can keep working for up to 30 days.
- Five migrations (including the Dispatch tables and the new `job_work_orders` CHECK constraint) are unapplied on the local dev database — some of this report's own DB-level guarantees are migration-file-true but not yet DB-true in that environment.

None of these were introduced by `a1ac202`. All of them are real, and several are severe enough that shipping "Phase 11 Hardening, first pass" into `main` without addressing at least the P0 items below would be a materially misleading signal about the system's actual security posture.

---

## Hardening Verification — commit `a1ac202`

| Change | Verified? | Risk | Notes |
|---|---|---|---|
| Cross-tenant `branchId`/`roleId` fix in `createUser()` | ✅ Yes, independently confirmed by 2 separate research passes reading the current code fresh | None found in the fix itself | `UserAdminScopeRepository.findBranchCompanyId`/`findRoleCompanyId` correctly checked before write; `setUserStatus()` also independently re-verified as already company-scoped via `UserAdminRepository.findById(companyId, id)`. **However**, the same `createUser()`/`user-admin.repository.ts` code was independently found to leak `passwordHash` in its responses (new finding, not part of the original fix — see P0 list) |
| `Strict-Transport-Security` header | ✅ Yes | None | `max-age=63072000` (exactly 2 years), `includeSubDomains` present, `preload` correctly and verifiably absent as the code comment claims |
| `Content-Security-Policy` header | ✅ Active for all paths, but weaker than the commit message implies | Medium (accepted, documented tradeoff) | `script-src` includes `'unsafe-inline'` in **both** dev and prod — genuinely necessary for the App Router's inline RSC-hydration scripts as claimed, but this does mean the CSP does **not** stop an inline-script XSS payload if one is ever injected; only nonce-based CSP would. The code comment's claim that fixing this "requires wrapping the NextAuth proxy's `auth()` call" is a **slight overstatement** — there is no `middleware.ts`/`proxy.ts`-level nonce plumbing today at all, so implementing this properly would mean *introducing* per-request nonce middleware, not modifying an existing one. Not a defect in the shipped work, just a documentation nuance worth correcting. |
| `GET /api/v1/health` | ✅ Yes | None | Confirmed unauthenticated by design, returns only `{status, database, timestamp}`, uses the safe tagged-template `` prisma.$queryRaw`SELECT 1` `` form (no injection surface — zero interpolated values) |
| Structured JSON logging | ✅ Works, but narrower than "structured logging" implies | Low | The only live call site in the entire app is the one `logger.error(...)` inside `toErrorResponse()`. `logger.info`/`.warn` are never called anywhere in application code — genuinely wired, but functionally dormant outside one error path. Two real, fixable gaps found: (1) no request-correlation ID exists anywhere in the app, so two concurrent failures produce indistinguishable log lines; (2) `toErrorResponse(error)`/`handleApiError(error)` take only the error, not the session, so an error log line carries **no `companyId`/`userId` context** even though the calling route already has `session` in scope at every catch site — a small, high-value fix. |
| Leave self-approval guard verification | ✅ Confirmed still present and correct, freshly re-read (not assumed from `CLAUDE.md`) | None | `approveLeaveRequest()` in `leave.service.ts` genuinely calls `PermissionService.assert(actor.userId, "hrms_leave", "approve", { createdBy: existing.createdByUserId })` |
| No unrelated changes | ✅ Confirmed via `git show a1ac202 --stat` | None | Exactly 9 files, 366 insertions / 3 deletions, all matching the commit's own stated scope |
| No regression introduced | ✅ Confirmed | None | `tsc`/`lint`/`build`/`prisma validate` all clean; 462/462 tests pass (461 on one run — see Testing findings for the one flaky, unrelated test) |

---

## Critical Findings

### CF-1 — Lost-update race in Production's core quantity accumulator
- **Severity:** CRITICAL (data-integrity, not remotely exploitable by an attacker, but reachable by ordinary concurrent floor usage)
- **File:** `src/modules/production/job-order.service.ts` (`applyJobOrderQuantityDelta`, `guardedDecrementUnprocessedQuantity`, `applyQcDispositionInTx`); `src/modules/production/production.repository.ts` (`findForGuardedUpdateInTx` at line 125, `updateInTx` at lines 127-128)
- **Problem:** every other quantity accumulator in this codebase (PO received/invoiced, Material Request issued, FabricRoll remaining, Dispatch dispatched, Stock Balance) uses an atomic `updateMany` with the cap expressed in the `WHERE` clause — a single UPDATE statement that can't lose a race. `JobOrder`'s three-column invariant (`completed + rejected + damaged <= planned`) is the **one exception**: it does a plain, non-locking `findUniqueOrThrow`, computes new values in application code, then writes them with a plain `update()`. The Postgres CHECK constraint added in a later migration (`job_orders_quantity_consistency_check`) does not catch this, because the final row can still legally satisfy `completed+rejected+damaged <= planned` even after silently discarding one of two concurrent writers' increments.
- **Exploitation scenario:** two near-simultaneous updates to the same `jobOrderId` — e.g., an external Job Work receipt landing at the same moment a floor supervisor submits a progress entry, or two QC dispositions in quick succession. The second transaction's `update()` blocks on Postgres's row lock until the first commits, then overwrites the row using values computed from its own **stale** pre-lock read — silently dropping the first transaction's increment.
- **Business impact:** a production floor could silently under-count completed/rejected/damaged quantity for a lot under real concurrent usage (multiple workers/stages/QC actions happening close together, which is normal factory activity, not an edge case) — corrupting the exact ledger this project has otherwise gone to unusual lengths to protect.
- **Recommended fix:** convert to the same guarded-`updateMany` idiom used everywhere else, or use a `SELECT ... FOR UPDATE` inside the transaction before computing new values.
- **Blocks production:** Yes — recommend fixing before any real multi-user floor usage.

### CF-2 — Cross-tenant full-record disclosure via Sampling and Buyer Enquiries
- **Severity:** HIGH
- **Files:** `src/modules/sampling/sample.service.ts` (`createSampleRequest`), `src/modules/sampling/sample.repository.ts` (`findByIdWithDetails`, `include: { customer: true, buyer: true, product: true }`); `src/modules/buyer-enquiries/buyer-enquiry.service.ts` (`createBuyerEnquiry`), equivalent repository include
- **Problem:** `createSampleRequest()`/`createBuyerEnquiry()` accept `customerId`/`buyerId`/`productId` from the request body and write them straight to the new record with **no check** that they belong to the caller's own company — unlike `createSalesOrder()`/`createPurchaseOrder()` in the same codebase, which validate this correctly. The corresponding detail-read repositories then `include` the *full* related record with an unscoped Prisma `include`, so once the record exists, the foreign tenant's full row rides along in every subsequent read.
- **Exploitation scenario:** an authenticated user in Company A with `sampling:create` and any Company-B `Customer.id` (leaked via a support ticket, screen-share, shared URL, or a former employee of both companies) calls `POST /api/v1/sampling` with that `customerId`. `GET /api/v1/sampling/{id}` (needs only `sampling:view`, already held) then returns Company B's full Customer record — name, code, address, contact person, email, phone, GST/credit-limit fields — permanently, embedded in Company A's own sample request.
- **Business impact:** direct breach of the multi-tenant isolation this is supposed to be a multi-company SaaS ERP's core guarantee; a real customer's commercial and contact data disclosed to an unrelated company.
- **Recommended fix:** add the same `findById(actor.companyId, id)` ownership check `createSalesOrder`/`createPurchaseOrder` already use, before writing `customerId`/`buyerId`/`productId`. Apply the identical fix to the smaller, lower-severity siblings found in the same pass: `createJobWorkOrder`'s `supplierId`, `deal.service.ts`'s `leadId`/`customerId`/`salesAgentId`, `job-order.service.ts::assignWorker`'s `employeeId`, and the update-only gaps on `tax-rate`'s `taxTypeId` and `purchase-order`'s `supplierId`.
- **Blocks production:** Yes.

### CF-3 — `passwordHash` returned in Administration API responses
- **Severity:** HIGH
- **File:** `src/modules/administration/user-admin.repository.ts` (`USER_INCLUDE`, used with `include:` — never `select:` — on `findMany`/`findById`/`createWithRoleInTx`/`updateStatus`)
- **Problem:** Prisma's `include` returns every scalar column of the base model in addition to the named relations. `USER_INCLUDE` never narrows the `User` model's own fields, so `passwordHash` (a valid bcrypt hash) comes back in the JSON.
- **Exploitation scenario:** any user holding `administration:view` calls `GET /api/v1/administration/users` and receives every user's bcrypt hash in the response body — enabling offline cracking attempts against weak passwords, independent of whatever else that user is authorized to see.
- **Business impact:** direct credential-material exposure to any admin-tier user, not just Super Admin.
- **Recommended fix:** replace every `include: USER_INCLUDE` with an explicit `select` that excludes `passwordHash` (and any other sensitive scalar, e.g. `mfaSecret` once that's used).
- **Blocks production:** Yes — trivial, one-line-per-call-site fix.

### CF-4 — Supplier bank details leaked via Purchase Order detail
- **Severity:** HIGH
- **File:** `src/modules/purchasing/purchase-order.repository.ts` (`findByIdWithDetails`, `include: { supplier: true, ... }`)
- **Problem:** the PO list endpoint two lines above correctly uses `select: { id: true, name: true }` for supplier; the detail endpoint uses a full `include`, exposing `bankDetailsJson` and `taxRegistrationNo`.
- **Exploitation scenario:** a user with `purchasing:view` but no separate supplier-master permission opens any PO's detail page/API response and receives the supplier's bank account number/IFSC and tax registration ID.
- **Business impact:** financial/PII data disclosed across an RBAC boundary that's supposed to require a higher-trust permission.
- **Recommended fix:** narrow to `supplier: { select: { id, name, code, contactPerson, email, phone } }`, matching the list endpoint's existing correct pattern. The same anti-pattern (full `include` for `customer` in Sales Orders, Buyer Enquiries, and Sampling) also leaks `Customer.creditLimit`/`paymentTermsDays` across module boundaries — lower severity (MEDIUM, no bank data), same fix.
- **Blocks production:** Yes.

### CF-5 — No idempotency protection on document-creation endpoints (Goods Receipt worst-case)
- **Severity:** HIGH
- **File:** `src/modules/purchasing/goods-receipt.service.ts` (`createGoodsReceipt`)
- **Problem:** no idempotency key, no dedupe check, no unique constraint on the physical event. A double-click or a network retry that resubmits an identical POST body creates a **second** real `GoodsReceipt` document (a fresh document number is generated each call) and posts a **second** `InventoryTransaction`, as long as the cumulative total still fits under the PO line's ordered-quantity cap.
- **Exploitation scenario:** PO line ordered 100, received 0 so far. User POSTs a receipt for 30 units; the response is lost to a network blip; the client or user retries the identical POST. Both succeed (30+30=60 ≤ 100), silently double-counting 30 units of stock that only physically arrived once.
- **Business impact:** silent inventory-quantity corruption from ordinary network flakiness, not an attack — arguably more dangerous than an attacker-driven bug because it requires no malicious intent to trigger.
- **Recommended fix:** an idempotency key (client-generated, stored + unique-constrained per company+key) is the standard fix; apply first to Goods Receipt, then to the other ledger-writing document-creation endpoints (Stock Movement, Job Work receipt, Payment, Sales/Purchase Invoice, Expense) which share the same gap.
- **Blocks production:** Yes for Goods Receipt specifically; the broader pattern is P1 for the rest.

### CF-6 — Spoofable MIME-type validation allows storing and later downloading an executable
- **Severity:** HIGH
- **Files:** `src/core/file-storage/FileStorage.ts` (`ALLOWED_MIME_TYPES` check against the client-supplied `mimeType`, no magic-byte verification), attachment upload routes (`mimeType: file.type || "application/octet-stream"` — taken directly from the browser `File.type`, itself sourced from an attacker-controlled multipart `Content-Type`)
- **Problem:** file-type enforcement is entirely client-asserted. No extension allow-list exists independently of the MIME string either.
- **Exploitation scenario:** an attacker uploads `shell.exe` while declaring `Content-Type: application/pdf` (trivial via a crafted `File` object or a proxy-edited multipart body). It's accepted, stored as `<uuid>.exe`, and served back on download with `Content-Disposition: attachment; filename="shell.exe"`. Any user who downloads and manually runs it executes real code.
- **Business impact:** a stored-malware distribution vector inside a document-management feature colleagues are expected to trust.
- **Recommended fix:** verify actual file content (magic-byte sniffing, e.g. the `file-type` package) rather than trusting the client's declared type, and/or enforce an extension allow-list independent of the MIME string.
- **Blocks production:** Yes.

### CF-7 — Suspending a user does not revoke their active session
- **Severity:** HIGH
- **Files:** `src/core/auth/auth.config.ts` (JWT strategy, no `maxAge` override → NextAuth's 30-day default; `session`/`jwt` callbacks never re-read `user.status` from the DB after initial sign-in), `src/core/auth/auth.ts` (DB `status !== "ACTIVE"` checked only inside `authorize()`, i.e. only at login time), `src/lib/api-route.ts` (`requireSession()` only checks the JWT is present/valid, never re-checks DB status)
- **Problem:** JWT sessions are stateless; nothing in the request path re-validates `User.status` against the database after the token is issued.
- **Exploitation scenario:** an admin suspends a departing or compromised employee via `PATCH /api/v1/administration/users/[id]/status`. That user's existing session cookie remains fully valid — every subsequent `requireSession()`+`PermissionService.assert()` call succeeds normally (permission lookups query `UserBranchRole`, which a status change doesn't touch) — for up to 30 days or until the cookie is otherwise cleared.
- **Business impact:** an offboarding or incident-response "suspend this user now" action does not actually stop that user's access in any practical timeframe.
- **Recommended fix:** either re-check `user.status` on a short interval inside the `session`/`jwt` callback (accepting the extra DB read), maintain a session-version/deny-list column bumped on suspend and checked per request, or materially shorten the JWT `maxAge` as an interim stopgap.
- **Blocks production:** Yes, specifically before the Administration module's suspend feature is relied on for real offboarding/incident response.

### CF-8 — Migration drift: 5 migrations unapplied on the dev database
- **Severity:** MEDIUM (environment/process, not a code vulnerability)
- **Evidence:** `npx prisma migrate status` (read-only, re-run during this audit): `20260824114456_add_dispatch`, `20260825051204_add_job_work_issue_reversal_type`, `20260825051440_make_job_order_progress_entry_employee_nullable`, `20260825060000_add_job_work_orders_quantity_check`, `20260825062606_add_unit_of_measure_is_active` are all pending.
- **Problem:** this means the `job_work_orders_quantity_consistency_check` CHECK constraint this report otherwise verified in migration SQL does not physically exist yet on that database, the entire Dispatch feature's tables don't exist there, and `job_order_progress_entries.employee_id` is still `NOT NULL` in the live DB despite the application code now treating it as nullable.
- **Recommended fix:** apply pending migrations (`prisma migrate deploy` in a real environment) before relying on any of the guarantees they add.
- **Blocks production:** Yes, trivially — this is a "run the migration" action, not a code fix, but must happen before go-live regardless.

---

## Multi-Tenant Security Verdict

**One company can access another company's data through the API — confirmed, not hypothetical.** CF-2 above is a live, reproducible, cross-tenant full-record disclosure via two real endpoints (Sampling, Buyer Enquiries), with four more lower-severity siblings of the identical bug class found in the same pass (Job Work Order's supplier, Deal's lead/customer/agent, Job Order Assignment's employee, and two update-only gaps).

**Everywhere else checked, tenant isolation held up:**
- **API:** 285 of 287 route files call `requireSession()` (the one exception, `/api/v1/health`, is deliberately public and safe); every sampled route additionally asserts an RBAC permission before touching business logic.
- **UI:** all sampled list/search/filter endpoints AND their `companyId` filter, never OR or standalone.
- **Database queries:** the "26-entity historical sweep" masters, all financial-document status transitions, Dispatch, Job Work Order, Purchase Order, Sales Order, and the CRM/Marketing/HRMS modules specifically re-checked in this pass (Deal, Lead, Campaign, BuyerEnquiryLine status-changes, AdAccountConnection, CrmFollowup/CrmActivity) all correctly validate company ownership before mutating.
- **Reports/exports:** all 3 Excel export routes company-scope correctly.
- **Files:** `AttachmentService`'s download/delete paths are correctly company-scoped, uniformly across all 7 modules that use it.
- **Background jobs:** none exist in this codebase (no queue/worker infrastructure) — not applicable.

**Verdict: Mostly Complete, with two confirmed live High-severity holes (CF-2 and its siblings) that must close before this can be called "safe multi-tenant isolation."**

---

## Authentication & Authorization Verdict

**Secure:** bcrypt password hashing (cost 12, correct salt handling); no hardcoded fallback secret anywhere (both non-NextAuth consumers of `NEXTAUTH_SECRET` — OAuth-state HMAC and at-rest token encryption — fail closed rather than defaulting); brute-force lockout is genuinely enforced (5 attempts/15 min, correctly wired into `authorize()`); `requireSession()` coverage is essentially total; RBAC (`PermissionService.assert`) is fail-closed and consistently applied; self-approval guards are correctly wired on every approve/post checkpoint sampled, including the freshly-added leave-request one; error responses never leak stack traces or internals to clients (verified directly in `toErrorResponse`); no `.env` secrets are tracked in git; the one raw-SQL usage in the codebase is safely parameterized.

**Missing or weak:**
- **2FA is 0% implemented** — schema column only (`User.mfaSecret`), no service/route/UI code anywhere. See the dedicated assessment below.
- **No password-reset or password-change capability exists at all** — not even an admin-triggered one. The only account remediation available today is suspend/reactivate.
- **Session revocation on suspend doesn't work** (CF-7).
- **No explicit cookie hardening** — relies entirely on NextAuth v5's defaults (`httpOnly: true`, `sameSite: "lax"`, `secure` conditional on detected HTTPS); no `sameSite: "strict"` layered on for this admin-heavy, sensitive-data ERP.
- **Rate limiting is login-only**, keyed by email (not IP), in-memory (silently weakens under horizontal scaling — self-documented in the code).
- **`PermissionService`'s permission cache has no invalidation wired into any production code path** — currently harmless (no role-reassignment feature exists yet to make it stale) but a real latent trap for the next admin feature.

---

## API Security Verdict

- **Route classification is correct almost everywhere**: public routes are genuinely public-safe (`/api/v1/health`, NextAuth handler), authenticated-only routes are all justified self-scoped or reference-data lookups, and the ~270 remaining business routes are all permission-restricted with sensible module/action pairs. One RBAC-granularity inconsistency found: import-batch view is hardcoded to `crm:view` regardless of the batch's actual type (LEAD/DEAL/CAMPAIGN_DAILY_METRIC) — a correctness/consistency gap (too strict, not a privilege-escalation risk), not exploitable.
- **No mass-assignment/parameter-tampering vulnerability found** — the codebase's "always name every field explicitly" convention holds with zero exceptions sampled; Zod's default unknown-key-stripping is relied on everywhere, no `.passthrough()` found anywhere.
- **Excessive data exposure is real** (CF-3, CF-4, plus the lower-severity Customer credit-limit leak) — the specific, repeating anti-pattern is using Prisma `include` instead of `select` the moment a related record crosses a module/RBAC boundary into an API response.
- **Pagination is genuinely capped server-side** at 100 rows (`parseListQuery`), regardless of client input; the 3 Excel exports cap at 20,000 rows each (duplicated as three separate magic numbers — a maintainability smell, not a bug).
- **No rate limiting beyond login** — the CSV import (5,000-row cap per call, but no per-user/IP throttle on how often it's called) and the three Excel export routes (each an uncapped-by-rate-limit up-to-20,000-row query) are the two most realistic resource-exhaustion targets given this app's actual design.
- **File upload permission-gating is correct**; the type/size enforcement is genuinely server-side (not bypassable client-side) but is undermined by CF-6's spoofable-MIME gap.

---

## Database Verdict

- **Schema integrity is strong**: FK/relation coverage is essentially complete (two intentionally-unenforced soft references found, `Warehouse.managerEmployeeId` and `CrmRoundRobinState.lastAssignedUserId`, both undocumented at the field level but low-impact); all document-numbered headers have the correct company/branch-scoped unique constraint; no cascade delete exists on any financial or inventory table (only on the two RBAC junction tables, which is correct).
- **No raw-SQL injection risk anywhere** — only 2 real `$executeRaw` call sites (plus the new health-check's static `$queryRaw`), both the safe tagged-template form, both narrowly and correctly justified (Prisma can't express a column-to-column comparison in `updateMany`).
- **Transaction discipline is excellent almost everywhere** — 99 `$transaction` call sites across 38 files; the inventory-ledger negative-stock guard, document numbering, and the full journal-posting chain (Sales/Purchase Invoice, Payment, Expense) were all re-traced fresh and confirmed atomic and correct.
- **The one confirmed exception is CF-1** (Production's JobOrder accumulator) — a genuine, structurally different pattern from every other accumulator in the codebase, and the one place this discipline breaks down.
- **Repository-layer split (thin Prisma re-exports for ~27 simple-lookup entities vs. hand-written repositories elsewhere) does not need refactoring** — every consuming service function independently, correctly re-implements the company-ownership check by hand, with no bypass path found. This is a maintainability/lint-rule opportunity, not a demonstrated security gap.
- **5 pending migrations on the dev DB** (CF-8) mean some of the guarantees described above are not yet physically true in that specific environment.

---

## ERP Business Logic Verdict

**Confirmed secure, freshly re-verified (not assumed from prior docs):** Sales Order's sample-approval gate and edit-after-confirm rules; Purchase Order's self-approval guard and the "no price/quantity change after `SENT_TO_SUPPLIER`" rule; the inventory ledger's negative-stock guard wiring (6 non-test callers, all correctly routed through the atomic guard); Job Order's stage-transition functions (forward/revert/QC) and their guarded increments; Sampling's self-approval guard (though it lives at the route layer rather than the service layer — a latent, not-yet-exploited risk if a second caller is ever added) and its costing-lock atomicity; the "no edit/reversal of a POSTED financial document" rule across Journal, Sales Invoice, Purchase Invoice, Payment, and Expense, with the reversal-block correctly covering all four document-sourced journal types; Dispatch's over-dispatch guard and its independent, real-timestamp-based cancel block.

**High-risk workflow issues found:**
- **CF-5** — no idempotency protection on Goods Receipt (and, by the same pattern, every other document-creation endpoint that writes to the ledger).
- **CF-1** — the JobOrder lost-update race.
- A **MEDIUM/accepted** note: attendance can be recorded by any `MANAGEMENT`-role user for any employee including themself with no independent check — verified to be a deliberate, documented scope decision (no self-service employee role exists at all in this system's RBAC model) rather than an oversight, but worth being aware of given `MANAGEMENT` sits at the top of the role hierarchy with no higher approver.

---

## Production Readiness

| Area | Verdict |
|---|---|
| **Security** | Not ready — CF-2 through CF-7 above are all real and unaddressed |
| **Reliability** | The lost-update race (CF-1) and missing idempotency (CF-5) are real reliability risks under ordinary concurrent usage, not just attack scenarios |
| **Observability** | Structured logging exists but is dormant outside one error path, carries no request-correlation ID, and no actor (`companyId`/`userId`) context — a real gap for diagnosing a production incident |
| **Testing** | 462/462 passing, but one confirmed-flaky test (`encryption.test.ts`'s GCM-tamper test, ~1/4096 false-negative rate — a test-quality bug, not a security bug) and one confirmed coverage gap that inverts a natural assumption: `dispatch.service.ts` has the *most* race-guard (`updateStatusConditional`) call sites of any module (4) but *zero* `{count: 0}` race-rejection tests, despite other modules with fewer call sites being well-covered for exactly this case. Self-approval-guard testing is real at the `PermissionService` unit level but every *service*-level test mocks `PermissionService` away entirely — meaning the actual composition of "real RBAC decision + real business logic" is untested anywhere in the suite |
| **Performance** | No systemic N+1 risk found (only 2 bounded, `Promise.all`-wrapped instances); the CSV import's synchronous 5,000-row-in-one-request loop and the 20,000-row in-memory Excel exports are both real, bounded-but-nontrivial capacity risks worth load-testing before assuming they're safe at the upper end |
| **Deployment** | CI runs lint/typecheck/test/build only — no security scanning (no CodeQL, no Dependabot config), no deploy/CD step of any kind, and **no real Postgres is ever exercised in CI** (every test mocks the repository/Prisma layer) — meaning zero automated verification exists that Prisma queries/migrations actually work against real Postgres |
| **Backup/recovery** | Not evaluated in this pass (out of scope for a code audit) — no backup tooling exists in the repo, consistent with the project's own roadmap explicitly scheduling this for later |
| **Scalability** | Fine at current single-instance scale; the in-memory rate limiter and `PermissionService` cache are both explicitly single-instance-only and would need to move to a shared store (Redis) together the moment this runs on more than one instance |

---

## Priority Roadmap

### P0 — Must Fix Before Merge
| Item | Why | Action |
|---|---|---|
| CF-3: `passwordHash` returned by Administration endpoints | Direct credential-material exposure to any admin-tier user | Replace `include: USER_INCLUDE` with an explicit `select` excluding `passwordHash` everywhere it's used |
| CF-2: cross-tenant record disclosure in Sampling/Buyer Enquiries (+ siblings) | Live, reproducible breach of core multi-tenant guarantee | Add the same company-ownership check `createSalesOrder`/`createPurchaseOrder` already use, to `createSampleRequest`, `createBuyerEnquiry`, `createJobWorkOrder`, `deal.service.ts`, `job-order.service.ts::assignWorker`, and the two update-only gaps (`tax-rate`, `purchase-order`) |
| CF-4: supplier bank details leaked via PO detail | Financial/PII disclosure across an RBAC boundary | Change `include: { supplier: true }` to a narrow `select` |
| CF-1: JobOrder lost-update race | Real data-integrity risk under ordinary concurrent floor usage | Convert to the atomic guarded-`updateMany` idiom used everywhere else in the codebase |
| CF-8: apply the 5 pending migrations | Several guarantees this report verified in migration SQL are not physically true on the dev DB yet | `prisma migrate deploy` (or the project's documented manual-migration workaround) before relying on them |

### P1 — Must Fix Before Production
| Item | Why | Action |
|---|---|---|
| CF-5: idempotency on Goods Receipt (and the rest of the ledger-writing document-creation endpoints) | A network retry or double-click silently double-posts a real document | Add a client-supplied idempotency key, unique-constrained per company |
| CF-6: spoofable MIME-type validation on file upload | Executable-upload/stored-malware-distribution vector | Verify actual file content (magic-byte sniffing) instead of trusting the client's declared type |
| CF-7: suspending a user doesn't revoke their session | Offboarding/incident-response action doesn't actually stop access | Re-check `user.status` per-request, or maintain a session-version/deny-list, or shorten JWT `maxAge` as an interim measure |
| No password-reset/change capability at all | Account recovery is entirely unsupported by the application | Build at minimum an admin-triggered "set new password" action |
| No request-correlation ID; error logs carry no actor context | Real production-debugging gap | Thread a request ID and `{companyId, userId}` from `session` through `handleApiError`/`toErrorResponse` into the log line |
| `dispatch.service.test.ts` has zero race-guard rejection tests despite the most guard call sites of any module | The highest-guard-density module is the one with no proof its guards actually reject under contention | Add `{count: 0}` tests mirroring the pattern already used in `journal.service.test.ts`/`sales-order.service.test.ts` |
| `npm audit`: 1 high-severity finding in a real runtime path (`uuid` via `exceljs`) | Confirmed via `npm audit`, not fabricated | Evaluate a non-vulnerable `exceljs` release rather than blindly downgrading |
| `next-auth` pinned with `^` on a beta version | A routine `npm ci` could pull in an unreviewed breaking change to the auth/session/RBAC layer | Pin the exact version, track GA for a deliberate upgrade |
| CI never exercises a real Postgres database | Zero automated verification that Prisma queries/migrations actually work against real Postgres | Add a `services:` Postgres container to CI, or accept and document this as a known gap |

### P2 — Recommended
- Add magic-byte/extension-independent-of-MIME validation as defense-in-depth even after CF-6's primary fix.
- Fix the encryption test's flaky tamper assertion (mutate a byte guaranteed to differ, don't rely on a fixed-suffix mutation).
- Move `recordSampleApproval()`'s self-approval assert from the route into the service (matching the pattern already used for `approveLeaveRequest()`), so a future second caller can't accidentally reintroduce a bypass.
- Add a cross-cutting contract test: "every `update*`/`transition*` function that takes an `id` also validates a `companyId`" — the single highest-value structural test missing from the suite, per the exact bug class this audit and prior sweeps keep re-finding.
- Add Dependabot/CodeQL to CI — cheap, GitHub-native, would have caught the `npm audit` findings automatically.
- Wire `PermissionService.invalidate()` into whatever the next role-editing feature turns out to be, before that feature ships, not after.
- De-duplicate the `EXPORT_ROW_CAP = 20000` magic number across the 3 Excel export routes into one shared constant.

### P3 — Future Enhancement
- Nonce-based CSP (requires introducing per-request middleware for the first time, not "wrapping" existing middleware as the current comment implies).
- TOTP-based 2FA — see the dedicated architecture assessment below.
- OpenAPI spec generation from the existing Zod request schemas (viable and low-effort for the request side; response-shape and query-param documentation would need real additional authoring) — genuinely Optional given no external API consumer exists today.
- A background job queue for the CSV import path once row counts or DB latency make the synchronous in-request loop a real timeout risk.
- Redis-backed rate limiter and `PermissionService` cache, once/if this ever runs on more than one instance.

---

## 2FA/TOTP Architecture Assessment (report only, not implemented)

**Current state:** `User.mfaSecret` is the only relevant schema column, and it is completely unused by any application code today.

**What must change:**
- Add `mfaEnabled Boolean @default(false)` so `authorize()` can branch cheaply and an "enrolled but not yet verified" state is representable.
- Add backup/recovery-code storage — a dedicated `MfaRecoveryCode` table (hashed codes, a `used` flag, `userId` FK) matches this schema's existing relational style better than a JSON blob.
- `mfaSecret` should be stored **encrypted**, not plaintext — this codebase already has a tested `encryptSecret`/`decryptSecret` pair (`src/core/security/encryption.ts`, currently used only for ad-integration OAuth tokens) that's a direct fit with zero new infrastructure.

**Recommended implementation approach:** verification belongs inside `authorize()` in `auth.ts` (already Node-only, same as the existing bcrypt check — not a constraint issue). The real design work is that NextAuth's Credentials provider has no native multi-step challenge mechanism: a genuinely secure two-step login (password, then TOTP) needs either a short-lived server-side "password already verified, awaiting TOTP" cache entry (similar in shape to the existing `rateLimiter.ts`'s `LRUCache`) or careful client-side flow design — this is the actual source of implementation effort, not the TOTP math itself. The existing lockout logic should also gate a failed TOTP code, not just a failed password.

**Complexity estimate: Medium.** Lowered by: the encryption primitive already exists and is tested; the RBAC/audit-log conventions a new MFA-enrollment sub-module would follow are already well-established (`user-admin.service.ts` is a ready-made template). Raised by: the credentials-provider multi-step-challenge design gap above, plus backup-code UX (often underestimated), plus the fact that a thorough MFA rollout would naturally want to fix CF-7 (session revocation) in the same effort, since "force re-authentication for all existing sessions when MFA is turned on" is a standard expectation with no existing mechanism to support it today.

---

## Final Recommendation

**1. Can `Hardening` be merged into `main` now?**
Not yet — not because the commit itself is unsafe (it isn't; every one of its own claims independently verified clean), but because this audit found P0-severity issues that predate the branch and are equally present on `main`. Merging now would ship a "Phase 11 Hardening" commit into `main` while known HIGH-severity, live findings (CF-2 through CF-4, CF-1) remain open — a misleading signal for a branch whose entire purpose is hardening.

**2. If not, exactly what blocks the merge?**
The 5 P0 items above: the two cross-tenant record-disclosure findings (CF-2 and its siblings), the `passwordHash` leak (CF-3), the supplier bank-details leak (CF-4), the JobOrder lost-update race (CF-1), and applying the 5 pending migrations (CF-8). All five are small, bounded, well-understood fixes — realistically a single focused session, not a redesign.

**3. After merging (once P0s are fixed), can the ERP be called production-ready?**
Not yet — the P1 list (idempotency on ledger-writing endpoints, the executable-upload gap, session revocation on suspend, missing password-reset capability, missing request-correlation/actor-context logging, the dispatch test gap, the `npm audit` finding, the `next-auth` version pin, and CI never touching a real database) still needs to close first. None of these are architecturally hard; several are one-line-to-one-function-scale fixes.

**4. If not, exactly what remains?**
The full P1 list above, followed by the P2 list as a second, lower-urgency pass. The P3 list (2FA, nonce-based CSP, OpenAPI, a job queue, Redis) are genuinely later-phase items, not production blockers for an initial internal rollout.

**5. Which items require architectural decisions from the owner?**
2FA's login-flow redesign (password-then-TOTP two-step UX, and whether/how to force re-authentication of existing sessions when it's turned on); the session-revocation mechanism for CF-7 (re-check-per-request vs. deny-list vs. shortened `maxAge` — a real tradeoff between DB load and security); whether to invest in a background job queue now or defer it (ties to how large CSV imports/exports are expected to get in practice); the `next-auth` beta-to-GA migration timing; and any decision to add paid observability/security-scanning tooling (Sentry, Snyk, etc.) rather than the current lightweight in-house approach.

**6. Which items can Claude safely implement without further approval?**
All 5 P0 items (they follow exact, already-proven patterns elsewhere in this same codebase — narrowing an `include` to a `select`, adding a company-ownership check identical to the one three sibling functions already have, converting one accumulator to the guarded-`updateMany` idiom already used everywhere else, and running the pending migrations). Most of the P1 list is equally mechanical: the idempotency-key pattern, magic-byte file validation, threading actor context into the logger, the dispatch test additions, the `exceljs`/`next-auth` version decisions (pin, don't guess), and adding a Postgres service container to CI. The genuinely judgment-requiring items are called out in question 5 above.
