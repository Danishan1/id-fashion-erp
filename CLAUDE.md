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

### Phase 3 extension #2 — masters imported from HRMS/Inventory/Royal Jeans, batch 1 (2026-08-17)
Full architecture scan of the three sibling projects (`hrms`, `inventory`, `royal_jeans`) plus a comparison-table review with the user (see session transcript) drove this batch. Scope was deliberately narrowed by explicit user decision: HRMS's payroll (Leave Policy/PF/ESIC/Bank Details) and CRM/Lead-management masters were **excluded** (no corresponding phase in this roadmap); garment/production masters were prioritized over HR masters; `Product.category`/`Product.season` were upgraded from free-text strings to FK'd masters.

**19 new master tables**, all company-scoped, `{code, name, isActive}` shape unless noted:
- **Garment attributes** (`src/modules/garment-attributes/`, `/masters/garment-attributes`, 8-tab page): `Brand`, `Category` (now FK'd from `Product.categoryId`), `Season` (FK'd from `Product.seasonId`), `ProductFitting`, `ProductType`, `Design`, `DesignPattern`, `Pattern`. One generic `makeSimpleLookupService()` factory in the service file drives all 8 list/create/update triples instead of 8x duplicated code.
- **Fabric sub-masters** (`src/modules/fabric-config/`, `/masters/fabric-config`, 5-tab page): `FabricGsm`, `FabricDye` (+`pantone`), `FabricWeaveType`, `FabricWidth` (+`unit`, default `cm`), `FabricComposition`. These are standalone lookups (not yet wired as FKs onto `Product`/materials — see Pending below), imported from Royal Jeans' fabric master set.
- **Machine** — added to the *existing* `src/modules/production-config/` module (not a new module) since it's production-line-adjacent; FK to `ProductionLine` (nullable), exposed as a third "Machines" tab on `/masters/production-config` alongside Stages/Lines.
- **HR config** (`src/modules/hr-config/`, `/masters/hr-config`, 4-tab page): `Designation`, `EmployeeCategory`, `ShiftMaster` (+`startTime`/`endTime` as plain strings, not a DB `Time` type), `HolidayMaster` (`name`+`date`, company-scoped — deliberately *not* per-user like HRMS's version). None of the three source projects had these as real tables (HRMS used a free-text `designation` string) — built fresh, not ported. `Employee.designation` remains a plain string for now (Designation master isn't wired in as its FK yet — see Pending).
- **Cost Master** (`src/modules/cost-master/`, `/masters/cost-master`, standalone page): overhead rate master (`type` enum HOURLY/MONTHLY/PER_UNIT/FIXED, `rate`), imported from Inventory. Lower priority than the garment masters per user's stated build order, done last in this batch.

**`SimpleLookupManager` extended** (`src/components/ui/SimpleLookupManager.tsx`) with a `"select"` field type (static `options` or async `optionsUrl` fetch) and a `"date"` field type — first new field types since the component was built in Phase 3; needed for Machine's Production Line dropdown and Holiday's date picker. Existing `text`/`number`/`color` usages are unaffected.

**`Product.category`/`Product.season` migrated from strings to FK** (`categoryId`/`seasonId` → `Category`/`Season`): confirmed zero existing `products` rows before dropping the old string columns (no backfill was actually needed), so this was a clean two-migration cutover (add FK columns → drop old columns) rather than a data-preserving backfill. `ProductForm.tsx` now renders these as `<select>` dropdowns fetching from `/api/v1/categories` and `/api/v1/seasons`.

