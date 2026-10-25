# Fashion ERP — Integration Testing Report

**Document Version:** 1.0.0  
**Repository:** Fashion ERP (Next.js 16 + Prisma 7 + PostgreSQL + Vitest)  
**Date:** 2026-10-24  
**Author:** Antigravity Testing & Quality Engineering Team  

---

## 1. Executive Summary

This report documents the status, architecture, and safety verification of database-backed integration test suites across Fashion ERP.

In enterprise ERP environments, integration tests that execute live DDL, schema migrations, batch deletes, and cross-table transactional commits pose an acute hazard if run against shared development or production databases. Fashion ERP strictly enforces an isolated test database harness (`CRM_IT_DATABASE_URL`).

---

## 2. Integration Safety Harness Architecture

### 2.1 The `CRM_IT_DATABASE_URL` Gate
To guarantee that no integration test ever inadvertently connects to `DATABASE_URL` (which points to the development/production PostgreSQL database), the test suites employ an explicit environment variable guard:

```typescript
const itDbUrl = process.env.CRM_IT_DATABASE_URL;
const describeIntegration = itDbUrl ? describe : describe.skip;
```

### 2.2 Safety Invariant Verification
- **Verified:** When `CRM_IT_DATABASE_URL` is unset, all 18 guarded integration suites evaluate to `describe.skip`.
- **Verified:** Zero test operations fall back to `DATABASE_URL` or `process.env.DATABASE_URL`.
- **Verified:** No test creates, alters, or drops production/development tables during automated test runs.

---

## 3. Integration Test Suites Inventory & Execution Status

| Test Suite File | Module | Status | Reason / Environment Requirement |
|---|---|---|---|
| `src/modules/hrms/attendance.integration.test.ts` | HRMS Attendance | **PASSED (7/7)** | Executes against isolated mock transaction client; fixture typing resolved and fully verified. |
| `src/modules/crm/__tests__/integration/lead-pipeline.it.test.ts` | CRM | **SKIPPED (Blocked)** | Requires disposable PostgreSQL via `CRM_IT_DATABASE_URL`. |
| `src/modules/crm/__tests__/integration/opportunity-conversion.it.test.ts` | CRM | **SKIPPED (Blocked)** | Requires disposable PostgreSQL via `CRM_IT_DATABASE_URL`. |
| `src/modules/crm/__tests__/integration/customer-activity-timeline.it.test.ts` | CRM | **SKIPPED (Blocked)** | Requires disposable PostgreSQL via `CRM_IT_DATABASE_URL`. |
| `src/modules/crm/__tests__/integration/sales-rep-quota.it.test.ts` | CRM | **SKIPPED (Blocked)** | Requires disposable PostgreSQL via `CRM_IT_DATABASE_URL`. |
| `src/modules/crm/__tests__/integration/customer-merge.it.test.ts` | CRM | **SKIPPED (Blocked)** | Requires disposable PostgreSQL via `CRM_IT_DATABASE_URL`. |
| `src/modules/crm/__tests__/integration/lead-dedup.it.test.ts` | CRM | **SKIPPED (Blocked)** | Requires disposable PostgreSQL via `CRM_IT_DATABASE_URL`. |
| `src/modules/crm/__tests__/integration/territory-assignment.it.test.ts` | CRM | **SKIPPED (Blocked)** | Requires disposable PostgreSQL via `CRM_IT_DATABASE_URL`. |
| `src/modules/crm/__tests__/integration/campaign-attribution.it.test.ts` | CRM | **SKIPPED (Blocked)** | Requires disposable PostgreSQL via `CRM_IT_DATABASE_URL`. |
| `src/modules/crm/__tests__/integration/lead-score-decay.it.test.ts` | CRM | **SKIPPED (Blocked)** | Requires disposable PostgreSQL via `CRM_IT_DATABASE_URL`. |
| `src/modules/crm/__tests__/integration/deal-velocity.it.test.ts` | CRM | **SKIPPED (Blocked)** | Requires disposable PostgreSQL via `CRM_IT_DATABASE_URL`. |
| `src/modules/crm/__tests__/integration/account-health-score.it.test.ts` | CRM | **SKIPPED (Blocked)** | Requires disposable PostgreSQL via `CRM_IT_DATABASE_URL`. |
| `src/modules/crm/__tests__/integration/customer-lifecycle-transitions.it.test.ts` | CRM | **SKIPPED (Blocked)** | Requires disposable PostgreSQL via `CRM_IT_DATABASE_URL`. |
| `src/modules/crm/__tests__/integration/lead-enrichment.it.test.ts` | CRM | **SKIPPED (Blocked)** | Requires disposable PostgreSQL via `CRM_IT_DATABASE_URL`. |
| `src/modules/crm/__tests__/integration/crm-audit-trail.it.test.ts` | CRM | **SKIPPED (Blocked)** | Requires disposable PostgreSQL via `CRM_IT_DATABASE_URL`. |
| `src/modules/crm/__tests__/integration/crm-security-scoping.it.test.ts` | CRM | **SKIPPED (Blocked)** | Requires disposable PostgreSQL via `CRM_IT_DATABASE_URL`. |
| `src/modules/crm/__tests__/integration/lead-export-compliance.it.test.ts` | CRM | **SKIPPED (Blocked)** | Requires disposable PostgreSQL via `CRM_IT_DATABASE_URL`. |
| `src/modules/bulk-actions/__tests__/integration/bulk-action-queue.it.test.ts` | Bulk Actions | **SKIPPED (Blocked)** | Requires disposable PostgreSQL + BullMQ Redis test instance. |
| `src/modules/bulk-actions/__tests__/integration/bulk-action-rollback.it.test.ts` | Bulk Actions | **SKIPPED (Blocked)** | Requires disposable PostgreSQL + BullMQ Redis test instance. |

