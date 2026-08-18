# Fashion ERP — Senior Architecture Review

**Reviewed as of**: 2026-08-17, Phase 3 (Masters) complete, Phase 4+ not started.
**Method**: Direct inspection of source — `prisma/schema.prisma` (1,048 lines), `src/core/*`, `src/modules/*`, `src/app/api/v1/*` (~50 route groups), `package.json`, `.gitignore`, `next.config.ts`, `src/proxy.ts`. Every claim below is backed by a specific file, not a guess about "typical Next.js projects."

**Verdict up front, since you asked for extreme criticism, not comfort**: this is a well-organized *early-stage MVP prototype* with genuinely good bones in a few specific places (structured error handling, audit-log design, RBAC skeleton, consistent API conventions). It is **not** enterprise-grade and **not** FAANG-grade — not because of any single flaw, but because entire required pillars are simply absent: zero tests, zero CI/CD, zero logging/observability, no security hardening, and a permission model too coarse for the compliance story this domain (garment manufacturing, financials, multi-role factory floor) actually needs. None of that is a surprise for Phase 3 of an 11-phase build — but graded against your stated bar (Google/Microsoft/Amazon/Netflix/Meta), it has to be said plainly.

---

## 1. Folder Structure & Organization

**Structure observed**:
```
src/
  app/(auth)/login, app/(dashboard)/masters/**, app/api/v1/**
  modules/<domain>/{*.schema.ts, *.service.ts}
  core/{auth,rbac,db,errors,audit,numbering,file-storage}
  components/{ui,layout}
  config/rbac.ts
  lib/
```
This is a legitimate feature-based (vertical-slice) layout, and it's applied consistently — every one of the ~27 master entities follows the identical `schema.ts` + `service.ts` + `route.ts` + `page.tsx` quartet. That consistency is a real strength; a new file always looks like the last one.

**Problem**: `src/modules/*` has no `*.repository.ts` anywhere, despite Phase 1's own stated three-layer plan (controller → service → repository). Services call `prisma.*` directly (confirmed in `customer.service.ts`, `product.service.ts`, all of them).

**Why it's a problem**: The repository layer isn't ceremony — it's the seam that lets you unit-test business logic without a database, swap ORMs, or add caching without touching every service. Right now, "testing `createCustomer`'s duplicate-code check" *means* "spin up Postgres." That's a real (not cosmetic) unit-testability gap for the layer richest in business rules (RBAC self-approval, stock checks, journal balancing — none built yet, but this is exactly where they'll live).

**Impact**: Scalability is fine right now (Prisma queries are simple). Maintainability degrades the moment Phase 5–7 (Production/Inventory/Accounts) land real business logic — those modules will have 5–10x the branching of a `createCustomer`, and untestable-without-a-DB logic at that complexity is where regressions hide.

**Industry-standard fix**: Introduce the repository layer *now*, before Phase 5, not after. Minimal version — one function per query shape, no ORM leakage into services:
```ts
// customer.repository.ts
export const CustomerRepository = {
  findByCode: (companyId: string, code: string) =>
    prisma.customer.findFirst({ where: { companyId, code, deletedAt: null } }),
  create: (data: Prisma.CustomerCreateInput) => prisma.customer.create({ data }),
};
```
Services then depend on the repository interface, which can be mocked in tests without touching Postgres.

**Score impact**: Moderate. Docked under "Separation of Concerns" and "Testing."

---

## 2. Scalability & Maintainability

**Problem #1 — single 1,048-line `schema.prisma`.** Every one of ~50 models (Org/Auth, 27+ masters, System) lives in one file. CLAUDE.md itself flagged this as a future option ("or split per domain under prisma/schema/") but it was never done.

**Why it's a problem**: Prisma has supported multi-file schemas (`prisma/schema/*.prisma`, merged at build) for several versions now, specifically to solve this. A single file at this size means every schema PR touches the same file — merge conflicts are guaranteed once more than one person or one agent works on schema changes concurrently, and `git blame`/history readability degrades.