**Pending manual work / deliberately deferred:**
- Fabric sub-masters (GSM/Dye/Weave/Width/Composition) and the garment attribute masters (Fitting/ProductType/Design/DesignPattern/Pattern) are **not yet wired as FKs** onto `Product` — they exist as standalone CRUD masters only. Wiring them in (e.g. `Product.gsmId`, `Product.fittingId`) is follow-up work once Sampling/Production phases need them, to avoid guessing UI/UX for fields not yet requested.
- `Designation` master is not yet wired as `Employee.designationId` (Employee keeps its plain string field).
- HRMS's payroll and CRM/Lead masters, and Inventory's `PaymentType`, were explicitly out of scope per user decision — revisit only if an HR/Payroll or CRM phase is ever added to the roadmap.
- Two infra gotchas hit this session, unrelated to the code changes: (1) the dev database had **no `_prisma_migrations` tracking table** at all (built via `prisma db push` at some point in Phase 2/3, not `migrate dev`) — fixed via `prisma migrate resolve --applied` on both pre-existing migrations before the new migration would apply cleanly; this is now resolved going forward. (2) The local PostgreSQL Windows service can stop unexpectedly outside of any Claude Code action — if login suddenly fails with a Prisma `ECONNREFUSED`, check `Get-Service postgresql-x64-17` before assuming a code regression.
- **Navigation gap found and fixed (2026-08-17)**: none of the 27 pages under `/masters` (old or new) had a breadcrumb or any way back except the Sidebar's static "Masters" link — a real UX gap, not specific to this batch. Added `src/components/ui/Breadcrumb.tsx` (simple `{label, href?}[]` trail, clickable ancestors) and wired it into every masters page: index (`Dashboard / Masters`), tabbed/simple lookup pages (`Masters / <Page>`), and all three tiers of the full-CRUD masters — list (`Masters / <Section>`), new (`Masters / <Section> / New`), and detail/edit (`Masters / <Section> / <record name>`). Use this component for any future page added under `/masters` (or elsewhere) — don't ship a page without it.
- **`DataTable` had no visible Edit affordance** — rows were clickable but nothing signaled it. Added an explicit "Edit" link in a new Actions column (`src/components/ui/DataTable.tsx`); the whole row is still clickable too, the link just makes the affordance discoverable.
- **Active/Inactive toggle now confirms everywhere** — added `src/components/ui/ConfirmModal.tsx`, a single shared confirmation dialog (`{open, title, message, confirmLabel, isDangerous, onConfirm, onCancel}`). Wired into `SimpleLookupManager`'s existing toggle (previously fired with zero confirmation) and added a brand-new toggle to `DataTable` (previously had none at all — changing `isActive` required opening the full edit form). `DataTable`'s toggle needed a new lightweight `PATCH /api/v1/<module>/:id/status` endpoint per full-CRUD master (Customers, Suppliers, Employees, Materials, Products, Warehouses) — see `set*ActiveStatus` in each module's service — because the existing PATCH routes validate the *full* create/update schema, and the list row's projection doesn't carry every required FK id (e.g. Employee's list row has `department.name`, not `departmentId`), so reusing the full-update endpoint from the list view would have risked silently dropping FKs. The status endpoint only ever touches `isActive`. Use this same `/status` sub-route pattern for any new full-CRUD master's list toggle.
- **Toggle is a real switch, not a text link** — added `src/components/ui/ToggleSwitch.tsx` (visual on/off pill, green when active) and swapped it in for the old "Activate"/"Deactivate" text links in both `DataTable` and `SimpleLookupManager`. The click still opens `ConfirmModal` before anything actually changes — only the affordance changed, not the flow.
- **Code field now auto-suggests from Name** — added `src/lib/code-suggest.ts` (`suggestCodeFromName(name, prefix?)`, e.g. "Royal Jeans" → "ROYAL-JEANS"). Wired into `SimpleLookupManager` (generically, for any field set containing a `code` key) — this is the "mnemonic code" pattern, appropriate for small lookup masters (Colors, Sizes, Brands, etc.) where a human-recognizable code matters more than sequencing.
- **Sequential auto-numbering for identity-heavy masters (2026-08-17)** — Customer/Supplier/Employee/Style/Material don't use the name-derived suggestion above; they get real auto-incrementing codes instead (`CUST-00001`, `SUP-00001`, `EMP-00001`, `ST-00001`, `MAT-00001`), following the industry-standard split between mnemonic codes (small reference lookups) and sequential codes (high-volume/identity masters — this is also literally how SAP/Oracle/Dynamics number their Customer/Material masters). Implementation deliberately **reuses the existing `document_sequences` table and `DocumentNumberingService`** rather than inventing a second numbering mechanism — `DocumentType` gained 5 new values (`CUSTOMER`, `SUPPLIER`, `EMPLOYEE`, `STYLE`, `MATERIAL`), and all master-code rows are stored under a fixed sentinel `fiscalYear = 0` so — unlike invoice/order numbers — they never reset annually. Two new exports: `previewNextMasterCode()` (pure read, safe to call on every form-open, used to pre-fill the Code field) and `advanceMasterCodeSequence()` (atomic increment, called once per successful `create*` in each service, regardless of whether the user kept the suggestion or typed their own code — this is "external numbering" per SAP's terminology: the system suggests, the field stays fully editable, and the uniqueness check on `code` is what actually prevents collisions, not the sequence itself). New `GET /api/v1/<module>/next-code` endpoint per module backs the preview.
- **Default Currency is now a real dropdown, defaults to INR** — was a free-text 3-letter input on `CustomerForm`/`SupplierForm`; now a `<select>` populated from a new `GET /api/v1/currencies` endpoint, labeled `CODE — Name (Country)` (the `Currency` model has no country column, so a small `COUNTRY_BY_CURRENCY` display-only map in each form covers the 3 seeded currencies — add to that map, not the schema, if more currencies are seeded later). `EMPTY_VALUES.defaultCurrencyCode` defaults to `"INR"` in both forms.
- **Customer's Country field is now a dropdown too** — `Customer.country` is (deliberately) a plain string column, no Country master table, so `src/lib/countries.ts` exports a static `COUNTRIES` name list for the `<select>`. Naming was deliberately matched to what's already seeded (`"USA"`, `"UAE"`, not the full ISO names) so existing customers' stored values still pre-select correctly on the edit page — keep that in mind if more countries get added to the list later.

