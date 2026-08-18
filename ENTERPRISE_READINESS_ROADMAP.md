# Fashion ERP — Enterprise Readiness Implementation Roadmap

**Role**: Implementation architect / mentor document. This is a plan, not a change — nothing in this document has been applied to the codebase yet. Each phase below is implemented only after you confirm it, in order, so the project is never left broken mid-refactor.

**Constraints honored throughout**: Next.js 16 (App Router), TypeScript, Prisma 7, PostgreSQL, NextAuth v5, Zod. No architectural redesign — every fix below is additive or a narrow, contained refactor of what already exists. Where more than one real option exists, it's compared and one is recommended with a reason, not both presented as equal.

---

## Dependency Graph

Tasks that don't block each other are listed side by side; arrows mean "must exist before this starts."

```mermaid
graph TD
    A1[.env.example] --> A2[CI/CD pipeline]
    A3[Security headers] --> A2
    A2 --> B1[Rate limiting]
    A2 --> B2[RBAC granularity fix]
    A2 --> C1[Repository layer]
    C1 --> C2[Audit logging via Prisma extension]
    C1 --> D1[Vitest + unit tests]
    A2 --> D1
    D1 --> D2[CI test gate]
    A2 --> E1[Structured logging]
    E1 --> E2[Observability / Sentry]
    A1 --> E3[Cloud file storage]
    C1 --> F1[API documentation]
```

**Why this order**: CI/CD comes second (right after the 15-minute `.env.example`) on purpose — every task after it is instantly regression-checked the moment it's merged, instead of relying on manual `tsc` runs like this session has been doing. The **Repository layer** is the single highest-leverage prerequisite in the whole roadmap: it's what makes real unit testing possible (Task D1) and it's a clean place to hang automatic audit logging (Task C2) — do it once, get two downstream tasks cheaper.

---

## Phase A — Production Foundation
*(Sprint 1, days 1–2. Mandatory for MVP: all three.)*

### A1. `.env.example`

| | |
|---|---|
| **Priority** | High |
| **Mandatory for MVP** | Yes |
| **Difficulty** | Easy |
| **Time estimate** | 15 minutes |
| **Prerequisites** | None |
| **Risks** | None — this is documentation, not runtime code |

**Why**: Right now, standing up a second environment (new laptop, staging server, CI runner) requires reading `src/core/db/client.ts` and `auth.ts` to reverse-engineer which env vars exist. That's a 100%-avoidable onboarding tax.

**When**: Immediately — it's the cheapest task in this entire document.

**How large companies solve it**: Every serious repo ships a `.env.example` committed to git, with real `.env` gitignored (which you already do correctly). Some go further with `.env.local`/`.env.staging`/`.env.production` templates — not needed yet at your scale.

**Files to change**:
```
fashion-erp/
└── .env.example          # NEW
```

**Code**:
```bash
# .env.example — copy to .env and fill in real values. Never commit .env.

# PostgreSQL connection string used by Prisma
DATABASE_URL="postgresql://postgres:password@localhost:5432/fashion_erp"

# NextAuth v5 — generate with: openssl rand -base64 32
AUTH_SECRET="replace-with-a-real-32-byte-random-secret"

NODE_ENV="development"
```

**Validation checklist**:
- [ ] `.env.example` committed to git
- [ ] `.env` still in `.gitignore` (already true)
- [ ] A teammate can `cp .env.example .env`, fill 2 values, and run `npm run dev` successfully

**Common mistakes**: Committing real secrets "temporarily" into `.env.example` — always use obviously-fake placeholder values.

---

### A2. CI/CD Pipeline (basic gate)

| | |
|---|---|
| **Priority** | Critical |
| **Mandatory for MVP** | Yes |
| **Difficulty** | Easy–Medium |
| **Time estimate** | 2–3 hours |
| **Prerequisites** | A1 (so CI has something to reference for required env vars) |
| **Risks** | A flaky/misconfigured CI can block all merges — start with the minimum viable gate, expand later |

**Why**: Every check that currently protects this codebase (`npx tsc --noEmit`, manual `eslint`) has been run by hand, this session, by me. That does not scale past one contributor and catches nothing automatically on a forgotten check.

**When**: Right after A1 — everything from Phase B onward should already be covered by this gate.

**How large companies solve it**: GitHub Actions (or GitLab CI/CircleCI, but you're already on GitHub per `CLAUDE.md`'s repo link) running `typecheck → lint → build → test` on every PR, required to pass before merge (branch protection rule). This is genuinely the industry floor, not an aspirational practice — teams at every scale from 2-person startups to FAANG run this exact shape of pipeline; what changes with scale is what runs *inside* each stage, not whether the stages exist.