**Industry-standard fix**: Split by domain — `prisma/schema/{org,masters-core,masters-garment,masters-hr,system}.prisma` — using Prisma's native multi-file support. Zero behavior change, pure organization.

**Problem #2 — the `masters` RBAC module covers ~27 unrelated entities as one permission scope.** `src/config/rbac.ts` defines `MODULES` at a reasonable granularity for transactional domains (`sales_orders`, `purchasing`, `accounts`, `payments` are all separate), but every master table — Customer, Supplier, Employee, **and** Bank Account, Payment Type, Cost Master, HR config — shares the single `"masters"` key. `STORE_MANAGER`'s permission set is `masters: ["view","create","edit"]`, which per the code as written also grants edit rights on Bank Accounts and Payment Types — masters that have nothing to do with warehouse operations.

**Impact**: This isn't hypothetical — it's a segregation-of-duties violation the moment Phase 7 (Accounts) goes live, because `financial_reports`/`accounts` module gating won't retroactively narrow what `masters` already grants. A Store Manager editing a company bank account because "masters" was too broad is exactly the kind of finding an actual SOC 2 or ISO 27001 audit flags.

**Industry-standard fix**: Split `masters` into at least `masters_core` (Customer/Supplier/Product/Warehouse — operational) and `masters_finance` (Bank Account, Payment Type, Cost Master — financial), gated at the same rigor as `accounts`/`payments`. This is a `config/rbac.ts` change plus a permission-seed rerun, not a schema migration — cheap to fix now, expensive to fix after five more phases assume the current shape.

---

## 3. Separation of Concerns

**Genuinely good**: `requireSession()` → `PermissionService.assert()` → `zod.parse()` → service call → `NextResponse.json()` is applied with zero deviation across every route file I checked (~50). That's a real, load-bearing consistency win — a new engineer (or agent) can predict the shape of any route they haven't opened yet.

**Problem**: Business-rule validation (duplicate-code checks, reference checks) lives inline in service functions, mixed with Prisma calls and audit-log writes, e.g. `createCustomer` does existence-check → create → audit-log in one function body with no named steps. Fine at today's complexity; will not stay fine once a `createSalesOrder` needs BOM checks, credit-limit checks, and sample-approval checks all inline.

**Fix**: Extract validation into named, independently testable functions per module (`assertCodeNotInUse`, `assertNotReferenced`) even before the repository layer lands — cheap now, expensive to retrofit onto 15 transactional services later.

---

## 4–5. Industry Best Practices / Clean & Layered Architecture

The project **claims** a layered architecture (Phase 1 doc: "schema/service/repository") but **ships** a two-layer one (schema/service) with the repository layer dropped as a documented deviation. That's an honest deviation, at least — it's written down in CLAUDE.md, not silently drifted. But "we decided to skip the repository layer because these are simple CRUD masters" stops being true the moment Phase 5 lands, and there's no trigger condition written down for *when* to add it back. Right now, the decision to add it is going to be made under time pressure mid-Phase-5, which is the worst time to introduce a structural layer.

**Recommendation**: Write the trigger condition into CLAUDE.md now: "repository layer is mandatory starting Phase 5" — turns an implicit debt into a tracked one.

---

## 6. Naming Conventions

Genuinely consistent: `camelCase.service.ts`/`camelCase.schema.ts` for modules, `PascalCase.tsx` for components, kebab-case for API route segments (`fabric-gsms`, `hr-config`), `SCREAMING_SNAKE` for enums matching Prisma convention. Prisma field mapping (`@map("company_id")`) consistently converts camelCase app-side to snake_case DB-side. No issues found here — this is one of the stronger dimensions of the codebase, and I looked for exceptions across all ~27 modules and didn't find meaningful ones.

---

## 7. Reusability & Modularity

**Genuinely good**: `SimpleLookupManager`, `DataTable`, `ConfirmModal`, `ToggleSwitch`, `Breadcrumb` are real shared components used across 20+ pages each, not copy-pasted per page. `makeSimpleLookupService()` factory in `garment-attributes.service.ts` collapses 8 near-identical CRUD triples into one generic function — that's exactly the right instinct.