### Enterprise readiness — Phases A, B, C & D complete; E & F deliberately deferred (2026-08-17)
Following a senior-architecture review (`ARCHITECTURE_REVIEW.md`) and a full implementation roadmap (`ENTERPRISE_READINESS_ROADMAP.md`), Phases A, B, C, and D are implemented and verified. **Phases E (structured logging/Sentry/cloud file storage) and F (OpenAPI docs) are explicitly deferred at the user's request — not needed at the current stage.** Both remain fully specified in `ENTERPRISE_READINESS_ROADMAP.md` if picked back up later (E1 structured logging is the one item there worth doing early/cheaply once real users are on the system, since it's a 1-day task with no other prerequisites beyond CI).

**Phase D — Testing:**
- **Vitest setup**: `vitest` + `@vitest/ui` added as dev dependencies, `vitest.config.mts` (the `.mts` extension, not `.ts`, avoids a Vite CJS/ESM config-loader deprecation warning — `package.json` has no `"type": "module"`, so a plain `.ts` config file is loaded as CommonJS by Node even though its own syntax is ESM; use `import.meta.dirname`, not `__dirname`, inside it for the same reason). `npm test` (`vitest run`, single pass) and `npm run test:watch` added to `package.json` scripts.
- **5 test files, 32 tests, all passing, zero real-DB dependency**: `BusinessRuleError.test.ts` (error-code → HTTP-status mapping, Zod-shaped error handling, generic-error detail redaction), `rateLimiter.test.ts` (Phase B's lockout counter — allow/deny/reset), `PermissionService.test.ts` (permission grant/deny, per-user cache hit, the self-approval branch both denied-for-non-admin and allowed-for-SUPER_ADMIN), `DocumentNumberingService.test.ts` (both the fiscal-year document-number path and the never-resets master-code path — create-on-first-use vs. atomic-increment-on-existing), and `customer.service.test.ts` (duplicate-code rejection, update, NOT_FOUND — mocking `CustomerRepository` instead of Prisma, which is Task C1's actual payoff: this test file runs in milliseconds with no Postgres involved).
- **Mocking pattern for singleton modules** (`PermissionService`, `DocumentNumberingService`): both import `prisma` from `@/core/db/client` directly (no repository layer — out of scope for this roadmap phase), so their tests `vi.mock("@/core/db/client", () => ({ prisma: { ... } }))` with `vi.hoisted()` for the mock functions (required because `vi.mock` factories run before top-level `const` bindings are initialized) and a **dynamic `await import(...)`** of the module under test *after* the mock is registered — a static top-of-file `import` would bind to the real module before the mock takes effect. `PermissionService` additionally needs `PermissionService.invalidate()` in `beforeEach` since it's an exported singleton instance whose in-process cache would otherwise leak permission keys across test cases.
- **`npm test` wired into `.github/workflows/ci.yml`** as its own step between Lint and Build — a red "Test" step in the Actions UI now points directly at a broken test, not a build failure that happens to be caused by one.
- Not yet covered (explicitly deferred, not an oversight): route-handler/integration tests, React component tests, and unit tests for the other 12 masters' services (their business logic — duplicate-code check, active-status toggle — is structurally identical to `customer.service.test.ts`'s pattern; add one only when a real bug surfaces there, per the roadmap's "don't test the mock" guidance rather than mechanically cloning this file 12 times for coverage-percentage's sake).