**Files to change**:
```
fashion-erp/
└── .github/
    └── workflows/
        └── ci.yml          # NEW
```

**Packages**: none — everything used already exists in `devDependencies`.

**Code**:
```yaml
# .github/workflows/ci.yml
name: CI

on:
  pull_request:
  push:
    branches: [main, testing-master]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: "npm"

      - run: npm ci

      - name: Type check
        run: npx tsc --noEmit

      - name: Lint
        run: npm run lint

      - name: Build
        run: npm run build
        env:
          DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/fashion_erp"
          AUTH_SECRET: "ci-placeholder-secret-not-used-for-anything-real"
```

**Commands to run locally first** (so you see it pass before pushing):
```bash
npx tsc --noEmit
npm run lint
npm run build
```

**Expected output**: A green check on every PR; a red X with the failing step highlighted if `tsc`/`eslint`/`build` fails.

**Validation checklist**:
- [ ] Push a branch with a deliberate type error → CI fails on the "Type check" step
- [ ] Fix it → CI goes green
- [ ] Enable branch protection on `main` requiring this check to pass before merge

**Common mistakes**: Forgetting `DATABASE_URL` in the build step's `env:` block (Next.js build can touch Prisma-generated types even without hitting a real DB) — the build stage needs *a* connection string, not necessarily a real reachable one, since `next build` doesn't execute queries, only generates the client.

---

### A3. Security Headers

| | |
|---|---|
| **Priority** | High |
| **Mandatory for MVP** | Yes |
| **Difficulty** | Easy |
| **Time estimate** | 1 hour |
| **Prerequisites** | None |
| **Risks** | Overly strict CSP can break inline styles/scripts if you add one later — start with the safe headers below, add CSP separately once you've audited what your pages actually load |

**Why**: `next.config.ts` is currently the empty scaffold — zero clickjacking protection, zero MIME-sniffing protection.

**How large companies solve it**: Every production Next.js app sets these at the edge via `next.config.ts`'s `headers()` — no library needed, this is a first-party Next.js feature.

**Files to change**:
```
fashion-erp/
└── next.config.ts          # MODIFY
```

**Code**:
```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
```

**Validation checklist**:
- [ ] `npm run dev`, then in browser devtools → Network → any request → Response Headers shows `x-frame-options: DENY`
- [ ] `curl -I http://localhost:3000` shows all 4 headers

**Common mistakes**: Adding a strict `Content-Security-Policy` in the same pass without testing — CSP is the one header that commonly breaks things (inline `<style>` from Tailwind's JIT, NextAuth's redirect flow). Ship the 4 safe headers above now; treat CSP as its own follow-up task with a dedicated test pass.

---

## Phase B — Security Hardening
*(Sprint 1–2, days 3–6. Mandatory for MVP: both.)*

### B1. Rate Limiting + Brute-Force Lockout

| | |
|---|---|
| **Priority** | Critical |
| **Mandatory for MVP** | Yes |
| **Difficulty** | Medium |
| **Time estimate** | 4–6 hours |
| **Prerequisites** | A2 (CI) so this doesn't ship with a silent bug |
| **Risks** | An in-memory limiter resets on every server restart/redeploy and doesn't share state across multiple instances — acceptable for a single-instance deployment (which this project currently is), **not** acceptable the day you run 2+ instances behind a load balancer |

**Why**: `auth.ts`'s `authorize()` currently does `findUnique → verifyPassword → done` — nothing stops an attacker from trying passwords in a tight loop against `/api/auth/callback/credentials`. This is OWASP Top 10 (A07: Identification and Authentication Failures) territory, not a style nitpick.

**How large companies solve it — comparison**:

| Approach | Works serverless/multi-instance? | New infra? | Fit here |
|---|---|---|---|
| In-memory (`lru-cache`-backed counter) | No | None | ✅ Recommended now — you run one instance, self-hosted, with a local Postgres |
| Upstash Redis + `@upstash/ratelimit` | Yes | Redis (managed, has free tier) | Upgrade path once you scale to multiple instances or move to serverless |
| DB-table-backed counter | Yes, but adds DB load per login attempt | None (reuses Postgres) | Worse than both above — don't use |

**Recommendation**: In-memory now, with the interface shaped so swapping to Redis later is a one-file change, not a rewrite.

**Files to change**:
```
fashion-erp/
├── src/
│   └── core/
│       └── auth/
│           ├── auth.ts                    # MODIFY
│           └── rateLimiter.ts             # NEW
└── package.json                            # MODIFY (add lru-cache)
```

**Packages**:
```bash
npm install lru-cache
```