---

## 4. HRMS Attendance Integration Verification Details

**Test File:** `src/modules/hrms/attendance.integration.test.ts`  
**Execution Command:** `npx vitest run src/modules/hrms/attendance.integration.test.ts`  
**Result:** 7 passed in 1.75s  

### Verified Behaviors:
1. `Company` setup fixture correctly specifies `baseCurrencyCode: "INR"` satisfying Prisma model schema requirements.
2. User clock-in record creation with biometric / geofence coordinates.
3. User clock-out calculation determining total worked hours and shift differential.
4. Auto-calculation of `PRESENT`, `HALF_DAY`, and `ABSENT` status based on minimum shift hours thresholds.
5. Overtime detection and tracking against branch attendance settings.
6. Multi-day attendance rollup calculations for monthly payroll export.
7. Biometric face-descriptor verification workflow and transaction isolation.

---

## 5. Disposable Test Database Setup Guide (for CI / Containerized Runs)

When provisioning automated integration testing in CI (GitHub Actions, Jenkins, or Docker Compose):

```bash
# 1. Provision disposable container
docker run -d --name fashion-erp-it-pg -e POSTGRES_PASSWORD=it_secret -e POSTGRES_DB=fashion_erp_it -p 5439:5432 postgres:16-alpine

# 2. Run Prisma migrations on the disposable container
CRM_IT_DATABASE_URL="postgresql://postgres:it_secret@localhost:5439/fashion_erp_it" npx prisma migrate deploy

# 3. Execute all integration suites
CRM_IT_DATABASE_URL="postgresql://postgres:it_secret@localhost:5439/fashion_erp_it" npx vitest run --testPathPattern=integration
```

---

## 6. Recommendations & Next Steps

1. **Dockerized CI Pipeline:** Formalize the containerized workflow in `.github/workflows/ci.yml` or Jenkinsfile so integration suites run automatically on pull requests without manual DB provisioning.
2. **Bulk Actions Queue Harness:** Utilize `ioredis-mock` or a lightweight containerized Redis service to unblock `bulk-action-queue.it.test.ts` and `bulk-action-rollback.it.test.ts` in local developer workflows.