**Phase A — Production Foundation:**
- `.env.example` added — documents the *actual* var names this project uses (`NEXTAUTH_SECRET`/`NEXTAUTH_URL`, not the newer `AUTH_SECRET` name some NextAuth v5 docs assume; verified against the real `.env` before writing this, don't assume the docs match without checking).
- `.github/workflows/ci.yml` added — `npm ci` → `prisma generate` → `tsc --noEmit` → `lint` → `build` on every push/PR. The `prisma generate` step is required because there's no `postinstall` script — a fresh CI checkout has no generated Prisma client otherwise.
- Security headers added to `next.config.ts` (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`) — verified live via `curl -I`.
- Fixed 5 pre-existing lint warnings (dead `isCodeManuallyEdited` state left over from the sequential-numbering refactor) so CI starts clean rather than "green but noisy."

**Phase B — Security Hardening:**
- **Rate limiting + brute-force lockout**: `src/core/auth/rateLimiter.ts` (in-memory, `lru-cache`-backed — adequate for this project's single-instance deployment; swap for `@upstash/ratelimit` only if it ever runs multi-instance) — 5 failed attempts locks an email out for 15 minutes. Wired into `auth.ts`'s `authorize()` **without changing its existing "return null on any failure" contract** — lockout is caught and converted to `return null`, same as every other failure path, so the login page's generic "Invalid email or password" message needed zero changes (and arguably that's more secure than a distinct message, since it doesn't leak lockout state to an attacker). Verified live: 5 wrong passwords via the real login form, then the *correct* password on attempt 6 was still rejected.
- **RBAC granularity fix**: `masters` (one module covering all ~27 master tables) split into `masters_core` and `masters_finance` in `src/config/rbac.ts`. Only `SUPER_ADMIN`, `MANAGEMENT` (view-only), `ACCOUNTS_MANAGER`, `ACCOUNTS_EXECUTIVE` (view-only), and `VIEWER` get `masters_finance` — every floor/warehouse/production role (`STORE_MANAGER` included, the specific case the architecture review flagged) now only gets `masters_core`. No schema migration needed since `Permission.module` is a plain string column. All 83 route files bulk-renamed from `"masters"` to `"masters_core"`, then the 6 routes under `bank-accounts`/`payment-types`/`cost-masters` flipped to `"masters_finance"`. Reseeded (`prisma db seed`), verified the new `role_permissions` rows matched intent exactly via direct DB query, then deleted the now-orphaned old `masters.*` permission rows (cascaded to their `role_permissions` automatically). **Gotcha**: `PermissionService` caches permission keys per-user in-process — a dev-server restart was required after reseeding for the change to take effect for an already-logged-in session, same as the Prisma-client-cache gotcha noted earlier in this file, different root cause.

**Phase C — Architecture Foundations, complete (2026-08-17):**
- **Repository layer (C1)**: every one of the 13 master-data service files (`customers`, `suppliers`, `employees`, `warehouses`, `products`, `departments`, `garment-attributes`, `fabric-config`, `hr-config`, `production-config`, `cost-master`, `finance-config`, `lookups`) now imports a sibling `*.repository.ts` instead of `@/core/db/client` directly — confirmed with `grep -rl 'from "@/core/db/client"' src/modules --include="*.service.ts"` returning empty. Two distinct repository shapes were used deliberately, not one forced pattern: the 5 "rich" modules (Customers/Suppliers/Employees/Warehouses/Products) got hand-written named query methods (`findById`, `findByCode`, etc.) since they have real query complexity (nested includes, dual STYLE/RAW_MATERIAL views, search filters); the 8 simple-lookup modules (24 total entities across `garment-attributes`/`fabric-config`/`hr-config`/`production-config`/`cost-master`/`finance-config`/`lookups`/`departments`) got a repository file that's just a thin re-export of the raw Prisma delegate per entity (e.g. `export const GarmentAttributeRepository = { brand: prisma.brand, category: prisma.category, ... }`) — writing 24 hand-rolled repository classes for tables with zero business logic beyond a duplicate-code check would have violated the roadmap's explicit "avoid unnecessary complexity" instruction for no testability gain.
- **Audit logging consistency (C2)**: the same 7 simple-lookup service files (24 entities) were missing `writeAuditLog` calls entirely — only the 5 rich modules + `departments` had them. Fixed by adding a `userId` field to each file's `ActorContext` interface (previously `{ companyId }` only) and a `writeAuditLog({..., action: "CREATE"|"UPDATE", newValues})` call after every create/update, using the real Postgres table name from `schema.prisma`'s `@@map(...)` (e.g. `"fabric_gsms"`, `"holiday_masters"`, not the Prisma model name). This required passing `userId: session.user.id` through the actor object at every call site — done via a scoped `sed` bulk-replace of the literal `{ companyId: session.user.companyId }` construction across all 52 matching route files (26 entities × create+update), plus two manual edits for `units` (global/non-company-scoped, so its service functions previously took no actor object at all — now they do, purely to carry `userId`/`companyId` for the audit row, since `AuditLog.companyId` is non-nullable even for a record that itself has no company scope). Deliberate simplification: unlike the rich modules, these audit entries don't fetch an `oldValues` snapshot before update (no existing `getById` helper to reuse, and adding one solely for audit purposes across 24 near-identical entities wasn't worth the extra query per update) — `newValues`-only logging here, `oldValues`+`newValues` in the 6 modules that already had a "before" read for other reasons.
- Verified end-to-end, not just by type-check: created a real Brand through the `/masters/garment-attributes` UI, then queried `audit_logs` directly via a one-off Prisma script and confirmed a `CREATE` row with the correct `userId`, `companyId`, `tableName: "brands"`, and full `newValues` snapshot — then deleted the test row. `npx tsc --noEmit` and `npm run lint` both clean across the whole project after every file group.
- Phases D (Testing), E (Observability & Infra), F (Documentation) remain — see `ENTERPRISE_READINESS_ROADMAP.md`, implemented one phase at a time per the established checkpoint protocol.

### Phase 3 extension #3 — Payment Type & Bank Account masters, batch 2 (2026-08-17)
Second import batch, covering the two Phase-7-deferred items from the original comparison table (Inventory's `PaymentType`, HRMS's `BankDetails`/`BankAccount`), at the user's request as a standalone follow-up rather than waiting for the Accounts phase.
- **Payment Type** (`src/modules/finance-config/`, `/masters/finance-config`, "Payment Types" tab) — `code`, `name`, `type` enum (`CASH`/`BANK`/`CHEQUE`/`CARD`/`UPI`/`OTHER`). Deliberately **excludes** Inventory's balance/opening-balance columns — those require a real ledger, which doesn't exist until Phase 7's journal engine lands; this is a pure lookup for now.
- **Bank Account** (same module, "Bank Accounts" tab) — `code`, `name` (display label), `bankName`, `accountNumber`, `ifscCode`, `branch`, `accountHolderName`, `upiId`. Modeled as a list (multiple accounts per company), not HRMS's 1-per-company singleton `BankDetails` — more useful for a company with more than one operating account.
- Both are plain standalone masters with no wiring into a payments/invoicing flow yet (none exists in this codebase) — that integration is Phase 7 work.
- Gotcha repeated from the batch-1 note above, worth calling out again since it bit again in-session: after `prisma migrate dev` + `prisma generate`, the **already-running** dev server process (this one predated the migration) kept the stale `@prisma/client` module in memory and threw `Cannot read properties of undefined (reading 'findMany')` on the new models until the dev server was fully stopped and restarted. Always restart after a schema change, not just `prisma generate`.

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