**Code**:
```ts
// src/core/auth/rateLimiter.ts
import { LRUCache } from "lru-cache";

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

const attempts = new LRUCache<string, number>({ max: 5000, ttl: LOCKOUT_MS });

/** Call before verifying a password. Throws if the identifier is currently locked out. */
export function assertNotLockedOut(identifier: string): void {
  const count = attempts.get(identifier) ?? 0;
  if (count >= MAX_ATTEMPTS) {
    throw new Error("Too many failed login attempts. Try again in 15 minutes.");
  }
}

export function recordFailedAttempt(identifier: string): void {
  attempts.set(identifier, (attempts.get(identifier) ?? 0) + 1);
}

export function clearAttempts(identifier: string): void {
  attempts.delete(identifier);
}
```

```ts
// src/core/auth/auth.ts — inside authorize(), wrap the existing logic
import { assertNotLockedOut, recordFailedAttempt, clearAttempts } from "@/core/auth/rateLimiter";

authorize: async (credentials) => {
  const email = credentials?.email as string | undefined;
  const password = credentials?.password as string | undefined;
  if (!email || !password) return null;

  assertNotLockedOut(email); // throws a friendly error if locked out

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.status !== "ACTIVE") {
    recordFailedAttempt(email);
    return null;
  }

  const passwordValid = await verifyPassword(password, user.passwordHash);
  if (!passwordValid) {
    recordFailedAttempt(email);
    return null;
  }

  clearAttempts(email);
  // ...existing lastLoginAt update + return
},
```

**Testing**: Manually — fail login 5 times with the same email, confirm the 6th attempt returns the lockout message even with the *correct* password. Automated version comes in Phase D once Vitest exists (`rateLimiter.test.ts` — no DB needed, pure in-memory logic, perfect first unit test).

