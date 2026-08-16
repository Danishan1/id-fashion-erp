# Fashion ERP — Garment Manufacturing ERP System

This file is the living architecture and roadmap for this project. It is read automatically by Claude Code at the start of every session in this directory — keep it current as phases complete.

**Repo**: https://github.com/TeamsIndradhar/fashion-erp.git

## Domain Reference — Lessons from the User's Existing Systems

The user has two real, manually-coded PHP/Laravel garment systems already in production use: an **Inventory** app and **Royal Jeans** (a denim manufacturing/production system). Both were analyzed for domain patterns worth carrying into this build (not code — different stack). Apply these when building the relevant phase below; don't retrofit them into Phases 1–3 unless noted.

**Vocabulary to match** (real factory usage, prefer over generic textbook terms): **Lot No.** (not "batch"), **Slip** / Production Slip (the physical/digital work-order ticket that moves a lot between stages, often with a scanned/QR file and a per-stage SLA deadline), **Set** (a size-assortment order unit, e.g. an S/M/L bundle sold as one line — not just flat qty), **Godam** (finished-goods store/warehouse — real term, offer as a label option), **Roll** / Roll No. (fabric issued and tracked by physical roll with QR + meterage, not just a generic "material requirement" line), **Stage** / **Sub-stage** (not "process"/"operation").

