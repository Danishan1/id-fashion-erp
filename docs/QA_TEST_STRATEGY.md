# Fashion ERP — Quality Assurance & Testing Strategy

**Document Version:** 1.0.0  
**Repository:** Fashion ERP (Next.js 16 + Prisma 7 + PostgreSQL + Vitest)  
**Author:** Antigravity Testing & Quality Engineering Team  
**Date:** 2026-10-24  

---

## 1. Executive Testing Strategy & Philosophy

Fashion ERP is an enterprise garment manufacturing, retail, inventory, and financial operations system. Due to the high complexity of multi-tenant company isolation, branch permissions, serialized inventory tracking, piece-rate payroll calculations, and strict Indian GST statutory compliance, software quality must be guaranteed through a deterministic, layered testing pyramid.

### Core Testing Tenets:
1. **Safety First (Zero Data Loss):** Never execute destructive database migrations or test mutations against production or shared development databases.
2. **Deterministic Isolation:** Every test must run in total isolation. Unit tests mock external dependencies deterministically. Integration tests operate against disposable databases or dedicated test transaction rollbacks.
3. **No Mocking the Core Math:** Financial, tax (GST), rounding, and unit-of-measure (UOM) conversions must execute using real domain functions (`src/lib/money.ts`, `src/lib/gst.ts`), never mocked arithmetic.
4. **Tenant Isolation by Contract:** Company-scoping (`companyId`) and branch scoping (`branchId`) must be asserted across all repository queries and service invocations.
5. **Strict Test-Driven Development (TDD):** New features and bug fixes follow the Red-Green-Refactor cadence.

---

## 2. Test Taxonomy

```mermaid
flowchart TD
    E2E["End-to-End Workflow Tests (Playwright / Vitest Integration)"]
    INT["Database Integration Tests (Real Disposable PostgreSQL / CRM_IT_DATABASE_URL)"]
    CON["Tenant Isolation & Architecture Contract Tests"]
    UNIT["Domain & Service Unit Tests (Fast, In-Memory Mocks)"]

    E2E --> INT
    INT --> CON
    CON --> UNIT
```

### 2.1 Unit Tests (Vitest)
- **Execution Target:** In-memory, mocked I/O (Prisma Client, BullMQ, AuditLogger, DocumentNumberingService).
- **Execution Speed:** < 100ms per test file.
- **Coverage Focus:**
  - Business rule validations (negative quantities, invalid state transitions, missing required fields).
  - Financial calculations (tax splits, odd-paisa reconciliation, gross/discount/subtotal formulas).
  - Production workflows (job-order stage sequences, rework loops, skill validations).
  - Edge cases (boundary values, null/undefined inputs, empty arrays).

### 2.2 Architecture & Tenant Scoping Contract Tests
- **Execution Target:** AST analysis and schema inspection (`src/modules/__tests__/company-scoping.contract.test.ts`).
- **Coverage Focus:**
  - Verifies that every single business repository method filters explicitly by `companyId`.
  - Ensures multi-tenant data leak vulnerabilities are caught statically before deployment.

### 2.3 Integration Tests (Disposable PostgreSQL)
- **Execution Target:** Dedicated PostgreSQL instance positively verified via environment variable:
  ```bash
  CRM_IT_DATABASE_URL="postgresql://user:pass@localhost:5432/fashion_erp_test"
  ```
- **Safety Protocol:**
  - If `CRM_IT_DATABASE_URL` is unset or points to a non-disposable instance, tests **MUST SKIP** automatically rather than risk falling back to `DATABASE_URL` (development or production database).
  - Tests verify real PostgreSQL constraints, foreign keys, row-level locking (`SELECT ... FOR UPDATE`), transaction rollbacks, and unique indexes.

### 2.4 End-to-End (E2E) & Workflow Tests
- Multi-step business processes:
  - Material Request -> Purchase Order -> Goods Receipt -> Stock Inward.
  - Production Order -> Cutting -> Sewing -> Finishing -> Packing -> Finished Goods Receive -> Dispatch.
  - Attendance Punch -> Geofencing/Biometric Validation -> Daily Regularization -> Monthly Payroll Batch.

---

## 3. Criticality Tiers & Quality Gates

| Tier | Description | Coverage Target | Quality Gate |
|---|---|---|---|
| **P0** | Financial Integrity, Authentication, Tenant Isolation, Core Inventory Balances, Unrecoverable Operations | **100% Path Coverage** | Zero tolerated failures or regressions; mandatory contract tests. |
| **P1** | Core Production, Purchase Orders, Sales Orders, HRMS Attendance, Dispatch | **> 90% Line Coverage** | All functional scenarios tested; concurrent race-conditions tested. |
| **P2** | Configuration Masters, Lookups, Department Trees, Fabric Specs, Product Catalog | **> 80% Coverage** | Unique constraint, hierarchy cycle, and CRUD validation covered. |
| **P3** | Reporting, Export Utilities, Background Housekeeping Workers | **> 70% Coverage** | Filter accuracy, pagination, and empty-state robustness covered. |

---

## 4. TDD & Defect Remediation Protocol (Red-Green-Refactor)

When addressing any reported defect or unimplemented business rule:

1. **Step 1: Write the Failing Test (Red):**
   - Reproduce the exact defect or requirement in a unit or integration test.
   - Assert expected error codes (e.g. `VALIDATION_ERROR`, `INSUFFICIENT_STOCK`, `OVER_PRODUCTION_NOT_ALLOWED`).
   - Run the test and confirm it fails for the right reason.
2. **Step 2: Implement the Minimal Fix (Green):**
   - Modify the domain service or repository with the minimal robust code change required.
   - Run the test suite and confirm it passes cleanly.
3. **Step 3: Refactor & Harden (Refactor):**
   - Clean up code structure, deduplicate helper functions, and ensure zero lint or type errors.
   - Verify that all related regression test suites still pass.

---

## 5. Concurrency & Isolation Engineering

1. **Transaction Wrapping:**
   - All multi-table updates (e.g., Stock Movement + Inventory Transaction + Stock Balance) execute inside Prisma `$transaction` blocks.
2. **Row Locking:**
   - Critical inventory and job-order updates utilize guarded optimistic version checks or row-level locking (`findForGuardedUpdateInTx`) to prevent race conditions during concurrent worker submissions or transfer receipts.
3. **Idempotency Discipline:**
   - Multi-step external interactions (dispatches, payments, receipts) enforce idempotency keys or unique status progression guards.

---

## 6. Continuous Integration & Quality Gates

The Fashion ERP test suite is executed as part of the standard pipeline:

1. **Typecheck Gate:**
   ```bash
   NODE_OPTIONS="--max-old-space-size=6144" npm run typecheck
   ```
   *Requirement:* 0 errors in application source and test files.

2. **Lint Gate:**
   ```bash
   NODE_OPTIONS="--max-old-space-size=6144" npm run lint
   ```
   *Requirement:* 0 errors across `src/`.

3. **Automated Unit & Contract Test Gate:**
   ```bash
   npx vitest run
   ```
   *Requirement:* 100% passing tests (zero unexpected failures).

4. **Integration Gate:**
   ```bash
   CRM_IT_DATABASE_URL="postgresql://..." npx vitest run --testPathPattern=integration
   ```
   *Requirement:* Executed in dedicated containerized CI environments.