**Validation checklist**:
- [ ] 5 wrong passwords → 6th attempt (even correct password) is rejected with lockout message
- [ ] Wait 15 minutes (or lower `LOCKOUT_MS` temporarily for testing) → attempts allowed again
- [ ] A *correct* password on attempt 1–4 clears the counter (don't lock out someone who just fat-fingered attempt 1)

**Common mistakes**: Keying the limiter by IP alone (a shared office IP would lock out everyone) or by email alone (an attacker enumerating emails behind a rotating IP has no penalty) — key by email is fine for this app's threat model (credential stuffing against known accounts), but note that IP-based limiting is complementary, not a replacement, for a public-facing login.

---

### B2. RBAC Granularity Fix (split `masters` module)

| | |
|---|---|
| **Priority** | High |
| **Mandatory for MVP** | Recommended, not strictly blocking — but gets more expensive the longer it waits |
| **Difficulty** | Medium |
| **Time estimate** | 3–4 hours |
| **Prerequisites** | A2 (CI) |
| **Risks** | Reseeding permissions incorrectly can lock out existing roles — **must** run against a DB snapshot first, never directly against data with real users |

**Why**: `STORE_MANAGER`'s `masters: ["view","create","edit"]` today also grants edit rights on Bank Accounts, Payment Types, and Cost Master — a real segregation-of-duties gap the moment Phase 7 (Accounts) treats those as financially sensitive.

**How large companies solve it**: Fine-grained permission scopes per bounded context, never one catch-all "settings" or "masters" bucket. This is literally how your own `config/rbac.ts` already treats `sales_orders`/`purchasing`/`accounts` as separate modules — masters just never got the same treatment.

**No schema migration needed** — `Permission.module` is a plain `String` column, not a Postgres enum, so this is a pure application-config + reseed change.

**Files to change**:
```
fashion-erp/
├── src/
│   └── config/
│       └── rbac.ts                         # MODIFY
└── prisma/
    └── seed.ts                              # MODIFY (rerun permission seed)
```

**Code** (`src/config/rbac.ts`):
```ts
export const MODULES = [
  "dashboard",
  "masters_core",       // was "masters" — Customer/Supplier/Employee/Product/Warehouse/etc.
  "masters_finance",    // NEW — Bank Account, Payment Type, Cost Master
  "sampling",
  // ...unchanged rest
] as const;
```
Update every route file's `PermissionService.assert(session.user.id, "masters", ...)` call for the 3 finance-adjacent modules (`bank-accounts`, `payment-types`, `cost-masters`) to use `"masters_finance"`; every other masters route keeps `"masters_core"`.

Update `ROLE_PERMISSIONS`: only `SUPER_ADMIN`, `ACCOUNTS_MANAGER`, and `ACCOUNTS_EXECUTIVE` get `masters_finance`; `STORE_MANAGER`, `WAREHOUSE_USER`, `PRODUCTION_SUPERVISOR` etc. keep `masters_core` only.

**Commands**:
```bash
npx prisma db seed   # reruns the (now-updated) permission catalog + role_permissions
```

**Testing**: Log in as `STORE_MANAGER`, attempt `PATCH /api/v1/bank-accounts/:id` → expect `403 PERMISSION_DENIED`. Log in as `ACCOUNTS_MANAGER` → same call succeeds.

**Validation checklist**:
- [ ] Every route under `bank-accounts`, `payment-types`, `cost-masters` uses `masters_finance`
- [ ] Every other masters route uses `masters_core`
- [ ] Reseed run against a snapshot/staging DB first, diffed, then applied to real data
- [ ] Manual spot-check: 2 roles that should be blocked, 2 that should be allowed

**Common mistakes**: Running the reseed against production data without checking whether `role_permissions` rows for the *old* `"masters"` key get orphaned (they will — the seed uses `skipDuplicates`, it doesn't delete stale rows). Add an explicit cleanup step: `DELETE FROM permissions WHERE module = 'masters'` after confirming the new rows exist, not before.

---

## Phase C — Architecture Foundations
*(Sprint 2–3, days 7–11. Mandatory for MVP: repository layer recommended before Phase 4 (Sampling) adds transactional complexity; audit logging fix is high-value, medium urgency.)*

### C1. Repository Layer

| | |
|---|---|
| **Priority** | High |
| **Mandatory for MVP** | Optional for MVP demo; **mandatory before Phase 5** (Production/Inventory) per your own roadmap |
| **Difficulty** | Medium–Hard (mechanical, but touches every module) |
| **Time estimate** | 2–3 days for all ~15 existing modules |
| **Prerequisites** | A2 (CI) to catch mistakes across a wide-blast-radius refactor |
| **Risks** | Highest-blast-radius task in this roadmap — touches every service file. Do it module-by-module with a CI-green checkpoint after each, not as one giant PR |

**Why**: Today, "unit test `createCustomer`'s duplicate-code check" *means* "spin up Postgres," because the service calls `prisma.customer.findFirst` directly. A repository seam is what makes that a fast, DB-free unit test.

**How large companies solve it**: Thin repository functions (not classes, not a generic `Repository<T>` interface — that's over-engineering for this codebase's style, which is function-based throughout) — one function per query shape, services depend on the repository module, tests mock the repository module.

**Files to change** (pattern shown for `customers`, repeat per module):
```
src/modules/customers/
├── customer.repository.ts        # NEW
├── customer.service.ts           # MODIFY — replace prisma.* calls with repository calls
└── customer.schema.ts            # unchanged
```

**Code**:
```ts
// src/modules/customers/customer.repository.ts
import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

export const CustomerRepository = {
  findByCode: (companyId: string, code: string) =>
    prisma.customer.findFirst({ where: { companyId, code, deletedAt: null } }),

  findById: (companyId: string, id: string) =>
    prisma.customer.findFirst({ where: { id, companyId, deletedAt: null } }),

  list: (where: Prisma.CustomerWhereInput, args: Prisma.CustomerFindManyArgs) =>
    prisma.customer.findMany({ where, ...args }),

  count: (where: Prisma.CustomerWhereInput) => prisma.customer.count({ where }),

  create: (data: Prisma.CustomerCreateInput) => prisma.customer.create({ data }),

  update: (id: string, data: Prisma.CustomerUpdateInput) =>
    prisma.customer.update({ where: { id }, data }),
};
```

```ts
// src/modules/customers/customer.service.ts — before/after for one function
// BEFORE:
export async function createCustomer(actor: ActorContext, input: CustomerInput) {
  const existing = await prisma.customer.findFirst({
    where: { companyId: actor.companyId, code: input.code, deletedAt: null },
  });
  // ...
}

// AFTER:
import { CustomerRepository } from "./customer.repository";

export async function createCustomer(actor: ActorContext, input: CustomerInput) {
  const existing = await CustomerRepository.findByCode(actor.companyId, input.code);
  // ...
}
```

**Migration strategy** (so nothing breaks mid-way): do **one module per PR**, in this order — start with `customers` (simplest, well-understood, good template), then `suppliers`/`employees`/`warehouses` (same shape), then `products` (most complex — Style + Material share one table), then the `SimpleLookupManager`-backed modules last (lowest risk, most repetitive). After each module's PR, run the full manual smoke test for that module in-browser before moving to the next.

**Testing**: This is what unlocks Phase D — once `CustomerRepository` exists, `customer.service.test.ts` can mock it:
```ts
vi.mock("./customer.repository");
test("createCustomer rejects a duplicate code", async () => {
  vi.mocked(CustomerRepository.findByCode).mockResolvedValue({ id: "existing" } as any);
  await expect(createCustomer(actor, input)).rejects.toThrow("already in use");
});
```

**Validation checklist**:
- [ ] Each module's repository file exports only plain functions, no class, no generic base type
- [ ] Service files import from `./x.repository`, never `@/core/db/client` directly, once migrated
- [ ] Full manual CRUD smoke test per module after its migration (create, list, edit, deactivate)
- [ ] CI green after every module's PR

**Common mistakes**: Trying to do all 15 modules in one PR ("just get it over with") — this is exactly the kind of change where a mid-refactor mistake in module #3 is invisible until module #12's tests fail for an unrelated reason. One module at a time, always green in between.

---

### C2. Consistent Audit Logging (Prisma Client Extension)

| | |
|---|---|
| **Priority** | Medium-High |
| **Mandatory for MVP** | Optional, but the current "half the masters log, half don't" state is worse than either "all log" or "documented as deferred" |
| **Difficulty** | Medium |
| **Time estimate** | 1 day |
| **Prerequisites** | C1 helps but isn't required — a Prisma Client Extension wraps the client itself, so it catches writes regardless of whether they go through a repository or not |
| **Risks** | An extension that logs *every* write, including ones that shouldn't be audited (e.g. the `PermissionService` cache table if you ever add one), needs an opt-out list — build that in from day one, not as a patch later |

**Why**: `writeAuditLog`'s own doc-comment says every create/update/approve/.../delete **must** call it — but the ~20 `SimpleLookupManager`-backed masters never do. That's not a style gap, it's a broken invariant.

**How large companies solve it**: Rather than trust every developer to remember a manual call (the failure mode you already have), hook audit logging into the ORM layer itself so it's structurally impossible to forget. Prisma 7's Client Extensions (`$extends`) are the first-party mechanism for exactly this — replaced the older, now-removed `$use` middleware API.

**Files to change**:
```
fashion-erp/
└── src/
    └── core/
        └── db/
            ├── client.ts                 # MODIFY
            └── auditExtension.ts         # NEW
```

**Code**:
```ts
// src/core/db/auditExtension.ts
import { Prisma } from "@prisma/client";
import { prisma as basePrisma } from "./client";

const AUDITED_MODELS = new Set([
  "Customer", "Supplier", "Employee", "Product", "Brand", "Category",
  // ...every master model that should be audited
]);

// AsyncLocalStorage or a request-scoped context would carry actor info in a
// real implementation — shown here as a placeholder param for clarity.
export function withAuditContext(companyId: string, userId: string) {
  return basePrisma.$extends({
    query: {
      $allModels: {
        async create({ model, args, query }) {
          const result = await query(args);
          if (AUDITED_MODELS.has(model)) {
            await basePrisma.auditLog.create({
              data: { companyId, userId, tableName: model, recordId: (result as any).id, action: "CREATE", newValues: result as any },
            });
          }
          return result;
        },
        // update/delete follow the same shape
      },
    },
  });
}
```

**Note on the honest tradeoff here**: this requires passing `companyId`/`userId` into the extension per-request (Prisma extensions aren't request-scoped by default in a shared singleton client). The clean way to do this in Next.js is `AsyncLocalStorage` set once per request in a wrapper around `requireSession()`. This is real complexity — **compare it against just fixing the ~20 missing manual calls directly**, which is mechanically simpler (20 one-line additions) even if less "elegant." Given your instruction to avoid unnecessary complexity: **recommend the manual-call fix first** (cheap, done in an afternoon), and revisit the extension-based approach only if a second recurring compliance gap shows up later. Flagging the extension approach here because you asked "how do large companies solve it" — the honest answer for *your current scale* is: manual calls, made consistent, are the pragmatic choice; extensions are the answer once you have enough models that manual discipline visibly fails again.

**Files to change (recommended path)**:
```
src/modules/*/
  └── *.service.ts       # MODIFY — add writeAuditLog to the ~20 services that skip it today
```

**Validation checklist**:
- [ ] Every `create*`/`update*`/`setActiveStatus*` function across all modules calls `writeAuditLog`
- [ ] Spot check: create a Brand, query `audit_logs` table, confirm a row exists
- [ ] `grep -L "writeAuditLog" src/modules/*/​*.service.ts` (files *without* the string) returns nothing unexpected

**Common mistakes**: Auditing so much that the `audit_logs` table becomes a performance/storage problem (e.g., auditing simple lookup reads, not just writes) — only writes need audit rows, never reads.

---

## Phase D — Testing
*(Sprint 3–4, days 12–16. Mandatory for MVP: a baseline is strongly recommended before Phase 4 ships new business logic; not blocking for the current Phase 3 masters demo.)*

### D1. Vitest Setup + First Unit Tests

| | |
|---|---|
| **Priority** | Critical (long-term), Medium (immediate, since Phase 3 is CRUD-heavy/low-risk) |
| **Mandatory for MVP** | Optional for MVP demo; **should exist before Phase 5** (state machines, stock checks — genuinely risky logic) |
| **Difficulty** | Medium |
| **Time estimate** | 2–3 days (setup + ~15–20 initial tests covering the highest-risk existing logic) |
| **Prerequisites** | C1 (repository layer) makes service-level unit tests fast and DB-free; not strictly required to start |
| **Risks** | Writing brittle tests that mock too much (testing the mock, not the logic) — keep unit tests focused on business rules, not Prisma call shapes |

**Why**: Zero regression protection today. `PermissionService`'s self-approval check, `DocumentNumberingService`'s atomic-increment behavior, and `BusinessRuleError`'s status-code mapping are exactly the kind of logic that silently breaks in a refactor with no test to catch it.

**How large companies solve it — comparison**:

| Framework | ESM/Next 16 friction | Speed | Fit here |
|---|---|---|---|
| **Vitest** | None — built for ESM/Vite-era tooling | Fast (native ESM, no transform step for TS) | ✅ Recommended |
| Jest | Real friction with Next.js 15+/ESM, needs `ts-jest`/babel config | Slower | Legacy choice — don't start fresh with it in 2026 |

**Packages**:
```bash
npm install -D vitest @vitest/ui
```

**Files to change**:
```
fashion-erp/
├── vitest.config.ts                                  # NEW
├── package.json                                        # MODIFY (add "test" script)
└── src/
    ├── core/
    │   ├── rbac/PermissionService.test.ts              # NEW
    │   └── numbering/DocumentNumberingService.test.ts  # NEW
    └── core/errors/BusinessRuleError.test.ts            # NEW
```

**Code**:
```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: { environment: "node" },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
```

```json
// package.json — add
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest"
}
```

```ts
// src/core/errors/BusinessRuleError.test.ts — a real, DB-free first test
import { describe, it, expect } from "vitest";
import { BusinessRuleError, toErrorResponse } from "./BusinessRuleError";

describe("BusinessRuleError", () => {
  it("maps DUPLICATE_DOC_NUMBER to HTTP 409", () => {
    const err = new BusinessRuleError("DUPLICATE_DOC_NUMBER", "Code already in use.");
    expect(err.httpStatus).toBe(409);
  });

  it("maps a Zod-shaped error to VALIDATION_ERROR / 400", () => {
    const zodLike = { issues: [{ path: ["code"], message: "Required" }] };
    const { status, body } = toErrorResponse(zodLike);
    expect(status).toBe(400);
    expect((body as any).error.code).toBe("VALIDATION_ERROR");
  });

  it("falls back to a safe generic message for unknown errors", () => {
    const { status, body } = toErrorResponse(new Error("some internal detail"));
    expect(status).toBe(500);
    expect((body as any).error.message).not.toContain("some internal detail");
  });
});
```

**Commands**:
```bash
npm test
```

**Expected output**:
```
 ✓ src/core/errors/BusinessRuleError.test.ts (3)
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

**Validation checklist**:
- [ ] `npm test` runs and passes locally
- [ ] Add `- run: npm test` to `.github/workflows/ci.yml` (Task D2 below)
- [ ] At least: `BusinessRuleError` mapping, `PermissionService` self-approval branch, `DocumentNumberingService`'s two-concurrent-calls-don't-collide behavior are covered

**Common mistakes**: Starting with UI/component tests before core business-logic tests — the highest-value, cheapest-to-write tests in this codebase right now are the pure-logic ones with no React/DOM involved at all.

---

### D2. Wire Tests into CI

| | |
|---|---|
| **Priority** | High |
| **Time estimate** | 15 minutes |
| **Difficulty** | Easy |
| **Prerequisites** | A2, D1 |

**Files to change**: `.github/workflows/ci.yml` — add one line after the lint step:
```yaml
      - name: Test
        run: npm test
```
**Validation**: push a commit that breaks a test on purpose → confirm CI goes red on the "Test" step specifically.

---

## Phase E — Observability & Infrastructure
*(Sprint 4–5, days 17–21. Mandatory for MVP: structured logging recommended now; Sentry and file storage can wait until closer to real deployment.)*

### E1. Structured Logging

| | |
|---|---|
| **Priority** | High |
| **Mandatory for MVP** | Recommended before any real user data flows through the system |
| **Difficulty** | Easy–Medium |
| **Time estimate** | 1 day |
| **Prerequisites** | A2 |
| **Risks** | `pino`'s fastest transport (`pino-pretty`) is dev-only — make sure production uses plain JSON output, not the pretty-printer, or logs won't be machine-parseable |

**How large companies solve it — comparison**:

| Library | Performance | Ecosystem fit | Fit here |
|---|---|---|---|
| **pino** | Fastest (benchmarks consistently ahead of alternatives) | First-class Next.js/Node support | ✅ Recommended |
| winston | Slower, more config surface | Older, still common | Not needed — no feature winston has that this project needs |

**Packages**:
```bash
npm install pino
npm install -D pino-pretty
```

**Files to change**:
```
fashion-erp/
└── src/
    └── core/
        └── logging/
            └── logger.ts          # NEW
```

**Code**:
```ts
// src/core/logging/logger.ts
import pino from "pino";

export const logger = pino({
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  transport:
    process.env.NODE_ENV === "production"
      ? undefined // plain JSON to stdout — captured by your hosting platform
      : { target: "pino-pretty" },
});
```

Use it inside `src/lib/api-route.ts`'s `handleApiError`, replacing the bare `console.error`:
```ts
import { logger } from "@/core/logging/logger";
// ...
logger.error({ err: error }, "Unhandled API error");
```

**Validation checklist**:
- [ ] Dev mode: readable colored log lines
- [ ] Set `NODE_ENV=production` locally, confirm output is single-line JSON
- [ ] An unhandled error in any route produces a log line with a stack trace, not just a silent 500

**Common mistakes**: Logging full request bodies indiscriminately — this system handles customer/financial data; never log raw request bodies containing PII or credentials, log structured, redacted context instead (`{ userId, companyId, route }`, not `{ body: req.body }`).

---

### E2. Observability / Error Tracking (Sentry)

| | |
|---|---|
| **Priority** | Medium-High |
| **Mandatory for MVP** | Optional — genuinely valuable the moment real users touch the system, not before |
| **Difficulty** | Easy |
| **Time estimate** | 4–6 hours |
| **Prerequisites** | E1 (logs and error tracking complement each other — do logging first, it's cheaper and needed regardless) |

**How large companies solve it — comparison**:

| Option | Setup cost | Cost at your scale | Fit here |
|---|---|---|---|
| **Sentry** (`@sentry/nextjs`) | Low — official Next.js integration, wizard-driven setup | Free tier covers small teams | ✅ Recommended now |
| OpenTelemetry + Grafana/Tempo | High — you'd run/manage collectors and storage | Free (self-hosted) but real ops overhead | The right answer once you're actually FAANG-scale, not before |
| Datadog | Low setup, high cost | Expensive at any real volume | Overkill for current stage |

**Packages**:
```bash
npx @sentry/wizard@latest -i nextjs
```
(This wizard modifies `next.config.ts` and adds `sentry.*.config.ts` files automatically — don't hand-write this integration, the wizard keeps it current with Next.js's instrumentation hooks.)

**Validation checklist**:
- [ ] Throw a test error in a route, confirm it appears in the Sentry dashboard within a minute
- [ ] Source maps upload correctly (wizard configures this) so stack traces show real file/line, not minified output

---

### E3. Cloud File Storage

| | |
|---|---|
| **Priority** | Medium |
| **Mandatory for MVP** | No — only matters once `Attachment`/file uploads are actually used by a shipped feature, which hasn't happened yet in Phase 3 |
| **Difficulty** | Medium |
| **Time estimate** | 1–2 days |
| **Prerequisites** | A1 (new env vars needed) |
| **Risks** | Local storage silently loses files on container restart/redeploy — low risk *today* since nothing uses `FileStorage.ts` yet, high risk the day an Attachment feature ships |

**How large companies solve it — comparison**:

| Option | Cost model | Self-hosted friendly? | Fit here |
|---|---|---|---|
| AWS S3 | Pay per GB + egress | No | Fine if you're already AWS-committed |
| **Cloudflare R2** | Pay per GB, **zero egress fees** | No (managed) | ✅ Recommended if going cloud — S3-compatible API, cheapest for a system that serves files back out |
| MinIO | Free, self-hosted | Yes | Best fit if you want to stay fully on-prem (matches your current local-Postgres-on-Windows setup) |

**Recommendation**: Since `FileStorage.ts` already exists as an interface/abstraction (per your own Phase 2 design), this is a same-interface swap, not a redesign — implement whichever backend matches your actual deployment target (ask: will this ERP run on a cloud VM, or stay on-prem in the factory office? That answer decides R2 vs. MinIO, not code quality).

**Files to change**:
```
src/core/file-storage/
├── FileStorage.ts              # unchanged (interface)
├── LocalFileStorage.ts         # existing implementation, kept for dev
└── S3FileStorage.ts            # NEW — used in production via env var switch
```

**Validation checklist**:
- [ ] Upload a file in dev (local storage) — unchanged behavior
- [ ] Set `FILE_STORAGE_DRIVER=s3` + credentials in `.env` — same upload flow now round-trips through R2/S3/MinIO
- [ ] Restart the server mid-test — file uploaded before restart is still retrievable (this is the actual bug being fixed)

---

### F1. API Documentation

| | |
|---|---|
| **Priority** | Medium |
| **Mandatory for MVP** | No |
| **Difficulty** | Medium |
| **Time estimate** | 1–2 days |
| **Prerequisites** | C1 helpful, not required |

**How large companies solve it — comparison**:

| Approach | Duplicate work? | Fit here |
|---|---|---|
| Hand-written OpenAPI YAML | Yes — every schema written twice (Zod + YAML), drifts over time | Avoid |
| **`@asteasolutions/zod-to-openapi`** | No — generates the spec from the Zod schemas you already have | ✅ Recommended — you already validate every route with Zod |
| `next-swagger-doc` (JSDoc-comment based) | Partial — comments can drift from actual Zod validation | Weaker guarantee than generating straight from Zod |

**Packages**:
```bash
npm install @asteasolutions/zod-to-openapi
```

**Validation checklist**:
- [ ] Generated spec includes every `/api/v1/*` route
- [ ] Spec is served at a `/api/docs` route (or generated as a static file in CI) and stays in sync automatically when a Zod schema changes — no second file to remember to update

---

## Roadmap Summary

| Phase | Tasks | Sprint | Mandatory for MVP? |
|---|---|---|---|
| A — Production Foundation | .env.example, CI/CD, security headers | 1 | Yes |
| B — Security Hardening | Rate limiting, RBAC granularity | 1–2 | Yes |
| C — Architecture Foundations | Repository layer, audit logging consistency | 2–3 | Recommended before Phase 5 |
| D — Testing | Vitest setup, CI test gate | 3–4 | Recommended before Phase 5 |
| E — Observability & Infra | Structured logging, Sentry, cloud file storage | 4–5 | Logging: recommended now. Sentry/storage: when real users arrive |
| F — Documentation | OpenAPI generation | 5 | No |

**Total estimated effort**: ~15–20 working days (3–4 weeks) for one senior engineer working full-time on this roadmap alone; longer if interleaved with ongoing Phase 4+ feature work.

---

## GitHub Issues Backlog

| # | Title | Priority | Phase | Estimate |
|---|---|---|---|---|
| 1 | Add `.env.example` | High | A | 15m |
| 2 | Set up GitHub Actions CI (typecheck + lint + build) | Critical | A | 3h |
| 3 | Add security headers to `next.config.ts` | High | A | 1h |
| 4 | Add rate limiting + lockout to login | Critical | B | 6h |
| 5 | Split `masters` RBAC module into `masters_core`/`masters_finance` | High | B | 4h |
| 6 | Introduce repository layer — Customers module (template) | High | C | 4h |
| 7 | Introduce repository layer — remaining 14 modules | High | C | 2d |
| 8 | Audit: add `writeAuditLog` to all remaining masters | Medium | C | 1d |
| 9 | Set up Vitest + write first 10 unit tests | Critical | D | 2d |
| 10 | Wire `npm test` into CI | High | D | 15m |
| 11 | Add structured logging (pino) | High | E | 1d |
| 12 | Integrate Sentry error tracking | Medium | E | 6h |
| 13 | Migrate file storage to S3-compatible backend | Medium | E | 2d |
| 14 | Generate OpenAPI docs from Zod schemas | Medium | F | 2d |

## Milestones

- **M1 — Production Foundation Complete** (Issues 1–3)
- **M2 — Security Hardened** (Issues 4–5)
- **M3 — Architecture Refactored** (Issues 6–8)
- **M4 — Test Coverage Baseline** (Issues 9–10)
- **M5 — Observability & Docs Complete** (Issues 11–14)

## Sprint Planning (1-week sprints)

| Sprint | Focus | Issues |
|---|---|---|
| Sprint 1 | Foundation + start Security | 1, 2, 3, 4 |
| Sprint 2 | Finish Security + start Architecture | 5, 6 |
| Sprint 3 | Architecture | 7, 8 |
| Sprint 4 | Testing | 9, 10 |
| Sprint 5 | Observability + Docs | 11, 12, 13, 14 |

---

## Confirmation Gate

Per your instruction, nothing above has been applied to the codebase yet. **Reply with which phase to start** (I'd recommend Phase A — it's low-risk, fast, and unblocks everything else), and I'll implement only that phase, stop, and wait for you to confirm before moving to the next one.