**Problem**: The reuse is *within* the masters domain only. There's no shared "list query + pagination" hook usable outside `DataTable`, no shared form-validation-error-display component (each Form re-implements its own `{error && <p>...}` block identically ~10 times) — small, but it's the kind of duplication that should have been extracted the third time it was copy-pasted, not the tenth.

---

## 8. Feature-Based vs Layer-Based Organization

Feature-based within `src/modules/`, layer-based within each module (schema/service files). This hybrid is the correct choice for this domain size (~15 bounded contexts per the architecture doc) — a pure layer-based split (`services/`, `controllers/`, `models/` at the root) would be actively worse here. No finding; this is right.

---

## 9–10. Configuration Management & Environment Variables

**Problem**: No `.env.example` committed. `.gitignore` correctly excludes `.env*`, but there is no template documenting *which* variables a new environment needs (`DATABASE_URL` at minimum, likely `NEXTAUTH_SECRET`/`AUTH_SECRET` for NextAuth v5, possibly `NODE_ENV`).

**Why it matters**: Onboarding a second developer (or redeploying to staging) currently requires reading source code to reverse-engineer the required env vars. This is a 10-minute fix with outsized payoff.

**Fix**:
```bash
# .env.example
DATABASE_URL="postgresql://user:password@localhost:5432/fashion_erp"
AUTH_SECRET="generate-with-openssl-rand-base64-32"
NODE_ENV="development"
```

**Problem**: `next.config.ts` is the default empty scaffold — `const nextConfig: NextConfig = {};`. No security headers (`Content-Security-Policy`, `X-Frame-Options`, `Strict-Transport-Security`), no image domain allowlist, nothing.

**Fix** (industry-standard baseline, not exotic):
```ts
const nextConfig: NextConfig = {
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      ],
    }];
  },
};
```

---

## 11. API Structure

This is the strongest section of the review. `/api/v1/<resource>` base path, plural nouns, one level of nesting (`customers/[id]/buyers`, `warehouses/[id]/locations`), sub-resource POSTs for non-CRUD actions (`products/[id]/variants/bulk`), and — the detail that actually matters — a genuinely uniform `{ data, meta? }` success shape and `{ error: { code, message, details } }` failure shape enforced by one shared `handleApiError()`. I checked ~15 route files across different modules and the shape never drifted.

**Minor problem**: No API versioning strategy beyond the `v1` prefix existing — there's no policy written down for what happens at `v2` (parallel routes? header-based negotiation?). Not urgent at 1 version, but worth a one-paragraph decision record before it's needed under pressure.

**Real problem**: No OpenAPI/Swagger spec, generated or hand-written. At ~50 endpoints, there is no machine-readable contract a frontend team (or external integrator) could consume, and no generated API docs. For a system that explicitly plans purchasing/dispatch/accounts integrations later, this will be needed.

---

## 12. Authentication & Authorization Architecture

**Genuinely good**: NextAuth v5 Credentials with a correctly-split edge-safe config (`auth.config.ts`, no Prisma) vs. full config (`auth.ts`, Prisma + bcrypt) — this split exists specifically because Credentials+Prisma can't run on the Edge runtime, and CLAUDE.md documents *why*, not just *what*. `PermissionService.assert()` correctly denies self-approval (`resourceContext.createdBy === userId` blocks `approve`/`post` unless SUPER_ADMIN) — this is a real, working segregation-of-duties control, not a placeholder.

**Problem #1 — no brute-force protection.** `auth.ts`'s `authorize()` does `findUnique` → `verifyPassword` → done. No rate limiting, no account lockout after N failed attempts, no exponential backoff, no CAPTCHA trigger. This is textbook OWASP A07 (Identification and Authentication Failures) territory.

**Fix**: minimum viable — track failed attempts (Redis or a DB counter) and lock for N minutes after 5 failures; better — use a proper rate-limiter (`@upstash/ratelimit` or equivalent) in front of the credentials route.

