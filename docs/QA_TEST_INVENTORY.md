# Fashion ERP — Complete Application & QA Test Inventory (Phase 1)

**Date:** 2026-10-24  
**Auditor / Agent:** Antigravity Autonomous QA Engineer  
**Scope:** Complete Fashion ERP Application Repository  

---

## 1. Executive Summary & Inventory Totals

Every metric below was directly derived by inspecting the live codebase as of commit `eb2a820`:

| Metric | Measured Count | Description |
| :--- | :--- | :--- |
| **Business Modules** | **45** | Domain-driven business modules located in `src/modules/*` |
| **Prisma Database Models** | **322** | Relational models defined in `prisma/schema.prisma` |
| **Prisma Enums** | **197** | Domain enum definitions in `prisma/schema.prisma` |
| **API Route Endpoints** | **965** | Next.js API route handlers in `src/app/api/**/route.ts` |
| **Frontend UI Pages** | **212** | Interactive App Router dashboard views in `src/app/(dashboard)/**/page.tsx` |
| **Core Infrastructure Files** | **187** | Shared engines, RBAC, tenant isolation, auditing, AI in `src/core/*` |
| **Core Test Files** | **33** | Unit and contract tests specifically covering `src/core/*` |
| **Total Test Files** | **267** | Verified unit, integration, contract, and component test files (+6 new master suites) |
| **Total Automated Tests** | **3,800** | Total individual tests registered in Vitest runner (+60 tests added) |
| **Passing Tests** | **3,589** | Actively executed and passing tests in baseline |
| **Skipped Tests** | **211** | Integration tests awaiting disposable test DB (`CRM_IT_DATABASE_URL`) |

---

## 2. Criticality Classification Framework

The application is classified across four priority tiers:

- **P0 (Critical / Foundation):** Financial integrity, double-entry ledgers, authentication, RBAC authorization, multi-tenant company isolation, stock balance integrity, and irreversible database state operations.
- **P1 (Core Operations):** End-to-end production pipeline, cutting/stitching/packing stages, material requests & roll allocations, sales orders, purchase orders, finished goods receipts, dispatch cartons, HRMS attendance & leaves, piece-rate earnings, and CRM lead lifecycles.
- **P2 (Management & Masters):** Master lookups (Colors, Sizes, Units, Attributes), warehouses, supplier & customer directories, cost masters, report generators, configuration tables, and analytics dashboards.
- **P3 (Supporting & UI):** Formatting helpers, date/money utilities, export/import UI components, modal dialogs, global search helpers, and support ticket tools.

---

## 3. Module-by-Module Comprehensive Inventory

