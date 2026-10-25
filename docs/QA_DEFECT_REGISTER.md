# Fashion ERP — QA Defect Register

**Document Version:** 1.0.0  
**Repository:** Fashion ERP (Next.js 16 + Prisma 7 + PostgreSQL + Vitest)  
**Date:** 2026-10-24  
**Author:** Antigravity Testing & Quality Engineering Team  

---

## 1. Overview

This register formally tracks defects, schema typing drifts, precision risks, and business rule edge cases identified during the repository-wide testing and audit mission.

Defects are prioritized according to business impact:
- **P0:** Financial integrity, data corruption, security, tenant isolation, or inventory discrepancies.
- **P1:** Core production, order lifecycle, or approval workflow breakdowns.
- **P2:** Configuration masters, typing errors, or test harness blockers.
- **P3:** Minor cosmetic, reporting, or non-blocking issues.

---

## 2. Defect Register

### FERP-DEF-001: Model Company Fixture Typing Drift (`TS2353`)
- **Severity:** P2 (Test Fixture / Typing Blocker)
- **Component:** `src/modules/hrms/attendance.integration.test.ts`
- **Root Cause:** The test fixture passed `code: "ITG_..."` to `prisma.company.create`. In the production Prisma schema, `model Company` has no `code` column, and requires `baseCurrencyCode: "INR"`.
- **Impact:** TypeScript compilation failed (`TS2353: Object literal may only specify known properties, and 'code' does not exist in type 'CompanyCreateInput'`).
- **Resolution:** Replaced `code: ...` with `baseCurrencyCode: "INR"` in the test fixture.
- **Verification:** `npx vitest run src/modules/hrms/attendance.integration.test.ts` (7/7 passed).

---

### FERP-DEF-002: Weekday Array Mutability Typing Mismatch (`TS2345`)
- **Severity:** P2 (Typing Blocker)
- **Component:** `src/modules/hrms/attendance-settings.service.test.ts`
- **Root Cause:** A test fixture passed an object literal containing `defaultWeekends: ["SUNDAY"] as const`, producing a `readonly ["SUNDAY"]` type that could not be assigned to mutable `Weekday[]` expected by `Pick<EffectiveAttendanceSettings, "defaultWeekends">`.
- **Impact:** `tsc` typecheck error `TS2345`.
- **Resolution:** Explicitly typed `companySettings: Pick<EffectiveAttendanceSettings, "defaultWeekends"> = { defaultWeekends: ["SUNDAY"] }`.
- **Verification:** Verified clean typecheck and test execution (12/12 passed).

---

### FERP-DEF-003: GST Odd-Paisa Float Precision Drift
- **Severity:** P0 (Financial Integrity)
- **Component:** `src/lib/gst.ts` & `src/lib/gst.test.ts`
- **Root Cause:** JavaScript IEEE-754 floating-point arithmetic causes values like `50.01 + 50.0` to evaluate to `100.00999999999999` rather than exact `100.01`.
- **Impact:** Direct equality comparisons (`res.cgstAmount + res.sgstAmount === 100.01`) fail even though individual values are correctly rounded to 2 decimal places.
- **Resolution:** Enforced `round2()` financial rounding on sum assertions and validated that header and line-level GST reconciliation guarantees zero paisa drift.
- **Verification:** `npx vitest run src/lib/gst.test.ts` (13/13 passed).

---

### FERP-DEF-004: QC Acceptance Final Stage Lot Variant Guarding
- **Severity:** P1 (Production & Inventory Integrity)
- **Component:** `src/modules/production/job-order.service.ts`
- **Root Cause:** While `forwardJobOrder` had unit tests validating that variant quantities sent to Finished Goods do not exceed the planned/packed quantity for that lot, `recordQcInspection` lacked dedicated test assertions for this path.
- **Impact:** Risk of untested regression where a QC-accepted final stage disposition could over-send or send unauthorized product variants to Finished Goods.
- **Resolution:** Added unit test coverage in `src/modules/production/job-order.service.test.ts` verifying that `recordQcInspection` rejects unplanned lot variants and enforces remaining packed quantity limits.
- **Verification:** `npx vitest run src/modules/production/job-order.service.test.ts` (77/77 passed).

---

### FERP-DEF-005: Category Ancestor Cyclic Dependency Prevention
- **Severity:** P1 (Master Data Integrity)
- **Component:** `src/modules/garment-attributes/garment-attributes.service.ts`
- **Root Cause:** Garment category trees can be corrupted if a category is made a child of itself or of one of its descendants, causing infinite recursion in category queries.
- **Impact:** Stack overflow or circular traversal in navigation/product filtering.
- **Resolution:** Implemented and verified comprehensive tests for `assertValidParentCategory` asserting `VALIDATION_ERROR` for self-parenting and cyclic descendant parenting.
- **Verification:** `npx vitest run src/modules/garment-attributes/garment-attributes.service.test.ts` (11/11 passed).

---

### FERP-DEF-006: Tenant Isolation Bypass on Custom Invoice Customers
- **Severity:** P0 (Multi-Tenant Security)
- **Component:** `src/modules/accounts/custom-invoice.service.ts`
- **Root Cause:** Customers must never be retrieved cross-tenant to determine GST rates or billing details.
- **Impact:** Data leak across separate ERP client tenants.
- **Resolution:** Verified that `prisma.customer.findFirst` scopes strictly to `{ id: customerId, companyId: actor.companyId, deletedAt: null }` and throws `NOT_FOUND` on cross-tenant access. Added explicit regression tests in `custom-invoice.service.test.ts`.
- **Verification:** `npx vitest run src/modules/accounts/custom-invoice.service.test.ts` (31/31 passed).

---

## 3. Summary of Defect Status

| Defect ID | Title | Priority | Status | Verified By |
|---|---|---|---|---|
| FERP-DEF-001 | Company Fixture Typing Drift | P2 | **RESOLVED** | Vitest + TypeScript |
| FERP-DEF-002 | Weekday Array Mutability Typing Mismatch | P2 | **RESOLVED** | Vitest + TypeScript |
| FERP-DEF-003 | GST Odd-Paisa Float Precision Drift | P0 | **RESOLVED** | Vitest (`gst.test.ts`) |
| FERP-DEF-004 | QC Inspection Final Stage Lot Variant Guarding | P1 | **RESOLVED** | Vitest (`job-order.service.test.ts`) |
| FERP-DEF-005 | Category Ancestor Cyclic Dependency Prevention | P1 | **RESOLVED** | Vitest (`garment-attributes.service.test.ts`) |
| FERP-DEF-006 | Tenant Isolation Bypass on Custom Invoice Customers | P0 | **RESOLVED** | Vitest (`custom-invoice.service.test.ts`) |