**Problem #2 — `proxy.ts`'s matcher explicitly excludes `/api/*`.**
```ts
export const config = { matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"] };
```
This means the edge-level auth gate provides **zero** defense-in-depth for API routes — every one of ~50 route files is individually responsible for calling `requireSession()` correctly. I confirmed this pattern holds today, but there is no fail-safe: one new route file that forgets the call is a silent, unauthenticated data leak, and nothing in the architecture would catch that in review except a human reading every diff.

**Fix**: Either (a) add a second, API-scoped middleware check as defense-in-depth (verify a session cookie exists before the handler even runs), or (b) add an automated test that asserts every file under `app/api/v1/**/route.ts` imports `requireSession` — a 20-line CI check that turns "hope everyone remembers" into "the build fails if someone forgets."

**Problem #3 — 2FA was planned (CLAUDE.md: "optional TOTP 2FA for Super Admin/Accounts roles at minimum," `User.mfaSecret` column exists in schema) and never implemented.** Not a bug — a tracked, deferred item — but worth stating plainly since it's a stated MVP requirement for the roles that touch money.

---

## 13. Database Organization

**Genuinely good**: UUID PKs, `company_id` on every business table (multi-tenant-ready without a schema change later), consistent `isActive`/`deletedAt` soft-delete convention, FKs always by `.id` never by human-readable `.code` (meaning the sequential/mnemonic code work done today can never orphan a reference — this was verified, not assumed). Prisma singleton (`globalForPrisma` pattern) correctly avoids the classic Next.js hot-reload connection-exhaustion bug.

**Problem**: `Product.departmentId` exists as a raw column with **no** `@relation` declared (confirmed in the earlier FK-mapping inspection) — meaning no DB-level foreign key constraint exists for it at all, and it's silently unreachable from every API layer. This is the kind of half-wired column that looks intentional (it has a name, a type) but produces zero referential integrity. It's the single clearest "this needs a decision, not more code" item in the schema.

**Problem**: `AuditLog` writes are inconsistent — richer masters (Customer, Supplier, Employee, Product) call `writeAuditLog`; the ~20 `SimpleLookupManager`-backed masters (Colors, Brands, all Batch 1/2 additions) do not. For a system whose own audit-log doc-comment says "every create/update/approve/... **must** call this," roughly half the masters silently don't. This is a compliance gap for any environment that needs a real audit trail (which, per your own Phase 1 design intent — audit logging as a first-class System table — this system is supposed to be).

---

## 14. Error Handling

This is the second-strongest section. `BusinessRuleError` is a real, closed-set error-code enum (`INSUFFICIENT_FG_STOCK`, `UNBALANCED_JOURNAL`, `POSTED_INVOICE_LOCKED`, etc.) mapped to correct HTTP status codes (409 for conflicts, 422 for unprocessable, 403 for permission, 400 for validation) — this is meaningfully better than the "everything is a 400 or 500" pattern most early-stage projects ship. Zod validation errors are automatically translated into the same envelope. Unhandled errors fall through to a generic 500 with a user-safe message (`"Something went wrong..."`) rather than leaking a stack trace — correct.

**Problem**: The unhandled-error fallback does `console.error("Unhandled error:", error)` and nothing else (see §15 — this *is* the entire error observability story). In production, that line is invisible the moment the process's stdout isn't being captured somewhere durable.

---

## 15. Logging Strategy

**There is no logging strategy.** I grepped the entire `src/` tree for `console.log|console.error|console.warn` and found exactly one call site — the catch-all in `toErrorResponse()`. No request logging, no structured logging (no `pino`/`winston`/`bunyan` in `package.json`), no correlation IDs, no log levels, nothing shipped to any log aggregator (Datadog, CloudWatch, Sentry — none present).