| Module Name | Tier | Total Files | Services | Repos | Schemas | Unit Tests | Int Tests | Coverage Status | Critical Business Invariants & Responsibility |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **`core/auth` & `rbac`** | **P0** | 42 | — | — | 3 | 18 | 0 | **High** | Multi-tenant company isolation, JWT session validation, role-permission assertions (`PermissionService`), branch-scoping, and team hierarchy enforcement. |
| **`accounts`** | **P0** | 60 | 14 | 13 | 13 | 17 | 0 | **High** | Sales invoices, GST/TDS calculations, debit/credit notes, payments, voucher entries, and tax configurations. |
| **`inventory`** | **P0** | 18 | 5 | 4 | 3 | 6 | 0 | **High** | Stock movements, warehouse stock balances, fabric roll allocations, material issues, substitutions, and write-offs. |
| **`finished-goods-inventory`**| **P0** | 30 | 10 | 8 | 2 | 10 | 0 | **High** | Finished goods receipts, putaway to warehouse bins, style variant stock reconciliation, and carton reservation. |
| **`platform`** | **P0** | 25 | 10 | 0 | 4 | 9 | 0 | **High** | Multi-tenant SaaS company onboarding, subscription plans, module entitlements, coupon validations, and health monitoring. |
| **`production`** | **P1** | 36 | 15 | 2 | 2 | 14 | 0 | **High** | Production orders, lot genealogy (split/merge), job orders, multi-stage completion, piece-rate earnings, and QC defect dispositions. |
| **`sales-orders`** | **P1** | 10 | 3 | 2 | 2 | 3 | 0 | **High** | Sales orders, size/color variant breakdowns, planned deliveries, customer BOMs, and component overrides. |
| **`purchasing`** | **P1** | 9 | 2 | 3 | 2 | 2 | 0 | **High** | Purchase orders, vendor confirmations, goods receipt notes (GRN), and fabric roll inspection against PO lines. |
| **`dispatch`** | **P1** | 6 | 2 | 1 | 1 | 2 | 0 | **High** | Carton packing lists, barcodes, dispatch notes, gate passes, and inventory reduction upon shipment. |
| **`hrms`** | **P1** | 40 | 12 | 3 | 4 | 14 | 1 | **High** | Geofenced attendance punches, face verification, outdoor regularization, leave sandwich rules, and salary sheet aggregation. |
| **`employees`** | **P1** | 6 | 2 | 1 | 1 | 2 | 0 | **High** | Employee records, department/designation links, manager-supervisor hierarchy, and work skill qualifications. |
| **`contractors`** | **P1** | 4 | 1 | 1 | 1 | 1 | 0 | **Medium** | Job-work contractor directory, active contractor status, and GSTIN/TDS mappings. |
| **`crm`** | **P1** | 185 | 37 | 18 | 18 | 26 | 16 | **High (Unit)** / **Pending (IT)** | Leads, contacts, accounts, opportunities, sales pipelines, activities, appointments, and outgoing webhooks. |
| **`ai-garment-flow`** | **P1** | 69 | 17 | 16 | 16 | 17 | 0 | **High** | Style reference analysis, AI fabric briefs, visual generations, tech pack creation, and commercial cost feasibility. |
| **`bom-mrp`** | **P1** | 8 | 3 | 1 | 1 | 3 | 0 | **High** | Bill of Materials explosive calculations, material requirements planning (MRP), and shortage detection. |
| **`bulk-actions`** | **P1** | 13 | 1 | 0 | 1 | 1 | 2 | **High** | Async batch execution for CRM/leads, failure recovery, idempotent submission, and lease renewal. |
| **`returns`** | **P1** | 2 | 1 | 0 | 0 | 1 | 0 | **Medium** | Customer returns, return authorization, inspection, and credit note issuance. |
| **`sampling`** | **P1** | 4 | 1 | 1 | 1 | 1 | 0 | **Medium** | Sampling requests, sample job orders, revisions, and customer sample approvals. |
| **`lookups`** | **P2** | 4 | 1 | 1 | 1 | 1 | 0 | **High** | Master lookup tables: Colors, Sizes, Units with case-insensitive uniqueness per company. |
| **`products`** | **P2** | 4 | 1 | 1 | 1 | 1 | 0 | **Medium** | Master style catalog, product categories, SKU coding, and active/inactive status. |
| **`product-units`** | **P2** | 2 | 1 | 0 | 0 | 1 | 0 | **Medium** | Unit conversion ratios and base UOM configurations. |
| **`customers`** | **P2** | 7 | 3 | 1 | 1 | 2 | 0 | **Medium** | B2B customer directory, credit limits, payment terms, and billing/shipping addresses. |
| **`suppliers`** | **P2** | 7 | 2 | 2 | 1 | 2 | 0 | **Medium** | Supplier directory, approved material lists, supplier pricing agreements, and bank details. |
| **`warehouses`** | **P2** | 4 | 1 | 1 | 1 | 1 | 0 | **Medium** | Warehouses, storage zones, bins, and branch ownership. |
| **`buyer-enquiries`** | **P2** | 4 | 1 | 1 | 1 | 1 | 0 | **Medium** | Pre-order buyer RFQs, quotation generation, and tech-pack attachments. |
| **`marketing`** | **P2** | 10 | 2 | 2 | 2 | 2 | 0 | **Medium** | Meta Ads and Google Ads OAuth connections, campaign analytics ingestion. |
| **`administration`** | **P2** | 21 | 7 | 5 | 5 | 3 | 0 | **High** | Tenant user creation, role assignment, branch restriction configuration, and audit log inspection. |
| **`dashboard`** | **P2** | 2 | 1 | 0 | 0 | 1 | 0 | **Medium** | Executive analytics, department KPI aggregation, and operational metrics. |
| **`stage-costs`** | **P2** | 4 | 1 | 0 | 1 | 2 | 0 | **Medium** | Standard stage cost masters for cutting, stitching, washing, packing, and finishing. |
| **`import`** | **P2** | 6 | 2 | 1 | 1 | 2 | 0 | **High** | Excel bulk data imports with row validation, error mapping, and transaction rollback. |
| **`departments`** | **P2** | 4 | 1 | 1 | 1 | **7** | 0 | **High** | Organizational department masters, search, pagination, duplicate code validation, and tenant isolation. |
| **`cost-master`** | **P2** | 4 | 1 | 1 | 1 | **5** | 0 | **High** | Overhead cost centers, type classification, rate updates, and tenant-scoped duplicate code guard. |
| **`fabric-config`** | **P2** | 4 | 1 | 1 | 1 | **12** | 0 | **High** | Fabric GSM, WeaveType, Width (with unit validation), Composition, DyeType, and Dye operations. |
| **`finance-config`** | **P2** | 4 | 1 | 1 | 1 | **10** | 0 | **High** | Payment types (CASH, BANK, UPI), Bank accounts, duplicate code rejections, and tenant isolation. |
| **`garment-attributes`**| **P2** | 4 | 1 | 1 | 1 | **11** | 0 | **High** | Generic attribute factories (Brands, Seasons, Fittings) and Category hierarchy cycle prevention. |
| **`hr-config`** | **P2** | 4 | 1 | 1 | 1 | 1 | 0 | **Medium** | Leave types, holiday calendars, shift definitions, and attendance rule profiles. |
| **`production-config`**| **P2** | 4 | 1 | 1 | 1 | **7** | 0 | **High** | Production stage sequences, rework flags, extra quantity allowances, lines, and machine masters. |
| **`reports`** | **P2** | 47 | 0 | 0 | 0 | **0** | 0 | **Gap (0 Tests)** | 47 enterprise reporting queries and data aggregations. |
| **`ai-designer`** | **P2** | 16 | 6 | 2 | 4 | 4 | 0 | **High** | AI design studio, replicate design, tech pack master generation, and export formats. |
| **`ai-providers`** | **P2** | 3 | 1 | 0 | 1 | 1 | 0 | **Medium** | AI provider abstraction (OpenAI, Anthropic, Google Gemini) and fallback switching. |
| **`account`** | **P3** | 3 | 1 | 0 | 1 | 1 | 0 | **Low** | User profile self-service, password change, and notification preferences. |
| **`forwarders`** | **P3** | 4 | 1 | 1 | 1 | 1 | 0 | **Low** | Freight forwarder directory and tracking numbers. |
| **`search`** | **P3** | 2 | 1 | 0 | 0 | 1 | 0 | **Low** | Global quick-search indexing across orders, customers, and styles. |
| **`support-access`** | **P3** | 4 | 1 | 0 | 1 | 1 | 0 | **Medium** | Super-admin emergency tenant support sessions with scoped time-to-live. |
| **`support-tickets`**| **P3** | 4 | 1 | 0 | 1 | 1 | 0 | **Low** | In-app support ticketing, attachments, and resolution status. |