**Adopt for Phase 5 (Production):**
- A `production_stages` lookup table + generic stage-transition ledger (uniform `from_stage → to_stage`, `lot_no`, `quantity`, `remaining_quantity`, `processed_by`, timestamp, size-split detail rows) *alongside* the existing explicit `cutting_plans`/`sewing_production`/`finishing_records` tables — gives audit-trail flexibility (reordering/inserting stages like embroidery or printing) without new migrations, while keeping the explicit tables for query ergonomics.
- Roll-level fabric issuance to cutting: `fabric_rolls`/`stock_expends`-style tables (roll number, meterage, QR code, batch no., remaining qty per roll) rather than a generic BOM line — ties consumption to physical rolls.
- Per-lot planned-vs-actual timestamp per stage (one row per stage, not a wide fixed-column table — the reference app's `stage_id_1..12` columns are a hardcoded anti-pattern to avoid) feeding an `isDelayed` flag and an order/lot tracking report with a "not yet allocated to a lot" bucket.
- Consider per-line/station login for shop-floor kiosks (not just per-user role auth) if floor-level data entry is in scope.
- Confirmed gap in both reference systems: **no QC/defect/rework tracking exists in either** (grep-confirmed absent in Royal Jeans) and **no SAM/efficiency-% calculation exists**. Our `qc_inspections`/`qc_defects` design and any efficiency reporting are net-new capability, not something to match against existing vocabulary — expect to invent this UX from scratch.

**Adopt for Phase 6 (Inventory):**
- Keep the denormalized `stock_balances` cache in sync with the ledger in the *same transaction* as each `inventory_transactions` insert (confirmed pattern in the reference Inventory app, just done there without a true ledger backing it — we already do this correctly, keep it).
- A real `reorder_level` field per item/variant — the reference app hardcodes a magic "stock < 10" threshold everywhere; make sure ours is a configurable column from the start.
- Per-line `received_quantity` accumulator on `purchase_order_items` with a "cannot over-receive" guard, supporting partial/multi-shipment receipt against one PO, auto-flipping the PO to received only once every line is fully received. **Adopt as-is** — clean, battle-tested pattern.
- A goods-receipt **returns** workflow (`goods_receipt_returns`-style): scoped to a specific receipt (not the PO), running "already-returned" cap per line, reversing ledger entry on return, receipt auto-marked returned once every line is fully reversed. We don't have this as a first-class flow yet — add it.
- BOM-driven multi-material consumption **at order completion** (not at dispatch): loop each BOM line, compute `neededQty = bomQty × orderQty`, hard-block with "insufficient stock" if `available < neededQty`, inside the same DB transaction — plus a live "material requirements preview" endpoint used before completing an order. This is the standout garment-specific pattern from the reference app; maps onto our `material_requirements` + `bom_items`.
- Never do manual stock arithmetic on edit/delete (the reference app's biggest flaw: increments/decrements `current_stock` directly and deletes+recreates ledger rows on edits, which is fragile under a crash mid-edit). Always insert compensating/reversing ledger entries instead — this validates our existing `inventory_transactions`-as-source-of-truth design; do not weaken it.

**Adopt for Phase 8 (Dispatch):**
- Carton→box→item packing hierarchy with a barcode per carton, feeding a dispatch record — more realistic than a single "finished goods stock" bucket. Maps onto our `cartons`/`carton_items`, consider adding a `packing_boxes` intermediate level if cartons are sub-divided.
- Rack-level location tracking specifically for **packed** finished goods (distinct from raw-material warehouse locations) — consider extending `warehouse_locations` usage to packed-carton racking explicitly.

**Explicitly rejected patterns** (real limitations observed in the reference systems, do not replicate): no warehouse/location concept at all in the Inventory app (single global stock number per item); no UOM conversion (flat unit labels only, no purchase-unit vs stock-unit distinction); EAV-style color/size "attributes" that are purely descriptive tags with no per-variant stock (our `product_variants` + variant-level stock is strictly better); hardcoded stage-count wide tables.

## Status

| Phase | Name | Status |
|---|---|---|
| 1 | Architecture (this document) | ✅ Done |
| 2 | Foundation | ✅ Done |
| 3 | Masters | ✅ Done |
| 4 | Sampling | ⬜ Not started |
| 5 | Orders + Production | ⬜ Not started |
| 6 | Inventory | ⬜ Not started |
| 7 | Accounts | ⬜ Not started |
| 8 | Dispatch | ⬜ Not started |
| 9 | Reports | ⬜ Not started |
| 10 | Testing | ⬜ Not started |
| 11 | Hardening | ⬜ Not started |

Update the status column and add a short dated note under the relevant phase section below whenever a phase completes or deviates from plan.

### Phase 2 notes (2026-08-16)
- Next.js 16 scaffold, Prisma 7 schema (Organization/Auth + Masters + System, 24 models), NextAuth v5 Credentials auth (JWT sessions), RBAC `PermissionService`, document numbering, audit logging, local file storage, `BusinessRuleError`, sidebar/topbar shell, login page, DB-backed dashboard placeholder, and full seed data (roles/permissions/Super Admin) are all in place and verified end-to-end in the browser (login → dashboard showing real DB counts).
- Prisma 7 deviation from the original plan: `datasource.url` in `schema.prisma` is no longer supported — connection config now lives in `prisma.config.ts`, and `PrismaClient` is instantiated with a `@prisma/adapter-pg` driver adapter (see `src/core/db/client.ts`). Keep this in mind for any future Prisma schema changes.
- Middleware must live at `src/middleware.ts` (not project root) when using a `src/` directory — Next.js silently ignores it otherwise. Auth config is split into an edge-safe `auth.config.ts` (no providers, used by middleware) and the full `auth.ts` (Credentials provider + Prisma, used in route handlers/server components), since Credentials + Prisma can't run in the Edge runtime.
- Dev environment: Node.js LTS and PostgreSQL 16 installed locally via winget. Local dev DB: `fashion_erp`, connected as the `postgres` role (see `.env`, not committed). Seeded Super Admin login: `admin@indradhar.com` / `ChangeMe123!` — change immediately outside of dev.

### Phase 3 notes (2026-08-16)
- Full CRUD built and verified end-to-end in the browser for all Masters entities: Customers (with nested Buyers), Suppliers, Employees + Departments, Colors/Sizes/Units (combined tabbed "Lookups" page), Warehouses (with nested Locations), and Products/Styles (with Color×Size Variant generation).
- Shared infrastructure added for reuse by every future module: `src/lib/list-query.ts` (pagination/search/sort parsing), `src/lib/api-route.ts` (`requireSession`/`handleApiError`), `src/components/ui/DataTable.tsx` (paginated searchable table), `src/components/ui/SimpleLookupManager.tsx` (inline add/edit for small lookup tables), `src/components/ui/FormField.tsx`. `BusinessRuleError`'s `toErrorResponse` now also maps Zod validation errors to the structured `VALIDATION_ERROR` response.
- Deliberate scope simplification: Buyers, Warehouse Locations, and Product Variants are managed inline on their parent's detail page rather than as separate full CRUD stacks (they're genuinely child records of Customer/Warehouse/Product). Departments/Colors/Sizes/Units use the single-page `SimpleLookupManager` (list + inline add/edit) rather than separate list/new/[id] routes, since they're small, low-churn lookup tables — this is a UI-density choice, not reduced functionality; every one of these supports real create/edit backed by the database.
- Deviated from the strict schema/service/**repository** three-layer convention stated in Phase 1 for these simple-CRUD masters: services call Prisma directly (no pass-through repository file) since there's no business logic to separate out at this level. Revisit the repository layer when a module has real query complexity worth isolating (e.g. Inventory's stock ledger, Accounts' journal engine).
- tsconfig: added `allowImportingTsExtensions: true` (harmless since `noEmit` is already true) so `prisma/seed.ts` can import `../src/config/rbac.ts` with an explicit extension — required because `node --experimental-strip-types` uses strict Node ESM resolution.

### Phase 3 extension — masters completed against reference systems (2026-08-16)
After analyzing the user's two existing systems (see Domain Reference section above), added the master data entities they revealed as gaps:
- **Raw Materials** (`/masters/materials`) — reuses the `products` table via a new `itemType` enum (`STYLE` | `RAW_MATERIAL`) rather than a parallel table, so BOM lines can FK to one `products` table regardless of item type (matches the Phase 1 BOM design intent). Adds `materialCategory` (fabric/trims/accessories/packaging/other), `defaultSupplierId`, `reorderLevel`, `unitCost`. `listProducts`/`getProductById` (Styles) now explicitly filter `itemType: STYLE`; `listMaterials`/`getMaterialById` filter `itemType: RAW_MATERIAL` — same table, disjoint views. Style and material item codes share one `(companyId, styleCode)` uniqueness constraint (one namespace), which is intentional.
- **Production Stages** (`/masters/production-config`, Stages tab) — configurable stage lookup (code/name/sequence) with self-referencing `parentStageId` in the schema for future sub-stages (not yet exposed in the simple UI). Feeds the Phase 5 stage-transition ledger design noted above.
- **Production Lines** (`/masters/production-config`, Lines tab) — factory line/work-center master (code/name/capacityPerDay); `branchId`/`departmentId` exist on the model for future use but aren't wired into this simple UI yet.
- **Sales Agents** (`/masters/sales-agents`) — domestic/retail channel agents, distinct from export Buyers, with a commission percentage — matches the reference systems' agent-based domestic sales channel.
- All four verified end-to-end in the browser (create + list, including dropdowns populated from real data — e.g. Material's Default Supplier dropdown showing a previously-created Supplier).
- Gotcha hit twice this session: after `prisma migrate dev`/`prisma generate`, the **running** Next.js dev server process keeps the old `@prisma/client` module cached in memory — schema/client changes require a full dev-server restart (stop + start), not just a file save, or you'll get `Unknown argument` Prisma validation errors even though `npx prisma generate` succeeded.

---

## Recommended Stack

Next.js 14+ (App Router) + React + TypeScript + Tailwind CSS (frontend); Next.js API routes/route handlers as REST API; PostgreSQL + Prisma ORM; session-based auth (Auth.js/NextAuth, DB sessions) with RBAC and optional TOTP 2FA; S3-compatible or local file storage for attachments; server-side PDF/Excel export (`exceljs`, `pdf-lib`/`@react-pdf/renderer`).

## System Architecture

Feature-module (vertical-slice) architecture, chosen because ~12 bounded contexts (Sampling, Orders, Production, Inventory, Accounts, Dispatch, …) each have distinct entities/rules/screens — co-locating each domain's schema+service+repository keeps ownership and testing scoped, while a thin `core/` layer holds the handful of truly cross-cutting concerns every module depends on identically.

- **`src/app/`** — Next.js App Router: pages under `(dashboard)/<module>/...`, API route handlers under `app/api/v1/...`. Thin — pages call into `src/modules/*` services; route handlers validate, call services, map errors.
- **`src/modules/`** — one folder per domain (customers, sampling, sales-orders, bom-mrp, production/{cutting,bundling,sewing,finishing,qc}, inventory, accounts, dispatch, admin). Each owns `*.schema.ts` (zod), `*.service.ts` (business logic + state machine), `*.repository.ts` (Prisma queries), `*.types.ts`.
- **`src/core/`** — `auth/`, `rbac/PermissionService`, `db/` (Prisma client singleton), `errors/BusinessRuleError`, `audit/`, `numbering/`, `file-storage/`, `export/`.
- **`src/components/`** — shared UI primitives (tables, forms, modals, charts, layout shell/sidebar/topbar).

### Folder structure

```
fashion-erp/
├── prisma/
│   ├── schema.prisma          (or split per domain under prisma/schema/)
│   ├── migrations/
│   └── seed.ts
├── src/
│   ├── app/
│   │   ├── (auth)/login/
│   │   ├── (dashboard)/{dashboard,masters,sampling,sales-orders,bom-mrp,production,inventory,accounts,dispatch,reports,admin}/
│   │   └── api/v1/...
│   ├── modules/{customers,sampling,sales-orders,bom-mrp,production/*,inventory,accounts,dispatch,admin}/
│   ├── components/{ui,forms,charts,layout}/
│   ├── core/{auth,rbac,db,errors,audit,numbering,file-storage,export}/
│   ├── lib/
│   └── config/                 (module/action/status enums — single source shared by RBAC matrix + state machines)
├── tests/{unit,integration,e2e}/
└── public/
```

---

## Database Design

PostgreSQL + Prisma, ~70 tables across 9 domains.

**Global conventions** (apply everywhere unless noted):
- UUID PKs (`gen_random_uuid()`).
- `company_id` (+ `branch_id` where relevant) on every business table — enables Postgres Row-Level Security later without a schema change; costs nothing at single-company scale.
- Audit columns: `created_at/updated_at/created_by/updated_by`.
- Masters: soft-delete (`is_active`, `deleted_at`). **Financial/inventory transactional tables have no delete column at all** — status-driven lifecycle (`DRAFT/POSTED/CANCELLED/REVERSED`), corrections via reversing entries only.
- Financial headers: multi-currency pattern — `currency_code`, `exchange_rate` (frozen at transaction time), `base_currency_code`, `amount` + `base_amount` (both stored, not generated columns).
- Every header table gets a unique `document_number` from the shared `document_sequences` service.

### Organization / Auth (7 tables)
`companies`, `branches`, `users`, `roles`, `permissions`, `role_permissions`, `user_branch_roles` — company-scoped RBAC with per-branch role assignment.

### Masters (18 tables)
`currencies`, `customers`, `buyers`, `suppliers`, `departments`, `employees`, `products` (styles **and** raw materials, disambiguated by `item_type`: `STYLE` | `RAW_MATERIAL` — one table so BOM lines FK to a single `products` table regardless of item type; materials add `material_category`, `default_supplier_id`, `reorder_level`, `unit_cost`), `product_variants` (style×color×size join — required so every stock/production/dispatch/invoice line has one concrete SKU FK), `colors`, `sizes`, `units_of_measure`, `warehouses`, `warehouse_locations`, `production_stages` (configurable stage lookup, self-referencing `parent_stage_id` for sub-stages), `production_lines` (factory line/work-center master), `sales_agents` (domestic/retail channel, distinct from export `buyers`).

### Sampling (5 tables)
`sample_requests` (immutable header, `SAM-2026-00001`), `sample_versions` (**append-only** — revisions never overwrite, unique `(sample_request_id, version_number)`), `sample_materials`, `sample_approvals`, `sample_comments`.

### Sales Orders (3 tables)
`sales_orders`, `sales_order_items` (FK `sample_request_id` nullable — closes Sample→Order traceability), `sales_order_item_breakdown` (size/color qty matrix).

### Production (10 tables)
`boms`, `bom_items`, `material_requirements` (explicit BOM→MR→Production Order link), `production_orders` (`PROD-2026-00001`), `cutting_plans`, `bundles` (the unit flowing through sewing→finishing→QC), `sewing_production`, `finishing_records` (completion fires `PRODUCTION_RECEIPT` inventory transaction), `qc_inspections`, `qc_defects`.

### Inventory (10 tables)
`inventory_transactions` (**immutable stock ledger, sole source of truth**), `stock_balances` (derived/maintained cache), `stock_movements` + `stock_movement_items` (unified issue/return/transfer/adjustment via `movement_type`), `goods_receipts` + `goods_receipt_items`, `purchase_requests` + `purchase_request_items`, `purchase_orders` + `purchase_order_items`.

### Accounts (13 tables)
`chart_of_accounts`, `journals` + `journal_lines` (double-entry core, balance enforced at post-time), `sales_invoices` + `sales_invoice_items` (posted = immutable, voids via credit note), `purchase_invoices` + `purchase_invoice_items`, `payments` (direction-flagged), `payment_allocations`, `expenses`, `tax_types`, `tax_rates` (effective-dated), `tax_transactions` (freezes rate/amount at transaction time).

### Dispatch (7 tables)
`dispatches` (`DSP-2026-00001`), `dispatch_items`, `picking_lists`, `packing_lists`, `cartons` + `carton_items`, `delivery_records`.

### System (4 tables)
`attachments` (polymorphic, CHECK-constrained `related_module`), `notifications`, `audit_logs` (append-only, JSONB old/new values), `document_sequences` (atomic per-company/branch/type/year counter).

### Key design decisions
1. **Stock ledger consistency** — `inventory_transactions` write + `stock_balances` upsert happen in the same Prisma `$transaction`; an `AFTER INSERT` DB trigger is a safety net; nightly reconciliation job compares ledger sum vs. balance and alerts on drift.
2. **Journal balance enforcement** — app computes debit/credit sums before allowing `POSTED`; DB trigger re-validates on that transition as backstop. DRAFT journals may be transiently unbalanced.
3. **Document numbering concurrency** — atomic `UPDATE document_sequences SET current_number = current_number + 1 … RETURNING current_number`, never `SELECT MAX(...)+1`.
4. **Polymorphic tables** (`attachments`, `notifications`, `audit_logs`, ledger `reference_*`) have no real Postgres FK — mitigated via CHECK-constrained discriminator enums + app-layer existence validation + treating them as append-only/never-cascade-deleted-from.
5. **Multi-currency** — rate captured once and frozen (`base_amount` stored, not computed live) so historical reports are immune to later rate-source changes.
6. **Consolidation** — material issues/returns/transfers merged into one `stock_movements` table (`movement_type` discriminator); everything else the brief named as a distinct document was kept separate to avoid blurring workflow or audit trail.

---

## Roles & Permissions

Roles: Super Admin, Management, Merchandiser, Sampling Manager, Production Manager, Production Supervisor, QC Manager, Store Manager, Accounts Manager, Accounts Executive, Dispatch Manager, Warehouse User, Viewer.

Actions per module: View, Create, Edit, Delete, Approve, Reject, Post, Cancel, Export, Print. Enforced server-side only via `PermissionService.can(userId, module, action, resourceContext?)` — never trusted from client state.

**Segregation-of-duties rules, enforced in code not just UI:**
- No self-approval: any Approve action checks `resource.createdBy !== currentUser.id`, escalating if the creator is the only eligible approver.
- Posted invoices/journals are immutable — Edit only while status=Draft; corrections are new reversing/credit-note documents gated to Accounts Manager+.
- Accounts Executive creates/edits draft invoices and records payments but cannot delete posted invoices or approve payments.
- Warehouse User/Production Supervisor get Create rights in their domain but not Delete — corrections escalate to Store/Production Manager.

The full role × module permission matrix lives in the Phase 1 plan file (see "Reference" below) and should be encoded as seed data in `permissions`/`role_permissions` during Phase 2.

---

## API Architecture

- Base path `/api/v1/...`, resource-oriented plural nouns, one level of nesting max, non-CRUD business operations as sub-resource POSTs (`POST /api/v1/samples/:id/approve`, `POST /api/v1/sales-invoices/:id/post`, `POST /api/v1/dispatches/:id/confirm`).
- Auth: session cookies (httpOnly, secure, sameSite=strict), optional TOTP 2FA for Super Admin/Accounts roles at minimum. Every route wrapped by `requireAuth()` then `requirePermission(module, action)`.
- Pagination/filtering: `?page=&pageSize=` → `{data, meta:{page,pageSize,totalCount,totalPages}}`; standardized `?status=&customerId=&dateFrom=&dateTo=&search=&sortBy=&sortOrder=`; export via `?format=csv|xlsx|pdf` on the same list endpoint.
- **Error shape** — structured, user-friendly, never a bare 500:
  ```json
  { "error": { "code": "INSUFFICIENT_FG_STOCK",
      "message": "Unable to create dispatch because 125 pieces of Style ST-102 are not available in Finished Goods stock. Available: 80, Requested: 205.",
      "details": { "styleId": "ST-102", "available": 80, "requested": 205 } } }
  ```
  A shared `BusinessRuleError` subclass hierarchy (`INSUFFICIENT_FG_STOCK`, `UNBALANCED_JOURNAL`, `POSTED_INVOICE_LOCKED`, `REFERENCED_RECORD_IN_USE`, `DUPLICATE_DOC_NUMBER`, …) maps codes to friendly templates centrally.

---

## Business Workflows (state machines)

- **Sample**: Draft→Requested→TechPackReady→InDevelopment→InternalQC→SubmittedToCustomer→CustomerFeedbackReceived→{RevisionRequested→InDevelopment (version++), Approved, Rejected}; OnHold/Cancelled from any non-terminal state.
- **Sales Order**: Draft→Confirmed→InProduction→PartiallyDispatched→Dispatched→Invoiced→Closed; Amended creates a new version, prior locked; Cancel blocked past Cutting without Management override.
- **Production Order**: Planned→MaterialAllocated→CuttingInProgress→CuttingComplete→BundlingComplete→SewingInProgress→SewingComplete→FinishingInProgress→FinishingComplete→QCInProgress→{QCFailed→ReworkInProgress→QCInProgress, QCPassed}→ReadyForFinishedGoods→Closed.
- **Purchase**: Draft→Approved→SentToSupplier→PartiallyReceived→FullyReceived→Closed.
- **Sales Invoice**: Draft→Posted→PartiallyPaid→Paid→Closed; Posted is immutable, voids via Credit Note.
- **Dispatch**: Draft→PickingListGenerated→Picked→Packed→DispatchConfirmed→InTransit→Delivered→Closed; blocked at PickingListGenerated if requested qty > available FG stock.

---

## Key Business Validation Rules

- Cannot dispatch more finished goods than available stock per style/color/size at the source warehouse.
- Cannot issue raw material beyond available stock (blocks CuttingInProgress).
- Journal entries must balance before posting; posted invoices/journals are immutable (reversal only).
- Payments cannot be approved by their own creator.
- Cannot delete a Customer/Supplier/Style/Warehouse with transactional references — soft-deactivate only.
- Sales Order cannot Confirm without an Approved Sample (or logged override).
- QC failure routes to Rework/Reject, never silently passes to Finished Goods stock.
- Document numbers unique/gapless, generated via atomic counter increment, never `MAX()+1`.
- Every state-changing action writes to the audit log with before/after snapshot — enforced at the service layer.

---

## Phased Build Order

Dependency chain: Masters → Sampling → Sales Orders → BOM/MRP → Purchasing/GRN → Raw Material Inventory → Production → WIP/FG Inventory + QC → Dispatch → Sales Invoicing → Payments/Ledgers/Reports.

### Phase 2 — Foundation
Project setup, Prisma schema (Organization+Masters+System tables first), auth, RBAC engine, document numbering, audit log, file attachments, layout shell.

### Phase 3 — Masters
Customers, buyers, suppliers, employees, departments, styles/product variants, colors, sizes, units, warehouses.

### Phase 4 — Sampling
Full request→version→approval workflow, costing, sampling reports.

### Phase 5 — Orders + Production
Sales orders, BOM/MRP, production orders, cutting, bundling, sewing, finishing, QC, FG stock receipt.

### Phase 6 — Inventory
Full stock ledger, goods receiving, purchase orders/requests, stock movements/transfers/adjustments.

### Phase 7 — Accounts
Chart of accounts, double-entry journal engine, sales/purchase invoices, payments+allocations, expenses, tax config, ledgers, P&L/balance sheet/trial balance.

### Phase 8 — Dispatch
Picking, packing, cartons, dispatch orders, delivery, printable documents, invoice integration.

### Phase 9 — Reports
Cross-module KPI dashboard, all operational/financial reports, export/print infrastructure.

### Phase 10 — Testing
Critical-path tests per module: sampling versioning/approval, MRP, stock negative-balance prevention, journal balance, dispatch stock deduction.

### Phase 11 — Hardening
Security review, performance/indexing pass, backup strategy, full audit-log coverage check, permission-matrix QA across all roles.

---

## MVP vs Later Phases

**MVP (Phases 2–6 + minimal 7/8)**: Foundation, Masters, Sampling, Sales Orders, BOM/MRP, Production (through QC/FG), core Inventory ledger, basic Dispatch (picking/packing/dispatch/FG deduction), and a minimal Accounts slice (chart of accounts, manual + dispatch-triggered sales invoices, basic payments) — enough to run one full Customer→Sample→Order→Production→Dispatch→Invoice→Payment cycle end-to-end with real transactional data.

**Deferred**: multi-currency UI (schema supports it from day one), multi-company/branch admin UI (schema scoped from day one via `company_id`/`branch_id`), full P&L/balance sheet/cash-flow reporting beyond trial balance + basic ledgers, 2FA enforcement, configurable approval workflows (start hardcoded per state machines above), stock reservation logic beyond basic available-qty checks, batch/lot tracking on `stock_balances`.

---

## Risks & Edge Cases

- Polymorphic FK integrity (attachments/audit_logs/notifications) — no DB-enforced referential integrity; mitigate with CHECK-constrained discriminators + app-layer validation + periodic orphan-check job.
- Stock ledger drift if app-transaction and trigger ever disagree — nightly reconciliation job is mandatory.
- Concurrent document-number generation under load — must use atomic `UPDATE...RETURNING`.
- Sample versioning race — two users revising the same sample concurrently; mitigated by unique `(sample_request_id, version_number)` + transactional "next version" read.
- Multi-currency rounding — centralize conversion/rounding in one service.
- Segregation-of-duties gaps — permission checks must be server-side per request, not just hidden UI buttons.

---

## Verification

- Prisma schema validates and migrates cleanly (`prisma migrate dev`) with realistic seed data covering every domain (10 customers, 10 suppliers, 20 styles, multiple warehouses/colors/sizes — no placeholder "Test 1" records).
- Each phase ships its own critical-path tests before moving to the next phase.
- End-to-end manual walkthrough after Phase 8: customer → sample → approve → sales order → production order through QC → dispatch → auto-invoice → payment, confirming stock/ledger balances update correctly and the full traceability chain is navigable from the order detail screen.
- UI changes verified in-browser per module as they're built, not just via type-checking/tests.

---

## Reference

Full architecture rationale, complete table-by-table field lists, and the full role×module permission matrix were developed in the Phase 1 planning session and are condensed here. Consult that history if a design decision needs deeper justification than what's summarized above.