**Why this matters more than it might seem**: this is a multi-tenant financial/inventory system. When a customer reports "my invoice total is wrong" six weeks from now, there is currently *no way* to reconstruct what happened beyond the `AuditLog` table (which itself isn't consistently written, per §13) — no request trace, no timing data, no error correlation.

**Industry-standard fix**: minimum viable — `pino` with a request-ID middleware wrapping every API route (or Next.js's own `instrumentation.ts` hook), shipping to *something* durable even if it's just structured JSON to stdout captured by the hosting platform. This is genuinely a half-day task and belongs in Phase 2/3, not deferred to "Hardening" (Phase 11) as currently implied by the roadmap — six phases of business logic will ship with zero observability otherwise.

---

## 16. Testing Structure

**There are zero tests.** No `*.test.ts`, no `*.spec.ts`, no `tests/` directory, no test runner in `package.json` (no Jest, Vitest, Playwright, Cypress). CLAUDE.md's own Verification section states "Each phase ships its own critical-path tests before moving to the next phase" — this has not happened for Phases 2 or 3.

**Impact**: This is the single largest gap in the review, full stop. Every one of the ~27 master modules, the RBAC self-approval logic, the numbering-sequence atomicity, the soft-delete/reference-check logic — none of it is regression-protected. The project is currently one refactor away from a silent break in, say, the self-approval check, with no automated signal before a human notices in production.

**Industry-standard fix, concretely scoped**:
1. **Now (before Phase 4)**: Vitest + a handful of unit tests for the highest-risk logic that already exists — `PermissionService.can()`'s self-approval branch, `DocumentNumberingService`'s atomic-increment behavior under concurrent calls (this is exactly the kind of race a unit test with two parallel promises catches and a manual QA pass never will), `BusinessRuleError` → HTTP status mapping completeness.
2. **Per CLAUDE.md's own stated plan**: integration tests hitting a real (test) Postgres instance for the state-machine transitions once Phase 5+ lands them — this is precisely why the repository layer (§1) matters, since it's what makes these tests fast to write.
3. E2E (Playwright) for the golden path once Phase 8 (Dispatch) closes the full order-to-cash loop, per the project's own "Verification" section.

---

## 17. Security Best Practices

Consolidating findings from other sections plus new ones:

| Finding | Severity | Status |
|---|---|---|
| No rate limiting on login or any API route | High | Not implemented |
| No brute-force lockout | High | Not implemented |
| No security headers (`next.config.ts` empty) | Medium | Not implemented |
| API routes have no edge-level defense-in-depth (§12) | Medium | Not implemented |
| 2FA planned, not implemented | Medium (for financial roles) | Deferred, tracked |
| Passwords hashed with bcrypt (`bcryptjs`, cost factor 12 — confirmed in `password.ts`) | — | Correct, meets OWASP minimum |
| SQL injection | — | Not applicable — Prisma parameterizes all queries; no raw SQL found |
| Secrets in `.env`, correctly gitignored | — | Correct |
| RBAC enforced server-side, not trusted from client (confirmed pattern) | — | Correct, genuinely good |
| No dependency vulnerability scanning (no `npm audit` in CI — there is no CI) | Medium | Not implemented |

---

## 18. Performance Considerations

Not yet a real concern at current data volumes, but two forward-looking notes:
- No caching layer anywhere (Redis, in-memory beyond `PermissionService`'s own permission-key cache). Fine today; the `masters` list endpoints doing `findMany` + `count` in `Promise.all` per request (correct pattern, confirmed in every module) will need pagination-aware caching once table sizes grow past a few thousand rows per company.
- No database indexes beyond what Prisma's `@@unique` constraints imply. Once transactional tables (Phase 5+) exist with real query patterns (date-range filters, status filters), explicit `@@index` declarations will be needed — not urgent now, but worth planning before Phase 6 (Inventory) ships a stock-ledger table that gets queried by date range constantly.

---

## 19. CI/CD Readiness

**There is no CI/CD.** No `.github/workflows/`, no `.gitlab-ci.yml`, no pre-commit hooks (no Husky), no automated `tsc --noEmit`/`eslint`/test run on push or PR. Every verification in this project (including everything in this review's own working session) has been manual (`npx tsc --noEmit` run by hand). That doesn't scale past one contributor, and it means nothing stops a broken build from being merged.

**Minimum viable fix** — one workflow file:
```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npm run lint
      - run: npm test # once tests exist
```
This is not a big lift — it's a same-day task with a very high payoff-to-effort ratio, and it's the one item on this whole review I'd genuinely call embarrassing to still be missing at Phase 3.

---

## 20. Production Readiness

Assembling everything above: **this is not production-ready**, and it isn't close. Concretely blocking:
- No tests → no regression safety net
- No CI/CD → no automated gate before deploy
- No logging/observability → blind in production
- Local file storage (`FileStorage.ts`, per CLAUDE.md itself) → won't survive a container restart or horizontal scaling; needs S3-compatible storage before any real deploy
- No rate limiting/brute-force protection → exploitable auth
- No `.env.example`, no documented deployment process, no health-check endpoint found

None of this is unusual for Phase 3 of an explicitly-staged 11-phase build — but "production-ready" and "MVP-in-progress, phase 3 of 11" are different claims, and the roadmap's own "Hardening" phase (11) is where most of this is currently scheduled, which is later than the risk profile of a financial/inventory system should tolerate.

---

## Scores

| Dimension | Score /10 | Rationale |
|---|---|---|
| **Overall Architecture** | **6.0** | Genuinely solid conventions (API shape, error handling, RBAC skeleton) undermined by missing structural layers (repository, granular permissions) that will bite starting Phase 5 |
| **Scalability** | **6.0** | Multi-tenant-ready schema design, but single-file schema and coarse RBAC won't scale past a few more phases without the refactors noted above |
| **Maintainability** | **5.5** | High consistency is a real asset; zero tests and zero CI mean maintainability is currently sustained by discipline alone, not tooling |
| **Production Readiness** | **3.0** | Missing entire required pillars (testing, CI/CD, logging, security hardening, durable file storage) — not a judgment on code quality, a judgment on operational readiness |
| **Resume/Portfolio Quality** | **6.5** | Above-average for a solo/AI-paired project — the RBAC self-approval logic, structured error taxonomy, and multi-tenant schema design are genuinely worth showing in an interview; zero tests and no CI are exactly what a FAANG interviewer will ask about first, so be ready to say "Phase 3 of 11, tests are scoped for Phase 4" rather than let it look like an oversight |

**Does this meet startup, enterprise, or FAANG-level standards?**
**Startup-level (early-stage/MVP): yes, comfortably.** **Enterprise-level: no** — missing testing, CI/CD, observability, and a granular permission model are all enterprise-baseline requirements, not nice-to-haves, and none are present yet. **FAANG-level: no**, and not close — the gap isn't code quality (the code that exists is clean), it's the complete absence of the operational scaffolding (test coverage, CI gates, observability, security hardening) that FAANG review would treat as table stakes before discussing architecture at all.

---

## Prioritized Improvements

**High priority** (do before Phase 4 starts):
1. Add CI (`tsc --noEmit` + `eslint` on every push) — same-day task, stops regressions immediately
2. Add `.env.example`
3. Split the `masters` RBAC module into at least `masters_core`/`masters_finance` before more roles are seeded against the current shape
4. Add `next.config.ts` security headers
5. Fix or remove the orphan `Product.departmentId` column
6. Add rate limiting + lockout to the credentials `authorize()` path

**Medium priority** (during Phase 4–5):
7. Introduce the repository layer before Phase 5's transactional modules land
8. Add a structured logger (`pino`) + request correlation IDs
9. Make `writeAuditLog` calls consistent across all masters, not just the "rich" ones
10. Split `schema.prisma` into per-domain files
11. Start Vitest unit tests for `PermissionService`, `DocumentNumberingService`, `BusinessRuleError` mapping

**Low priority** (can wait for Phase 8–11 as currently scheduled):
12. OpenAPI spec generation
13. Redis caching layer for list endpoints
14. Explicit DB indexes once real query patterns exist
15. 2FA for financial roles
16. Migrate local file storage to S3-compatible storage
17. E2E test suite (Playwright) once the order-to-cash loop closes