---

## 4. Background Workers & Queues Inventory

Background processing in Fashion ERP uses BullMQ backed by Redis (`REDIS_URL`):

| Worker File | Queue Name | Criticality | Responsibility & Failure Recovery |
| :--- | :--- | :---: | :--- |
| `src/core/jobs/worker.ts` | Super-Process | **P1** | Parent runner spawning all BullMQ workers. |
| `bulk-import.worker.ts` | `bulk-import-{companyId}` | **P1** | Asynchronous CSV/Excel master data imports with atomic rollback on validation thresholds. |
| `crm-lead-ingest.worker.ts` | `crm-lead-ingest-{companyId}` | **P1** | Ingestion of incoming webhook leads (Meta, Google, website forms) with duplicate contact deduplication. |
| `bulk-action.worker.ts` | `bulk-actions-{companyId}` | **P1** | Batch CRM updates, bulk email/SMS dispatches with lease renewals and crash recovery. |
| `platform-jobs.worker.ts` | `platform-jobs-{companyId}` | **P0** | SaaS subscription renewal checks, payment reconciliation, and trial expiration actions. |
| `attendance-jobs.worker.ts`| `hrms-attendance-{companyId}`| **P1** | Midnight auto-checkout, daily absence mark, monthly leave balance accrual, and sandwich deductions. |

---

## 5. Security, Tenant Isolation & Authorization Architecture

1. **Company Scoping (Tenant Isolation):**
   - Every tenant table has a mandatory `company_id` foreign key.
   - Verified by contract test [`company-scoping.contract.test.ts`](file:///d:/office-data/claude-projects/fashion-erp/src/modules/__tests__/company-scoping.contract.test.ts).
   - Direct database access is filtered by `companyId` in every repository query.
2. **Branch Scoping:**
   - Multi-branch organizations use `branch_id`.
   - Users with restricted branch assignments get `NOT_FOUND` (deny as not-found) for out-of-branch records.
3. **Role-Based Access Control (RBAC):**
   - Granular permission matrix (`module.action`) evaluated by [`PermissionService`](file:///d:/office-data/claude-projects/fashion-erp/src/core/rbac/PermissionService.ts).
   - Super Admin vs Company Admin vs Supervisor vs Operator permissions.
4. **Team / Employee Hierarchy:**
   - Evaluated by [`team-scope.ts`](file:///d:/office-data/claude-projects/fashion-erp/src/core/hierarchy/team-scope.ts).
   - Supervisors can view/approve work for direct and nested reporting lines; workers can only view their own assigned job orders.

---

## 6. Coverage Gaps & Implementation Status

1. **Uncovered Configuration Masters (P2) — COMPLETED:**
   - `src/modules/cost-master`: 5 unit tests added ([`cost-master.service.test.ts`](file:///d:/office-data/claude-projects/fashion-erp/src/modules/cost-master/cost-master.service.test.ts))
   - `src/modules/departments`: 7 unit tests added ([`department.service.test.ts`](file:///d:/office-data/claude-projects/fashion-erp/src/modules/departments/department.service.test.ts))
   - `src/modules/fabric-config`: 12 unit tests added ([`fabric-config.service.test.ts`](file:///d:/office-data/claude-projects/fashion-erp/src/modules/fabric-config/fabric-config.service.test.ts))
   - `src/modules/finance-config`: 10 unit tests added ([`finance-config.service.test.ts`](file:///d:/office-data/claude-projects/fashion-erp/src/modules/finance-config/finance-config.service.test.ts))
   - `src/modules/garment-attributes`: 11 unit tests added ([`garment-attributes.service.test.ts`](file:///d:/office-data/claude-projects/fashion-erp/src/modules/garment-attributes/garment-attributes.service.test.ts))
   - `src/modules/production-config`: 7 unit tests added ([`production-config.service.test.ts`](file:///d:/office-data/claude-projects/fashion-erp/src/modules/production-config/production-config.service.test.ts))
2. **HRMS Integration Test Schema Drift (P1) — RESOLVED:**
   - [`attendance.integration.test.ts`](file:///d:/office-data/claude-projects/fashion-erp/src/modules/hrms/attendance.integration.test.ts): Replaced invalid `code` with required `baseCurrencyCode: "INR"` in company fixture.
   - [`attendance-settings.service.test.ts`](file:///d:/office-data/claude-projects/fashion-erp/src/modules/hrms/attendance-settings.service.test.ts): Typed `companySettings: Pick<EffectiveAttendanceSettings, "defaultWeekends">`.
3. **P0 Financial Integrity Tests (P0) — EXPANDED:**
   - [`tax-config.service.test.ts`](file:///d:/office-data/claude-projects/fashion-erp/src/modules/accounts/tax-config.service.test.ts): Expanded from 3 to 13 tests covering open-ended/closed date overlap ranges, `effectiveTo <= effectiveFrom` rejections, and tenant isolation.
4. **Remaining Next Priorities:**
   - P0/P1 End-to-end integration workflows on disposable DB.
   - Enterprise report queries (47 reports).
