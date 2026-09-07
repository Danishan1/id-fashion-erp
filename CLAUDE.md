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
| 4 | Sampling | ✅ Done |
| 5 | Orders + Production | ✅ Done — 5A (Sales Orders), 5B (BOM/MRP), and 5C (Production: Production Orders/Lots/JobOrders/QC/split-merge) all built and verified end-to-end this session |
| 6 | Inventory | ✅ Done — Purchase Order + Goods Receipt (fabric roll tracking), the stock ledger, Material Request, and Stock Movements (Transfer/Adjustment/Return-to-Supplier) all built and verified |
| 7 | Accounts | ✅ Done — 7A (Chart of Accounts, Tax Config, Journal engine), 7B (Sales Invoices), 7C (Purchase Invoices), 7D (Payments + Allocations), and 7E (Expenses) all built and verified on branch `phase-7-accounts` |
| 8 | Dispatch | ✅ Done — pick/pack/confirm/deliver workflow, cartons with barcodes, and Finished-Goods stock decrement all built and verified on branch `phase-8-dispatch` |
| 9 | Reports | ✅ Done (2026-08-25) — architecture + Report Center nav + 75 reports across all 26 buildable categories (only Payroll unavailable — no schema); merged to `main` |
| 10 | Testing | ✅ Done (2026-08-26) — full QA/UAT pass via 9 parallel agents across every module + all 75 reports; 1 P0, 4 P1, 10 P2, 4 P3 bugs found and fixed; 519/519 tests, clean build |
| 11 | Hardening | ✅ Done — P0 and P1 audit tiers fully closed, plus bounded P2 cleanup; P3 items (2FA, CD pipeline, cloud storage, Redis) explicitly deferred pending decisions only the user can make (see dated notes below) |

Update the status column and add a short dated note under the relevant phase section below whenever a phase completes or deviates from plan.

**CRM/Sales/Marketing/HRMS migration (separate initiative, not part of the 11 phases above) — all confirmed modules now complete (2026-08-24)** — a business-logic migration from a sibling WordPress project ("EQ Business OS"), tracked in full in [CRM_SALES_MARKETING_HRMS_MIGRATION_REPORT.md](CRM_SALES_MARKETING_HRMS_MIGRATION_REPORT.md): the source analysis/mapping/decisions, and a full build log. CRM (Lead + Deal + Activity/Followup), Marketing (Campaigns + daily metrics + attribution + automated alerts), and HRMS (Attendance + Leave, per the confirmed scope — Payroll/KPI/Performance/Recruitment/self-service portals deliberately excluded) are all built, tested, and verified live. Built on the `crm-marketing-hrms` branch (not yet merged to `main` — see that file's own build log for exactly what's pending). See that file before touching `Lead`/`Deal`/`CrmActivity`/`CrmFollowup`/`Campaign`/`CampaignDailyMetric`/`CampaignAttribution`/`CampaignAlert`/`AttendanceRecord`/`LeaveType`/`LeaveRequest`, `Employee.shiftId`, or the `crm`/`marketing`/`hrms_attendance`/`hrms_leave` RBAC modules.

**CRM/Marketing enhancement pass, on top of the migration above — all 14 planned items complete (2026-08-24)** — tracked in full in [CRM_MARKETING_ENHANCEMENT_AUDIT_AND_PLAN.md](CRM_MARKETING_ENHANCEMENT_AUDIT_AND_PLAN.md): Deal→Customer conversion, Customer 360, CRM Kanban, CRM Dashboard, Follow-up Management/Notifications, configurable Lead Priority, Campaign Approval workflow, Marketing Dashboard trend charts, Channel Performance report, Customer Segmentation, Marketing Automation triggers, CSV Import (Leads/Deals/Campaign Daily Metrics), Meta/Google Ads Integration, and an AI-readiness audit of every aggregation function. The one open thread: Meta/Google Ads Integration's OAuth/token-exchange/sync code is built and unit-tested but has **no real credentials to verify the live external API calls against yet** — see that file's own Item 13 note before assuming it's been exercised against the real Meta/Google APIs, and before touching `AdAccountConnection`/`AdCampaignLink`/`ImportBatch`/`CrmSettings` or the `src/modules/marketing/ad-integrations/`/`src/modules/import/` modules.

**AI Garment Flow (separate initiative, not part of the 11 phases above) — foundation + Process 1 (Reference Garment Analysis) + Process 2 (Commercial Design Development Brief) + Process 3 (Garment Design Visual Generation) + Process 4 (Controlled Design Variation) + Process 5 (Commercial Design Evaluation) + Process 6 (Apply Actual Fabric) complete; live image-generation verification (Process 3/4/6) still blocked on the configured OpenAI account's exhausted billing credits, but every Anthropic-backed process (1/2/5) is fully live-verified (2026-09-06/07)** — a new product-development workflow module (reference/fabric upload → AI-assisted design → costing → sampling), full detail in its own dated sections further down this file. The existing `Product` model remains the single Style Master (not duplicated); a new `AiGarmentProject` header is a pre-Style record that manually graduates into a real `Product` via `convertProjectToStyle()`, mirroring Sampling's own `convertSampleToStyle()`. BOM/Costing steps require this graduation and then reuse the existing BOM/MRP and Sampling-costing modules — no parallel schema. Process 1 (Reference Garment Analysis) is a real Anthropic vision integration analysing an uploaded reference image into 36 individually-tracked, editable, approvable observations. Process 2 (Commercial Design Development Brief) is a real Anthropic text integration that, once that analysis is approved, generates 3/6/9 differentiated commercial `AiGarmentDesignDirection` records (each individually editable/approvable/rejectable/regeneratable, each scored 0-100). Process 3 (Garment Design Visual Generation) is a real, provider-agnostic OpenAI Images integration turning each APPROVED design direction into 1/3/4 generated visuals with full version history and a Select/Reject/Regenerate/Create Variation workflow. Process 4 (Controlled Design Variation) is a real image-to-image integration that regenerates just one named feature (Neckline/Collar/Sleeve/.../Other) of an existing generated image while preserving everything else, with its own version-controlled variation history and a Select Variation/Keep Original/Create Another Variation workflow. Process 5 (Commercial Design Evaluation) is a real Anthropic text integration that compares 2-8 APPROVED design directions on a 12-criterion weighted commercial rubric, letting the user override the AI's ranking and always requiring explicit confirmation before recording a SELECTED DESIGN and advancing the workflow to Apply Fabric (or Technical Development, for a fabric-sourced project). Process 6 (Apply Actual Fabric) is a real two-image OpenAI edit integration that applies a user-uploaded fabric swatch onto the selected design's currently SELECTED garment visual, with its own Before/After version history, a two-tier Approve/APPROVE-DESIGN-&-FABRIC confirmation flow, and a workflow advance to Technical Development — see those sections before touching `AiGarmentReferenceAnalysis`/`AiGarmentReferenceObservation`/`AiGarmentReferenceAnalysisRun`/`AiGarmentDevelopmentBriefRun`/`AiGarmentDesignDirection`/`AiGarmentImageGenerationRun`/`AiGarmentGeneratedImage`/`AiGarmentDesignVariationRun`/`AiGarmentDesignVariation`/`AiGarmentCommercialEvaluationRun`/`AiGarmentCommercialEvaluation`/`AiGarmentCommercialEvaluationItem`/`AiGarmentFabricApplicationRun`/`AiGarmentFabricApplication`, `src/core/ai/reference-analysis/`, `src/core/ai/development-brief/`, `src/core/ai/image-generation/`, `src/core/ai/design-variation/`, `src/core/ai/commercial-evaluation/`, `src/core/ai/fabric-application/`, `src/core/ai/providers/anthropic.ts`, or `src/modules/ai-garment-flow/`. `src/core/ai/AIService.ts`'s `NullAIProvider`/`getAIService()` are dead code, unreferenced by any real process — don't wire a future process through that file, follow the established per-process file-layout pattern (`schema.ts`/`prompt.ts`/`generate.ts` or `analyze.ts`) instead.

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

### Phase 4 — Sampling, complete (2026-08-18)
Full request → version → approval workflow built per the plan reviewed and approved with the user beforehand (10-point analysis: purpose, features, schema, integration, workflow, roles, business rules, edge cases, architecture, risks).

- **Schema (5 new tables + 3 enums)**: `SampleRequest` (immutable header — customer/style identity never changes after create), `SampleVersion` (**append-only** — a revision is always a new row, `@@unique([sampleRequestId, versionNumber])`, the prior version flips to `SUPERSEDED` and is never edited), `SampleMaterial`, `SampleApproval`, `SampleComment`. `SampleStatus` (12-state header lifecycle), `SampleVersionStatus`, `SampleDecision` enums. `RelatedModule.SAMPLE_REQUEST` and `DocumentType.SAMPLE_REQUEST` (prefix `SAM`) already existed from Phase 1/2 planning — zero enum changes needed there, `generateDocumentNumber()` reused as-is for `SAM-2026-00001` numbering.
- **Module** (`src/modules/sampling/`) built repository-first from day one (schema → repository → service, no retrofit needed unlike the Phase C masters cleanup): `sample.schema.ts` (Zod), `sample.repository.ts` (5 repository objects, one per model), `sample.service.ts` — the state machine lives here as one explicit `ALLOWED_TRANSITIONS: Record<SampleStatus, SampleStatus[]>` map, checked by a single `transitionSampleStatus()` function rather than scattered if/else. `CUSTOMER_FEEDBACK_RECEIVED`'s three outcomes (`APPROVED`/`REJECTED`/`REVISION_REQUESTED`) and `REVISION_REQUESTED → IN_DEVELOPMENT` are deliberately *not* in that map — they're only reachable through `recordSampleApproval()`/`addSampleVersion()` respectively, not the generic status-change endpoint, so an approval decision can't be forged as a plain status PATCH.
- **Deliberate MVP simplification**: creation goes straight to `REQUESTED` with the request number already assigned (no separate persisted `DRAFT` row) since the create form's Zod schema already requires every field `DRAFT` would exist to defer — `DRAFT` stays a valid enum value for a future partial-save UI, just unused today. Documented here so it isn't mistaken for an oversight.
- **RBAC**: no `rbac.ts` changes needed — the `sampling` module and its per-role action sets (`SAMPLING_MANAGER` full CRUD+approve+reject, `MERCHANDISER` create/edit only, `MANAGEMENT`/`QC_MANAGER`/`PRODUCTION_MANAGER` view/approve-only per role) were already seeded back in Phase 1. Self-approval guard reused as-is: recording an `APPROVED` decision asserts the `approve` action with `resourceContext: { createdBy: request.requestedByUserId }`, so `PermissionService`'s existing creator-can't-approve-their-own-record check (`SELF_APPROVAL_GUARDED_ACTIONS`) applies for free; `REJECTED`/`REVISION_REQUESTED` assert `reject` instead, deliberately *not* self-approval-guarded (CLAUDE.md's original rule only calls out the Approve action).
- **No new `BusinessRuleError` codes** — `INVALID_STATE_TRANSITION`, `NOT_FOUND`, `VALIDATION_ERROR`, `PERMISSION_DENIED` already covered every failure mode this module needed.
- **UI** (`src/app/(dashboard)/sampling/`): list page reuses `DataTable` as-is (no `isActive` column on a transactional record, so the toggle simply doesn't render — matches the status-driven-lifecycle convention for transactional docs). Detail page is a Server Component (`getSampleRequestById` called directly, no fetch round-trip) composing one Client Component, `SampleWorkflowPanel`, which renders context-appropriate action buttons per `request.status` (e.g. only `SUBMITTED_TO_CUSTOMER` shows the decision form) plus the version timeline, per-version material table, and comment thread — same "Server Component page + Client Component for the interactive part" split already established by Products' `VariantsSection`.
- **Gotcha (new)**: passing a Prisma query result containing `Decimal`/`Date` fields straight from a Server Component into a Client Component prop fails TypeScript (`Decimal` isn't `string`) and would fail at runtime too (`Decimal` instances aren't plain serializable objects across the RSC boundary). Fixed with `JSON.parse(JSON.stringify(request))` before passing down — `Decimal.toJSON()` and `Date.toJSON()` both produce plain strings, which is also what the client-side prop types expect. Watch for this on any future detail page whose model has a `Decimal` or `DateTime` field feeding a Client Component.
- Verified end-to-end in the browser through the full state machine on one real record: create → add Version 1 (tech pack) → add material → Start Development → Send to Internal QC → Submit to Customer → record `REVISION_REQUESTED` (confirmed Version 1 flips to `SUPERSEDED`, its approval history stays visible) → add Version 2 → Internal QC → Submit to Customer → record `APPROVED` (confirmed terminal state, all actions correctly hidden) → posted a comment. `npx tsc --noEmit` and `npm run lint` clean throughout.
- Not yet wired (explicitly out of scope until their own phase): the Sales-Order gate ("cannot confirm without an Approved Sample") is Phase 5 work — the FK design (`sales_order_items.sample_request_id`, `Product.sampleRequests`/`SampleMaterial.material` relations) is already in place to support it without a later migration.

### Phase 4 bugfix — Hold/Resume could skip version creation entirely (2026-08-18)
User-reported: a real request got stuck showing "Submitted to Customer" with **no way to record a decision** and no visible reason why. Root cause was a genuine state-machine design flaw, not a UI glitch — `ALLOWED_TRANSITIONS.REQUESTED` allowed a direct jump to `TECH_PACK_READY` (and `ON_HOLD`'s resume dropdown let the caller pick *any* of the 5 in-progress statuses as the target), so **Put On Hold → Resume to "Submitted to Customer"** from a brand-new `REQUESTED` request skipped `addSampleVersion` entirely, landing on `SUBMITTED_TO_CUSTOMER` with zero versions — and the decision form requires a version to attach the decision to, so it just silently didn't render. This doubled as the user's second complaint (the flow wasn't transparent) — the same design gap caused both the bug and the confusion.
- **Schema**: added `SampleRequest.statusBeforeHold` (nullable `SampleStatus`) — captures exactly which status a request was paused from.
- **Service**: `ALLOWED_TRANSITIONS.REQUESTED` no longer includes `TECH_PACK_READY` (that transition only happens by actually calling `addSampleVersion`, which creates version 1); `ALLOWED_TRANSITIONS.ON_HOLD` is now just `["CANCELLED"]` — resuming is a new dedicated `resumeSampleFromHold()` function that restores `statusBeforeHold` exactly, with no caller-chosen target at all, so this whole class of "skip past a required step" bug is closed structurally rather than patched with an extra `if`. `sampleStatusChangeSchema`'s Zod enum also dropped `TECH_PACK_READY` as a defense-in-depth second layer (confirmed live: a direct API call trying to set it now fails Zod validation with `400`, and a same-Zod-valid-but-illegal transition like `REQUESTED → SUBMITTED_TO_CUSTOMER` fails the service's state machine with `409 INVALID_STATE_TRANSITION`).
- **New route**: `POST /api/v1/sampling/[id]/resume` (replaces the old dropdown-driven generic status PATCH for resuming).
- **UX — made the whole flow visibly transparent, not just fixed**: added a horizontal step tracker (Requested → Tech Pack → Development → Internal QC → With Customer → Approved) at the top of the detail page showing exactly where a request stands, plus a one-line plain-English explanation of the current status and what to do next (`STATUS_HELP` map in `SampleWorkflowPanel.tsx`) — this was the user's actual ask ("flow ko transparent banao taaki samajh aaye kya ho raha hai"), not just the bug. The Hold/Resume UI changed from a dropdown of 5 options to a single "Resume to X" button showing the exact status by name.
- The user's own stuck record (`SAM-2026-00003`) turned out to already be self-resolved — they'd hit Cancel on it before this fix landed, which is a legitimate terminal state regardless of version count, so no manual data repair was needed.
- Verified live: created a fresh request, held it from `REQUESTED`, confirmed the panel showed "On hold from Requested" with a single unambiguous resume button, resumed, confirmed it landed back on exactly `REQUESTED`; then confirmed via direct `fetch()` calls from the browser console that both the old exploit paths now fail (`400` from Zod, `409` from the state machine).

### Security fix — cross-tenant write/read via Sample Materials endpoint (2026-08-19)
Found during a full multi-tenant architecture audit (user-requested, 20-section review — see session transcript): `addSampleMaterial()` in `sample.service.ts` fetched the target `SampleVersion` via `SampleVersionRepository.findById(id)` — a bare `prisma.sampleVersion.findUnique({ where: { id } })` with **no `companyId` check** — before inserting a `SampleMaterial` row and returning the full materials list for that version. Every other Sampling mutation (`recordSampleApproval`, `addSampleVersion`) already re-verified ownership via a `companyId`-scoped `SampleRequestRepository.findAnyById()` call; this one function was the sole exception, missed because there's no centralized/automatic tenant-scoping layer in this codebase (every repository function is manually parameterized with `companyId` — see the Phase C `*.repository.ts` pattern — so a single missed check like this doesn't get caught by anything but review or audit).
- **Impact**: any authenticated user, regardless of company, who obtained another tenant's `sampleVersionId` (a UUID — not guessable, but could leak via logs/URLs/referrer) could `POST /api/v1/sampling/versions/{id}/materials` and (a) insert a material row into that tenant's version, and (b) receive that tenant's full existing materials list back in the response — a cross-tenant write **and** read.
- **Fix**: `addSampleMaterial()` now calls `SampleVersionRepository.findWithRequestOwner()` (already existed, used by the decision route) and checks `version.sampleRequest.companyId === actor.companyId` before proceeding, throwing `NOT_FOUND` otherwise — the same pattern already correct everywhere else in this module.
- **Verified live**: created a temporary second tenant (company + user + sample request + version) in the dev DB, confirmed the existing Tenant-A session got `404 NOT_FOUND` attempting to add a material to Tenant B's version (previously would have silently succeeded), confirmed zero rows were written, then confirmed the legitimate same-tenant path still returns `201` with no regression. Temporary test tenant deleted afterward.
- **Not yet done** (explicitly out of scope for this fix, flagged in the audit for a separate pass): a full sweep of every other module's by-id repository functions for the same missed-`companyId` class of bug — this was the only instance found in the modules inspected, but the audit recommends a systematic sweep (P1) rather than assuming it's the only one. Also flagged, not yet fixed: file storage has no tenant-namespacing (currently harmless since no upload/download route exists yet), and `UserBranchRole` has no cross-tenant consistency check (currently harmless since no live role-assignment UI/API exists yet) — both noted as "fix before that feature is built," not urgent today.

### Security fix — P1 sweep found the same bug in 26 more entities across 7 modules (2026-08-19)
Followed through on the P1 recommendation above immediately rather than assuming the Sampling instance was isolated — it wasn't. Every `update*` function in the 7 `SimpleLookupManager`-backed modules had the **identical missing-`companyId`** flaw: `Repository.x.update({ where: { id }, data })` with no ownership check, for **26 entities total** — Brand/Category/Season/ProductFitting/ProductType/Design/DesignPattern/Pattern (garment-attributes, via the shared `makeSimpleLookupService` factory), FabricGsm/FabricDye/FabricWeaveType/FabricWidth/FabricComposition (fabric-config), Designation/EmployeeCategory/ShiftMaster/HolidayMaster (hr-config), ProductionStage/ProductionLine/Machine/SalesAgent (production-config), CostMaster (cost-master), PaymentType/BankAccount (finance-config), Color/Size (lookups — `UnitOfMeasure` excluded, it's deliberately global with no `companyId` column at all). Any authenticated user with `masters_core`/`masters_finance` "edit" permission — which most roles have — could `PATCH` another tenant's row by id and silently rename/deactivate/retype it.
- **Why `departments` wasn't affected**: `updateDepartment()` already called `getDepartmentById(actor.companyId, id)` first (throws `NOT_FOUND` if the id belongs to another company) before updating — the same safe pattern already used by all 5 "rich" modules (Customers/Suppliers/Employees/Warehouses/Products). The 7 simple-lookup modules were written faster/later and never got this check — a consistency gap between the "rich" and "simple" module patterns, not a one-off mistake.
- **Fix**: added the identical ownership check to every one of the 26 `update*` functions — `const existing = await Repository.x.findFirst({ where: { id, companyId: actor.companyId } }); if (!existing) throw NOT_FOUND;` before the `update()` call. For `garment-attributes`, fixed once in the shared `makeSimpleLookupService` factory (covers all 8 entities); the other 6 modules don't share a factory, so each of their 18 individual `update*` functions got the same two-line addition. No route-level changes needed — these entities have no separate `/status` sub-route, their `SimpleLookupManager` toggle already PATCHes the same now-fixed `update*` function.
- **Verified live**: same method as the Sampling fix — temporary second tenant + a `Brand` row in the dev DB, confirmed Tenant A's session got `404` PATCHing Tenant B's brand (previously would have silently renamed it to "HACKED"), confirmed the row was untouched in the DB afterward, then confirmed a real same-tenant PATCH still returns `200` with no regression. Temporary tenant deleted afterward. `npx tsc --noEmit` and `npm run lint` both clean after all 7 files.
- **Residual scope, not yet done**: this sweep covered every `update*` function (the mutation path an attacker would actually use). It did not re-audit every `findFirst`/`findMany` *read* path a second time beyond what the original architecture audit already checked (which found reads were consistently safe everywhere). The file-storage and `UserBranchRole` gaps noted above are still open, still low-priority until those features get a real UI.

### Phase 4 extension — Sample → Style graduation ("Convert to Style") (2026-08-19)
User's own architectural instinct, matched to how real garment ERPs actually work: an approved sample should be able to "graduate" into a permanent Style master, but only deliberately, not automatically — most real companies don't want every rejected/abandoned sample experiment cluttering the Styles catalog. Design was discussed and agreed before building (see session transcript for the fuller "how should Sampling relate to Production/BOM/Inventory" discussion, which stayed a "not yet, already planned for Phase 5/6" answer for everything except this one, genuinely Sampling-scoped addition).
- **Schema**: added `SampleRequest.styleName` (nullable at the DB level — existing rows predate it — but required going forward by the create-form's Zod schema). This closed a real display gap: previously, a sample for a *brand-new* style (`productId` null) had no name field anywhere, so it showed as blank/"—" throughout its entire lifecycle until someone eventually created a Style for it.
- **New action, `convertSampleToStyle()`**: only legal when `status === APPROVED` and `productId` is still `null` (throws `INVALID_STATE_TRANSITION` or `REFERENCED_RECORD_IN_USE` otherwise — confirmed live, a second conversion attempt on an already-linked sample correctly gets `409`). Creates a real `Product` (itemType STYLE) reusing the exact same style-code sequence (`advanceMasterCodeSequence(..., "STYLE")`) and duplicate-code check (`ProductRepository.findByStyleCode`) that Products' own create flow already uses — no parallel numbering mechanism. Links back via `SampleRequest.productId`. **Deliberately one-way and manual**: a small form (style name pre-filled from the sample, code pre-filled from the same next-code preview Products' own form uses, optional category/season) requires a human to review before the master is created — not a silent side effect of the approval click itself.
- **Deliberately NOT done**: `SampleMaterial` (the sample's planned-materials list) is *not* auto-copied into a BOM — BOM/MRP doesn't exist as a module yet (Phase 5); auto-generating a "BOM" now would mean building Phase 5's structure prematurely and inside the wrong module. The sample's own detail page remains the reference a merchandiser reads from when building the real BOM later. Color×Size variant generation also isn't duplicated into this flow — the "Convert to Style" success state links straight to the new Product's own detail page, which already has `VariantsSection` built (Phase 3) — reusing it beats rebuilding it inline.
- **Verified live end-to-end**: created a fresh sample with no linked style, ran it through the full state machine to `APPROVED`, converted it to a Style (auto-suggested `ST-00002`, picked a category and season), confirmed the created `Product` had the correct `customerId` (inherited from the sample), `categoryId`/`seasonId`/`styleCode`/`isActive`, confirmed the sample detail page updated to show a "linked to a Style master" link instead of the conversion form, followed that link to the real Product edit page and confirmed `VariantsSection` was there ready to use, then confirmed a second conversion attempt correctly fails with `409`. `npx tsc --noEmit` and `npm run lint` clean throughout.

### Phase 4 bugfix — stale sample data after client-side navigation between samples (2026-08-19)
User-reported: clicking the "linked to a Style master" link sometimes opened the *wrong* Product. Root cause: `<SampleWorkflowPanel>` (a Client Component holding `useState(initialRequest)`) was rendered without a `key` prop in `src/app/(dashboard)/sampling/[id]/page.tsx`. Next.js App Router doesn't remount a Client Component just because a prop changed — navigating client-side from `/sampling/A` to `/sampling/B` (e.g. via the list page's row link, or the breadcrumb) reused the *same* component instance, and `useState`'s initializer only runs on first mount, so the panel kept displaying sample A's `productId`/versions/materials under sample B's URL and header. Any link or action inside the panel that relied on `request.*` (as opposed to the `sampleRequestId` prop, which *does* update correctly) was silently acting on stale data — the "Convert to Style" link was the one the user happened to notice, but this affected the whole panel's displayed state, not just that link.
- **Fix**: added `key={id}` to `<SampleWorkflowPanel>` — forces a full remount (and therefore a fresh `useState(initialRequest)`) every time the `id` in the URL changes, even during client-side navigation.
- **Verified live**: opened SAM-2026-00010 (linked to Product `8aed6889…`), then client-side-navigated (via the list page, not a hard reload) to a different sample SAM-2026-00011 — confirmed the panel now shows SAM-2026-00011's own data (different customer, different version/materials) and its "linked to a Style master" link correctly points to Product `5f6e002e…`, which a direct DB query confirmed is that sample's actual `productId`. `npx tsc --noEmit` and `npm run lint` clean.
- **Followed up immediately rather than leaving it as a "worth checking" note**: swept all 7 `[id]`-based detail pages in the app for the same missing-`key` pattern — found it in **every single one**: `customers/[id]` (`CustomerForm` + `BuyersSection`), `suppliers/[id]` (`SupplierForm`), `employees/[id]` (`EmployeeForm`), `warehouses/[id]` (`WarehouseForm` + `LocationsSection`), `products/[id]` (`ProductForm` + `VariantsSection`), `materials/[id]` (`MaterialForm`) — 10 component instances across 6 files, all missing `key={id}`. Added it to every one. This means the bug wasn't Sampling-specific at all — every master's edit page could show stale data (and let a save silently update the *wrong* record) after a client-side navigation between two different records of the same type, e.g. clicking from one customer straight to another via the list page. Verified live on Customers: navigated client-side from "Zenith Apparel Imports" (CUST001, has a buyer) to "Urban Edge Retail" (CUST007, no buyers) and confirmed the form and buyers list both updated correctly instead of showing CUST001's data under CUST007's URL. `npx tsc --noEmit` and `npm run lint` clean across all 6 files.
- **Pattern to remember for every future `[id]`-based detail page**: any Server Component page that hands server-fetched data to a stateful Client Component (a `*Form` with `useState(initialValues)`, or a `*Section` with `useState(initialX)`) must pass `key={id}` on that component — Next.js App Router does not remount a Client Component just because a prop changed during client-side navigation, and `useState`'s initializer only ever runs on first mount.
- **Follow-up bug from this fix itself, caught immediately via a live console error**: `customers/[id]`, `products/[id]`, and `warehouses/[id]` each render *two* sibling keyed components (`CustomerForm`+`BuyersSection`, `ProductForm`+`VariantsSection`, `WarehouseForm`+`LocationsSection`) — giving both the same literal `key={id}` violates React's "keys must be unique among siblings" rule (React scopes key uniqueness to sibling position, not per-component-type), which threw a live "Encountered two children with the same key" console error. Fixed by suffixing each sibling's key distinctly (`key={\`form-${id}\`}`, `key={\`buyers-${id}\`}`/`key={\`variants-${id}\`}`/`key={\`locations-${id}\`}`) — same remount behavior, no collision. The single-component pages (`suppliers/[id]`, `employees/[id]`, `materials/[id]`, `sampling/[id]`) only ever had one keyed child each, so they were never at risk of this — **the rule going forward: a bare `key={id}` is fine for a lone keyed child, but as soon as a second sibling on the same page also needs `key={id}` for the same reason, both need distinguishing prefixes.**

### Phase 4 extension — Tech Pack attachments, and the first real use of the file-storage layer (2026-08-19)
User initially asked for uploads to land in `public/uploads` (matching the sibling `inventory` reference project's pattern). Investigated that reference app first rather than assuming it was a good pattern to copy: its uploads (`app/Http/Controllers/User/ProductController.php`, `SettingsController.php`) call PHP's raw `move(public_path(...))`, bypassing Laravel's `Storage` facade entirely — every uploaded file sits under the web root with **zero auth check**, reachable by anyone who has or guesses the URL, identically in "local" and "production" (the `S3`/`FILESYSTEM_DISK` config in that app's `.env.example` is unused dead scaffolding — confirmed no code path ever calls `Storage::disk('s3')`). Given this project just spent real effort fixing multi-tenant cross-tenant-access bugs, replicating that pattern would have reopened the exact class of hole just closed. Flagged this clearly and let the user decide with full information — they chose the private/authenticated route instead.
- **Storage root moved from `./storage` to `./uploads`** (`FileStorage.ts`) — same reasoning as before (outside `public/`, never directly web-servable), just renamed per the user's preferred folder name once the security tradeoff was understood. `.gitignore` and `.env.example` updated to match.
- **New shared core service**: `src/core/attachments/AttachmentService.ts` — `uploadAttachment`/`listAttachments`/`getAttachmentForDownload`/`deleteAttachment`, polymorphic via the existing `Attachment` model's `relatedModule`+`relatedRecordId` (no schema change — `Attachment` and its `RelatedModule.SAMPLE_REQUEST` enum value have existed since Phase 2 planning, just never had a real caller until now). Deliberately built as a `core/` service, not a Sampling-owned one, so Sales Orders/Purchase Orders/etc. can reuse it later without duplicating upload/download/delete logic — Sampling is just its first real consumer.
- **Routes**: `GET`/`POST /api/v1/sampling/[id]/attachments` (list/upload, `sampling` view/edit), `GET /api/v1/sampling/attachments/[attachmentId]/download` (streams the file with correct `Content-Type`/`Content-Disposition`, `sampling` view), `DELETE /api/v1/sampling/attachments/[attachmentId]` (`sampling` edit) — every one company-scoped through `getAttachmentForDownload`/`deleteAttachment`'s `findFirst({ id, companyId })` check, same safe-by-construction pattern as the rest of this session's tenant-isolation work.
- **Scope decision**: attachments are kept at the **sample-request level**, not per-version — avoids needing a new `RelatedModule` enum value or a version-scoped attachment table for what's still a first pass; upload date/filename make it easy enough to tell which round a file belongs to. Revisit only if real usage shows this is actually confusing.
- **Verified live**: uploaded a file via a direct `fetch()`+`FormData` call (the sandboxed browser tool can't drive a native OS file picker, so this exercises the exact same code path the real `<input type="file">` posts to), confirmed it landed on disk under `./uploads/` (not `public/`) with a random UUID name, confirmed the sample detail page's Attachments section listed it with correct name/size/uploader/date after a reload, downloaded it and confirmed `Content-Type: application/pdf` / `Content-Disposition: attachment` and byte-for-byte content matched, deleted it and confirmed both the DB row and the on-disk file were gone. `npx tsc --noEmit` and `npm run lint` clean throughout (one `react-hooks/set-state-in-effect` lint error hit and fixed along the way — inlining the initial fetch with `.then()` instead of calling a named async function from the effect body, matching the pattern already used for materials/units/categories/seasons in the same file).

### Phase 4 extension — shared `FilePreviewModal` (view-in-modal with zoom/rotate) (2026-08-19)
User asked for a **common/reusable** component, not a Sampling-specific one — built at `src/components/ui/FilePreviewModal.tsx` alongside `ConfirmModal`/`ToggleSwitch`, so any future module with attachments (Sales Orders, Purchase Orders, ...) can reuse it instead of re-implementing preview UI.
- **Behavior by file type**: images (`image/*`) get zoom (25%–400%, 25% steps) and 90°-increment rotate via a CSS `transform`, plus a "Reset" button; PDFs render in an `<iframe>` (the browser's own PDF viewer already has zoom, no need to duplicate it); anything else (Word/Excel) shows a "preview not available" message with a direct download button — no attempt to render those inline.
- **Required a small change to the download route** (`.../attachments/[attachmentId]/download/route.ts`): added `?disposition=inline` support (`Content-Disposition: inline` vs the existing default `attachment`) — without this, an `<img>`/`<iframe>` pointing at the existing force-download URL would trigger a save-as prompt instead of rendering. The plain download link/button (no query param) is unchanged and still forces a download.
- **Reset-on-open implemented via `key`, not an effect**: zoom/rotation reset by remounting (caller passes `key={attachment.id}`) rather than a `useEffect` that calls `setZoom(1)`/`setRotation(0)` when `open` becomes true — the latter tripped the same `react-hooks/set-state-in-effect` lint rule hit earlier in this session, and remount-via-key is the simpler fix (also correctly resets if the user switches from previewing one file straight to another without closing in between, which the effect-based approach would have gotten wrong).
- **Verified live**: uploaded a real 1×1 PNG and a fake PDF, confirmed the dialog opens with correct file-type-specific controls (zoom/rotate/reset for the image, iframe-only for the PDf), clicked zoom-in twice + rotate-right once and confirmed the image's CSS transform became `scale(1.5) rotate(90deg)` with the label reading "150%", clicked Reset and confirmed it returned to `scale(1) rotate(0deg)`, pressed Escape and confirmed the dialog unmounted. (Verification note: this session's browser-automation accessibility-tree reader didn't pick up the dialog's contents for some reason even though it was genuinely open, visible, and interactive — had to fall back to direct DOM queries via the JS console to confirm; the real functionality was never in doubt, just that one read-only inspection tool.)

### Phase 4 extension — attachment upload records the sample's stage (2026-08-19)
User wanted each attachment's display to show which stage it was uploaded during, alongside the existing timestamp — e.g. so a tech-pack file and a QC photo on the same request are visually distinguishable by when in the workflow they were added.
- Added `Attachment.contextLabel` (nullable `String`, `@map("context_label")`) — a generic, module-agnostic snapshot field, not FK'd to `SampleStatus` or any other enum, since `Attachment` is a shared polymorphic table used across every future module (Sales Orders, Purchase Orders, ...), not owned by Sampling.
- `uploadAttachment()` (`src/core/attachments/AttachmentService.ts`) takes an optional 5th `contextLabel` param and stores it as-is; the Sampling upload route (`.../sampling/[id]/attachments/route.ts`) fetches the sample's current `status` server-side via `SampleRequestRepository.findAnyById()` and passes it in — **never trust a client-supplied stage value**, since a user editing the request client-side could otherwise forge history.
- UI (`SampleWorkflowPanel.tsx`) maps the stored raw enum value back through the existing `STATUS_LABELS` map for display (falls back to the raw string if it's ever not a recognized key, since the column is intentionally not FK-constrained) — e.g. `68 B · Super Admin · Tech Pack Ready · 8/19/2026, 4:26:37 PM`.
- Migration: `add_attachment_context_label`. Verified live: uploaded a PNG to a request at "Tech Pack Ready", confirmed the API response and the reloaded page both showed `contextLabel: "TECH_PACK_READY"` rendered as "Tech Pack Ready" next to the timestamp; `npx tsc --noEmit` and `npm run lint` clean.

### Phase 4 extension — freely-editable `color` field on Sample Request (2026-08-19)
Real-world gap raised by the user: some clients hand over only a reference photo and let the factory decide everything; others specify a color upfront but may change their mind after seeing the physical sample. There was no structured place to capture this — only free-text `techPackNotes`/comments — so a color mentioned early had nowhere to live and no clean way to be revised later.
- Added `SampleRequest.color` (nullable `String`, no `@map` needed) — deliberately plain free text, not FK'd to the `Color` master or any enum, since this is a casual descriptive value a client states informally (unlike a Style's actual `Color` variant data used once Production begins) — matches the same "generic snapshot field, not over-modeled" reasoning already applied to `Attachment.contextLabel` above.
- **Deliberately editable at every status, including terminal ones** (`APPROVED`/`REJECTED`) — no state-machine restriction added, since the real trigger for a color change (customer feedback after seeing the physical sample) can happen at any point, and no business rule was requested to lock it. New scoped endpoint `PATCH /api/v1/sampling/[id]/color` (mirrors the existing `/status` sub-route pattern — a dedicated single-field route, not a reuse of the full header endpoint, since the header itself has none and stays intentionally identity-immutable) → `updateSampleRequestColor()` in `sample.service.ts`, company-scoped via `findAnyById` + audit-logged (`UPDATE`, old/new color values).
- Raw-material mentions from an informal client were deliberately **not** given a matching structured field — `techPackNotes` (free text, already exists on `SampleVersion`) already covers this; promoting an informally-mentioned material into a real `SampleMaterial` row (which requires linking an existing Materials-master entry) stays a manual merchandiser step, not automated, so as not to force premature master-data entry.
- UI: `SampleRequestForm.tsx` gained an optional Color input (between Style Name and the date fields); `SampleWorkflowPanel.tsx` shows "Color: <value or 'Not specified yet'>" right under the status badge with an inline Edit → Save/Cancel control (no page navigation needed to change it later).
- Migration: `add_sample_request_color`. Verified live end-to-end: created via the form, edited an existing request's color from empty to "Navy Blue" through the inline UI, confirmed it persisted after a full page reload (not just client state), then reverted the test value via a direct API call. `npx tsc --noEmit` and `npm run lint` clean.

### Phase 4 extension — Damage/Wastage tracking on Sample Materials (2026-08-19)
Agreed earlier (during the "should Sampling manage BOM/damage materials like Production" discussion) as a reasonable, genuinely Sampling-scoped addition — a merchandiser discovers, during actual sample-making, that some of a planned material got damaged/wasted (torn fabric, a broken trim, etc.), and there was previously no structured place to record it.
- Added `SampleMaterial.damagedQuantity` (nullable `Decimal(18,4)`) and `SampleMaterial.damageReason` (nullable `String`) — both independent of `plannedQuantity`, since damage is discovered after the material line already exists, not at planning time.
- New scoped endpoint `PATCH /api/v1/sampling/materials/:materialId/damage` → `recordSampleMaterialDamage()` in `sample.service.ts`, following the same "scoped single-field(-group) update sub-route" shape as the color endpoint above (now generalized in `COMMON_FEATURES.md` §6): company-scoped via a new `SampleMaterialRepository.findWithRequestOwner()` (joins `sampleVersion → sampleRequest.companyId`, mirroring the exact pattern that fixed this session's cross-tenant `addSampleMaterial` bug), audit-logged with old/new damage values.
- **Deliberately editable at any time, no state-machine restriction** — same reasoning as `color`.
- UI: the materials table on each version gained a 4th "Damaged / Wasted" column — shows a "Report damage" link when nothing's recorded, or the recorded qty + unit + reason with an inline Edit → Save/Cancel control once something is.
- **Bug caught and fixed during live verification**: the "has damage been recorded?" check was `m.damagedQuantity ? ... : "Report damage"` — but Prisma serializes `Decimal` fields to JSON as **strings**, so a legitimately-recorded `0` came back as the string `"0"`, which is truthy in JS, so it never actually hit the falsy branch by coincidence — the real bug was the reverse: after testing with a real value then attempting to "clear" it back to `0` (the damage endpoint's Zod schema requires a non-negative number, it can't accept `null`), the UI kept showing "0 PCS" as if damage were still recorded instead of returning to the empty state. Fixed by checking `m.damagedQuantity !== null` instead of truthiness — this also happens to be the more correct semantic anyway (an explicit recorded `0` means "inspected, confirmed no damage," which is meaningfully different from "never checked").
- Migration: `add_sample_material_damage_tracking`. Verified live end-to-end: clicked "Report damage" through the real UI (not just a direct API call), entered a quantity + reason, confirmed the PATCH request succeeded (200) and the table re-rendered with the recorded value and an Edit link, then reset the test row directly in the dev DB (the damage endpoint can't set it back to `null`, only to `0`, so a one-off script was used to fully restore the pre-test state) and confirmed both material rows showed "Report damage" again. `npx tsc --noEmit` and `npm run lint` clean throughout, including after the truthy-check fix.

### Phase 4 fix — Add Material's Unit now defaults from the material's own base UOM (2026-08-19)
User-reported UX gap: the "Add Material" row's Unit dropdown stayed blank after picking a Material, requiring a manual pick every time even though every Material master row already has its own `baseUomId` (its default unit of measure).
- No schema/API change needed — `GET /api/v1/materials` already returns each material's `baseUom` via `ProductRepository.findManyMaterials`'s existing `include: { baseUom: true }` (added back in Phase 3, just never consumed by this form).
- Client-side only fix in `SampleWorkflowPanel.tsx`: the Material `<select>`'s `onChange` now also looks up the selected material in the already-fetched `materials` list and sets `materialUomId` to that material's `baseUom.id` — falls back to empty if the material has no base UOM set. The Unit field **stays a normal editable dropdown**, not locked/disabled — this is a default, not an enforced value, in case one sample line genuinely needs a different unit than the master's default (e.g. buying thread by the roll normally but a small swatch by weight for this one sample).
- Verified live: selecting "Polyester Thread" (base UOM `ROL`) auto-selected `ROL` in the Unit dropdown; switching to "Cotton Fabric" (base UOM `MTR`) re-defaulted it to `MTR`; manually overriding to `YDS` afterward stuck (confirming it's a default, not a forced value). `npx tsc --noEmit` and `npm run lint` clean.

### Phase 4 fix — adding the same material to a version twice now merges instead of duplicating (2026-08-19)
User-reported (via screenshot): a version's materials table showed the same material (e.g. "Plastic Button 4-Hole") on two separate rows — confusing, looks like a data-entry mistake, and the table has no notes/reason column to explain a legitimate reason for two lines.
- `addSampleMaterial()` (`sample.service.ts`) now checks for an existing `SampleMaterial` row with the same `materialId` on that version (new `SampleMaterialRepository.findByVersionAndMaterial()`) before inserting. If one exists, it **merges**: the existing line's `plannedQuantity` is incremented by the newly-added quantity (and its `uomId`/`notes` are updated only if the new call actually supplied them), audit-logged as `UPDATE`. Only when no line exists yet does it fall back to the original `createMany` insert, audit-logged as `CREATE`.
- No new UI needed — from the user's perspective, "adding" the same material again just increases its quantity in place rather than requiring a separate quantity-edit control.
- Verified live end-to-end through the real Add Material form: added "Plastic Button 4-Hole" with qty 3 (created), then added it again with qty 5 — confirmed via the API response that the row's `id` stayed the same and its quantity became 8, with zero new rows created. Test row removed afterward. `npx tsc --noEmit` and `npm run lint` clean.

### Phase 4 refinement — material merge now keyed on a matching-attributes set, not just materialId (2026-08-19)
User pushed back on the merge fix above (correctly): blindly merging on `materialId` alone is wrong for real garment sampling, where the same material can legitimately need multiple lines — different color, spec/variant, or usage/purpose (e.g. "for main body" vs "for collar trim"). The fix needed a real matching-attributes key, not a single-field one, and needed to be built so **future distinguishing attributes (color, specification, usage/purpose) can join the key later without rewriting the merge algorithm** — none of those three exist as `SampleMaterial` columns yet, only `materialId` and `uomId` (Unit) are real today.
- Added `MATERIAL_MERGE_KEY_FIELDS = ["materialId", "uomId"] as const` in `sample.service.ts` — the single source of truth for which attributes must match for two "add material" calls to merge. Adding color/specification/usage later means: add the column + schema field, then add its name to this array — the merge function and repository call are untouched.
- `buildMaterialMergeKey(input)` builds a `Prisma.SampleMaterialWhereInput` generically by looping over that field list (with a documented, deliberate type cast — Prisma's per-field types differ, e.g. `materialId` is non-nullable and `uomId` isn't, which a loop over a plain field-name list can't statically know). `SampleMaterialRepository.findByVersionAndMergeKey()` replaces the old materialId-only lookup and just spreads whatever key it's given.
- Removed the old merge behavior's `uomId: input.uomId || existing.uomId` — that line was silently overwriting the unit on merge, which is exactly the kind of attribute-loss the user was flagging; now that `uomId` is part of the merge key, a merge only ever happens when it already matches, so there's nothing to overwrite.
- Verified live via direct API calls simulating the real Add Material flow: added "Metal Zipper 7 Inch" as 4 PCS then 6 PCS → merged into one row at 10 PCS; then added the same material as 1 DZN → correctly created a **separate** line (different unit); a further 2 DZN merged into that second line → 3 DZN. Confirmed both PCS and DZN lines coexist as distinct rows, proving same-material-different-attribute lines are preserved rather than merged. Test rows removed afterward. `npx tsc --noEmit` and `npm run lint` clean.

### Phase 4 extension — Color select on Sample Material lines (2026-08-19)
First real use of the `MATERIAL_MERGE_KEY_FIELDS` extensibility built for exactly this: the user asked for a Color selector on material lines, and this is the first of the originally-requested attributes (Color/Specification/Usage) to actually get built as a real column.
- Added `SampleMaterial.colorId` (nullable UUID FK to the existing `Color` master, same table Products/Variants already use — no new lookup table) + the `Color.sampleMaterials` back-relation.
- **Adding it to the merge key was a one-line change** exactly as designed: `MATERIAL_MERGE_KEY_FIELDS` went from `["materialId", "uomId"]` to `["materialId", "uomId", "colorId"]` — `buildMaterialMergeKey()` and the merge algorithm in `addSampleMaterial()` were untouched, confirming the extensibility mechanism built earlier this session actually works as intended, not just in theory.
- UI: the materials table gained a "Color" column (swatch dot from `Color.hexValue` + name, or "—" when none), and the Add Material row gained an optional Color `<select>` (populated from the existing `/api/v1/colors` endpoint) alongside Material/Qty/Unit.
- Migration: `add_sample_material_color`. Verified live: added "Metal Zipper 7 Inch" as 4 + 6 pcs in Navy Blue → merged to 10 (same color); added 2 more in Black → correctly created a **separate** line instead of merging or overwriting the color, confirmed the table rendered both rows with correct swatches and names. Test rows removed afterward. `npx tsc --noEmit` and `npm run lint` clean.
- **Deliberately deferred** (per explicit user scope): the Sample Request header's own free-text `color` field (added earlier this session) was *not* converted to a Colors-master select in this pass — user chose to add material-line color selection only for now.

### Phase 4 fix — file input kept showing the previous file's name after upload (2026-08-19)
User-reported: uploaded a file (`WIN_20260805_13_00_31_Pro.jpg`), and the file-picker input next to the Upload button kept displaying that same filename afterward instead of resetting — looked like the file hadn't actually changed/uploaded.
- Root cause: `<input type="file">` is **uncontrolled** in React — there's no `value` prop it can accept, so `setUploadFile(null)` after a successful upload cleared the component's own state but had no effect on what the native DOM input visually displays. The browser keeps showing the last-selected filename until the input element itself is reset or remounted.
- Fix: added an `uploadInputKey` counter, bumped in `uploadAttachment()` right after `setUploadFile(null)`, and passed as `key={uploadInputKey}` on the `<input type="file">` — forces React to remount the input on every successful upload, which clears its displayed value. Same remount-via-key technique already used elsewhere in this file (`FilePreviewModal`'s zoom/rotate reset, the `[id]` detail-page stale-navigation fixes) — the standard fix whenever `useState` can't reach into an uncontrolled/native element's own display state.
- Verified live: selected a file via a simulated `DataTransfer` (the sandboxed browser tool can't drive a native OS file picker), confirmed `fileInput.files[0].name` showed it pre-upload, clicked Upload, confirmed the attachment appeared correctly in the list, then confirmed `fileInput.files.length === 0` and `fileInput.value === ""` post-upload — the input is now genuinely empty, not just showing an empty *React* state while the DOM disagreed. Test attachment removed afterward. `npx tsc --noEmit` and `npm run lint` clean.

### Phase 4 extension — Sampling worklist: server-side filters, sorting, and a real filter panel (2026-08-19)
User asked for the Sampling list to become a practical worklist (Request Number/Customer/Buyer/Style/Status/Requested By/Request Date/Color filters, collapsible panel, active-filter count, sortable columns, server-side filtering) — with an explicit instruction to analyze what's supported today vs. what needs new schema/API before building anything, and to reuse existing masters/APIs rather than duplicate them.

**Analysis delivered before implementation** (see session transcript for the full breakdown): every filter maps onto an existing column/relation except "Requested By" (no Users list API existed anywhere in the app) — added a minimal `GET /api/v1/users` (id+fullName, company-scoped, `ACTIVE` only), same no-module-needed pattern as the existing `/api/v1/currencies`. **Two requested filters were deliberately not built** as separate concepts: "Sampling Stage/Current Stage" is not a second field — it's the same 12-value `SampleStatus` state machine already driving the Status filter, so building a second "stage" filter would duplicate it. "Buyer Approval/Approval Status" also wasn't added — the header's own `Status` already terminates in `APPROVED`/`REJECTED` and covers `REVISION_REQUESTED`, so selecting those in the Status filter already achieves this; the real per-version `SampleApproval.decision` history is a different, deeper concept than a header-level current-status filter. "Priority" was skipped entirely — it doesn't exist anywhere in the schema or roadmap, consistent with the user's own "only add if appropriate" instruction.

- **Backend** (`sample.schema.ts`/`sample.service.ts`/`sampling/route.ts`): new `sampleRequestListFiltersSchema` (Zod-validates customerId/buyerId/requestedByUserId as real UUIDs, rejects malformed ones with a clean `400 VALIDATION_ERROR` rather than letting a bad UUID hit Prisma raw). `listSampleRequests()` now builds a real `Prisma.SampleRequestWhereInput` from customerId/buyerId/requestedByUserId (equals), `status` (comma-separated list intersected against `Object.values(SampleStatus)` — **the Prisma-generated runtime enum object is the existing status source reused here, not a second hardcoded list**, satisfying the user's explicit "don't hardcode" instruction), `color` (case-insensitive contains), `styleSearch` (OR across the free-text `styleName` and the linked `product.styleName`, since a request may have either or both), and `dateFrom`/`dateTo` (gte/lte on `requestDate`). Added `buildSampleRequestOrderBy()` for relation-aware sorting (`customer.name`/`buyer.name` need a nested Prisma orderBy object the shared `{[sortBy]: sortOrder}` pattern used by every other list endpoint can't express) — kept local to this module, not generalized into `list-query.ts`, since no other module needs relation sorting yet. Default sort changed to `requestDate desc` (was `createdAt`) — "latest requested first" per the ask.
- **Buyer filter cascades from Customer** rather than a new flat "all buyers" endpoint — reuses the exact same `/api/v1/customers/:id` → `.buyers` call the create form already makes. No new API for this.
- **Frontend**: `SamplingFilters.tsx` (new) — a collapsible panel showing "Filters" / "Filters (N)" (active-filter count computed from the currently *applied* filters, not the in-progress draft), with Customer/Buyer/Style/Requested By/Color/Request-Date-range-with-Today/This-Week/This-Month-presets/Status-checkboxes (checkbox labels come from the existing `STATUS_LABELS` map — same reasoning as the backend, one existing source, not re-hardcoded), and Apply Filters/Clear All buttons. Filters are staged in a local `draft` and only take effect on Apply, matching the requested UX exactly. `page.tsx` was rewritten from the generic `DataTable`-based list into a purpose-built worklist table: sortable column headers (Customer/Buyer/Style/Status/Request Date, click to sort, click again to reverse) with an arrow indicator, a "N sample requests found" count, and Prev/Next pagination that carries the current filters/sort/page together in every fetch (all client-side state — filters are not lost on pagination). Deliberately **not** merged into the shared `DataTable` component — that component is used by ~12 simple masters lists and adding this much filter/sort machinery to it would risk regressing all of them for a feature only Sampling needs today; revisit only if a second module needs the same worklist pattern.
- **Two `react-hooks/set-state-in-effect` lint errors hit and fixed** (same rule as earlier this session): the Buyer-list-reset-on-customer-clear now happens in the Customer `<select>`'s `onChange` itself (mirroring `SampleRequestForm.tsx`'s existing pattern) instead of an effect branch; the "sync local draft back to the applied value on Clear All" need was replaced with the established **remount-via-`key`** convention (`filtersResetKey`, bumped only on Clear All) instead of an effect that calls `setDraft(value)`.
- **Follow-up bug caught during live verification, not just claimed**: bumping `filtersResetKey` remounts the whole `SamplingFilters` component, which was *also* resetting its own `isOpen` panel state back to closed — so clicking Clear All silently collapsed the filter panel, a real UX regression from the fix above. Caught by testing Clear All in isolation and noticing "Clear All" was no longer findable on the next interaction. Fixed by lifting `isOpen`/`onToggleOpen` up into `page.tsx` as a controlled prop, so the key-driven remount only resets the draft/lookup-list state, never the panel's open/closed state.
- **Verified live end-to-end**, each independently: Customer filter (13 → 6 results) with "Filters (1)" updating correctly; combined Customer+Status=Cancelled (→ 1, "Filters (2)"); Clear All (→ back to 13, panel stays open); column-header sort on Customer both directions (alphabetical asc/desc confirmed row-by-row); Color filter via a temporary real value ("Navy Blue" set → `?color=navy` found exactly that record, case-insensitive — reverted after); Style search matching both an exact and a "test"-suffixed style name; a Request Date range matching the expected count; sortBy=styleName; and a malformed `customerId` query param correctly returning `400 VALIDATION_ERROR` instead of a raw 500. `npx tsc --noEmit` and `npm run lint` clean throughout, including after both lint-rule fixes.

### Phase 5A — Sales Orders, complete (2026-08-20)
First slice of Phase 5, built per a plan reviewed and approved beforehand (mirroring Phase 4's design→build→verify rhythm): a 3-table Sales Order module gating confirmation on Sample approval, built to the exact conventions established by Sampling.

- **Schema (3 new tables, 1 new enum)**: `SalesOrder` (header — customer/buyer, currency snapshot frozen at creation, `statusBeforeHold` Hold/Resume field reused verbatim from `SampleRequest`'s pattern), `SalesOrderItem` (one per Style line, `sampleRequestId` nullable **per-item, not per-header** — matches the original architecture doc's literal field placement, since one order can carry several style lines each tracing to a different sample or none at all), `SalesOrderItemBreakdown` (the size/color qty matrix, FK'd to the *existing* `ProductVariant` rather than duplicating raw colorId+sizeId — exactly the case that table was built for). `SalesOrderStatus` has the full 9-value roadmap enum, but only `DRAFT/CONFIRMED/ON_HOLD/CANCELLED` are reachable through this phase's own code — `IN_PRODUCTION` is reserved for 5C to set as a side effect of creating a Production Order, `PARTIALLY_DISPATCHED/DISPATCHED/INVOICED/CLOSED` for Phase 7/8 — same "enum has values nothing reaches yet" discipline as `SampleStatus.DRAFT`. `DocumentType.SALES_ORDER` already existed with prefix `ORD` (not `SO` as the initial plan draft assumed — corrected during design review by actually reading `DocumentNumberingService.ts` instead of guessing) — numbers render as `ORD-2026-00001`, no changes needed to that shared file.
- **Sample approval gate** (`confirmSalesOrder()` in `sales-order.service.ts`): loops every item with a non-null `sampleRequestId` and requires `SampleRequest.status === APPROVED`; blocks with `409 INVALID_STATE_TRANSITION` otherwise. A Management override (a required reason, audited) is gated behind the `approve` RBAC action on the already-seeded `sales_orders` module, **and** self-approval-guarded via `PermissionService`'s existing `resourceContext.createdBy` mechanism — the exact same check already proven on Sampling's Approve action, not a new mechanism. Items with no linked sample skip the gate entirely (a repeat/direct order needs no sample at all).
- **Currency defaulting**: `currencyCode` defaults to `customer.defaultCurrencyCode ?? company.baseCurrencyCode` (both fields already existed, just previously unused for this purpose) — frozen at creation alongside `exchangeRate`/`baseCurrencyCode`/`baseTotalAmount`, matching the project's multi-currency design decision (base amounts stored, not computed live). No currency picker in the UI — multi-currency UI stays deferred project-wide.
- **RBAC**: `sales_orders` module and its full per-role action matrix were already seeded back in Phase 1 planning — zero changes needed, exactly like Sampling.
- **Design review caught a real gap before implementation**: the original 13-state `ProductionOrder` sketch for 5C assumed a fixed enum pipeline (Planned→CuttingInProgress→...→Closed) — user correctly flagged that `ProductionStage` already exists (Phase 3) as a company-configurable, reorderable master, so hardcoding stage names into an enum would contradict that and block a company from ever inserting a new stage (e.g. Embroidery) without a migration. Revised to a two-layer model (a small universal `ProductionOrderStatus` lifecycle enum + fully dynamic stage progress driven by `ProductionStage.sequence`) — see the reviewed plan and the published **Production Schema Blueprint** artifact for the full 5C design, deepened further with a direct code-level analysis of a reference denim-manufacturing system's actual production schema (confirmed the generic stage-transition-ledger approach; found concrete evidence for why a `stage_id_1..12` wide-column design is a real anti-pattern to avoid; added a `ProductionOrderStageProgress` cache table and a `ProductionStageTransactionDetail` child table modeled directly on that system's own proven shape). None of this schema is implemented yet — 5C is still design-only, reviewed and ready for its own build pass.
- **UI**: list page reuses the plain `DataTable` component as-is (not a custom worklist like Sampling's — that was purpose-built because it was explicitly asked for there; revisit only if Sales Orders needs the same treatment later). New-order form (`SalesOrderForm.tsx`) has a Customer→Buyer cascade, an "Approved Sample" picker per style line that reuses the *just-built* Sampling filters API (`GET /api/v1/sampling?status=APPROVED&customerId=...`) — a direct payoff of that earlier work — and a live variant×quantity grid sourced from the selected style's own `ProductVariant`s via the existing `/api/v1/products/:id` endpoint, with the order total computed client-side as items are entered. Detail page follows the established "Server Component page + one Client Component panel" split (`SalesOrderWorkflowPanel`, same shape as `SampleWorkflowPanel`), including the confirm-blocked → inline override-reason-field → "Confirm Anyway" flow.
- **Verified live end-to-end** through the real UI, not just API calls: created a real order (Customer→Style→Variant-grid→Sample-link, all through the actual form) that correctly computed its live total, submitted it, confirmed it (sample already Approved, no gate friction) — landed on `ORD-2026-00001`; separately created an order linked to an *unapproved* sample, confirmed the Confirm button correctly surfaced the block message and revealed the override UI, filled a reason, clicked "Confirm Anyway," confirmed it succeeded; tested Hold → Resume (landed back on the exact prior status, mirroring the specific test that caught Sampling's original Hold/Resume bug) and Cancel from both Draft and Confirmed; confirmed a terminal-state transition attempt (`CANCELLED → ON_HOLD`) correctly fails with `409`. Test orders removed afterward, kept the one real end-to-end demo order. `npx tsc --noEmit` and `npm run lint` clean throughout.
- **Not yet built** (explicitly deferred per the reviewed plan, not oversights): order Amendment/versioning ("Amended creates a new version, prior locked" — deferred until real usage shows what actually needs to change post-confirmation), "Cancel blocked past Cutting without Management override" (no Cutting exists yet to block past), multi-currency UI. Next up: **5B — BOM & MRP**, its own reviewed design pass before implementation.

### Phase 5A fix — line/order totals didn't read as money (2026-08-20)
User feedback after reviewing the New Sales Order form live: "Line total: 3750" and "Order Total: 3750" rendered as bare numbers — nothing told the user these were currency amounts.
- Renamed to "Line Amount"/"Order Amount" everywhere in the module (create form, detail page, list column) for consistency.
- Create form now shows a live currency-symbol-prefixed preview (e.g. `₹100,000`) that mirrors the server's own currency-defaulting logic exactly: the selected customer's `defaultCurrencyCode` first, falling back to the company's `baseCurrencyCode` — needed a new minimal `GET /api/v1/company` endpoint (same no-module-needed pattern as `/api/v1/currencies`/`/api/v1/users`) since nothing previously exposed the company's base currency to the client. Caught during verification that most seeded customers have no `defaultCurrencyCode` set, which would have silently shown no symbol at all without the fallback — confirmed live that both paths resolve correctly (`₹` via the company fallback for a customer with no currency of its own).
- Detail page and list page already showed the ISO code (e.g. "INR 3,750") — left as-is (an ISO code next to a number is already unambiguous), just renamed the label for consistency with the form.
- `npx tsc --noEmit` and `npm run lint` clean.

### Phase 5A fix — variant quantity grid rebuilt as a real Color×Size matrix (2026-08-20)
User-reported (with a screenshot): the flat variant list ("Black /...", "Navy ...") truncated color/size names illegibly, and entering quantity one cell at a time with many size/color combinations was tedious — asked for three entry modes: one color across all sizes, one size across all colors, and single-cell.
- `VariantQuantityGrid` (new component in `SalesOrderForm.tsx`) replaces the flat `grid-cols-3` list with a real `<table>`: colors as rows, sizes as columns (sorted by the existing `Size.sortOrder`), so both dimensions are always fully legible — no truncation possible since each gets its own header cell.
- Each row header (color name) and column header (size name) carries a small "fill" input + button (`→` for the row, `↓` for the column) — filling that entire row/column in one action via a batched `onChange` patch, alongside the existing per-cell input for single (color, size) entry. This is the same "same underlying update, three entry granularities" shape rather than three separate UIs.
- `setQuantity(index, variantId, qty)` generalized to `setQuantities(index, patch: Record<string, string>)` so both a single-cell edit and a row/column bulk-fill go through the same state update path.
- Verified live: selected "Printed Casual Shirt" (3 colors × 4 sizes), confirmed the table renders full names with zero truncation; set Black/Medium directly (single-cell); row-filled White across all 4 sizes with one value; column-filled "Large" across all 3 colors with a different value — confirmed the shared cell (White/Large) correctly took the *later* fill's value, proving both mechanisms write through the same state. `npx tsc --noEmit` and `npm run lint` clean.

### Phase 5A fix — variant grid alignment (2026-08-20)
User-reported (with a screenshot): the grid's columns didn't line up — row-fill inputs sat at a different x-position per row since they followed variable-length color names ("Black" vs "Navy Blue") in a plain flex row, and the header fill-controls lived awkwardly stacked inside the size-name `<th>` instead of their own row. Asked to confirm scope first: purely a visual/alignment fix, not a change to where colors/sizes come from (they're already sourced from the real Color/Size masters via each style's `ProductVariant`s — confirmed with the user this is correct as-is).
- Rebuilt the table with `table-fixed` + an explicit `<colgroup>` (name column, a dedicated "Fill" column, then one fixed-width column per size) — this is what actually guarantees pixel-identical column boundaries across the header, the new dedicated column-fill row, and every data row; a plain auto-layout table can't promise that once cell content varies in length.
- Row-fill controls moved into their own dedicated column (not inline next to the color name) — so they align under the header's own "Fill" label and never shift based on name length.
- Column-fill controls moved into a dedicated row right under the size-name header row, instead of stacked inside the same `<th>` as the label.
- Visually distinguished the two input kinds: real quantity cells use the app's normal solid-border input style; the 7 "fill" controls (one per row + one per column) use a smaller, dashed-border, muted style so it's clear at a glance which boxes are bulk-set controls versus actual order quantities.
- Verified via `getBoundingClientRect()` (not just eyeballing): every row header starts at the identical x-coordinate regardless of color-name length, every row-fill input starts at the identical x-coordinate, and the header/fill-row/data-row column boundaries are pixel-identical across all three. Re-ran all three fill modes (single-cell, row-fill, column-fill) against the new markup to confirm behavior didn't regress. `npx tsc --noEmit` and `npm run lint` clean.

### Phase 5A fixes — Linked Sample not scoped to the line's Style, currency preview simplified to ₹ (2026-08-20)
Two more user-reported issues from live use of the New Sales Order form.
- **Linked Sample dropdown ignored the selected Style**: it was scoped only by `customerId`, so a customer with approved samples for multiple different styles saw all of them on every line, regardless of which Style that line was actually for — a V-Neck T-Shirt line could show a Round Neck T-Shirt's sample as a linkable option, which makes no sense for the Sample→Order traceability this field exists for. Fixed by filtering `approvedSamples` client-side on `sample.product?.id === item.productId` (the data was already being fetched, just never filtered by style) — the dropdown is now disabled with a "Pick a Style first" hint until a Style is chosen, mirroring the existing "Pick a Customer first" pattern for Buyer, and shows "No approved samples for this style yet" when the filtered list is empty. Verified live: Zenith Apparel Imports has approved samples for both V-Neck T-Shirt and Round Neck T-Shirt — selecting the V-Neck line now shows only its own matching sample, not both.
- **Currency preview simplified to a fixed ₹**: the live Line/Order Amount preview had been dynamically resolving a currency symbol from customer/company data (added earlier this session) — correct in principle, but unnecessary complexity for a business that only operates in INR today, and multi-currency UI is explicitly deferred project-wide anyway. Simplified to a fixed `₹` prefix; removed the now-unused `/api/v1/company` endpoint (built solely for this lookup, no other caller) and the `currencies`/`baseCurrencySymbol` state and fetches. The order's actual stored `currencyCode` is unaffected — still set correctly server-side from `customer.defaultCurrencyCode ?? company.baseCurrencyCode`; this only simplified the client-side live-preview display.
- `npx tsc --noEmit` and `npm run lint` clean.

### Phase 5A extension — cross-customer sample search, and generating variants inline from the order form (2026-08-20)
Two more real gaps surfaced from live use, plus a design question about the Sample→Order flow answered directly rather than built.
- **"Without sampling" already works as-is** — a user asked how to bypass the Sample→Order flow for a direct/repeat order. No change needed: `SalesOrderItem.sampleRequestId` is nullable per-item, and leaving "Linked Sample" as "— None —" skips the approval gate entirely. This was already the intended design (see the original 5A note above), just not obviously discoverable — worth remembering if it comes up again as a UX/labeling question rather than a missing-feature one.
- **Cross-customer sample linking**: a real scenario — Customer A wants to order against a sample that was actually made/approved for Customer B (or a showroom/development sample). Added a "Search approved samples from all customers" checkbox on the create form (off by default, so the common case — a customer's own approved samples — is unaffected); when on, the sample fetch drops the `customerId` filter and searches company-wide, still narrowed to the line's own Style client-side same as before. `SalesOrderItem.sampleRequest`'s repository select was extended to include the sample's own `customer.name`, and the detail page (`SalesOrderWorkflowPanel.tsx`) now shows "(Customer: X)" next to the linked sample whenever it differs from the order's own customer, so nobody reading the order later mistakes it for that customer's own sample. Verified live: ROMANCHAL NAYAK's order linked to Zenith Apparel Imports' `SAM-2026-00001` — company-wide toggle correctly surfaced it, and the detail page correctly annotated the customer mismatch; confirmed the sample-approval gate itself doesn't care which customer the sample belongs to (correctly, since the gate is about the design being proven, not who owns it).
- **Inline "Generate Variants" when a Style has none yet**: user hit `VALIDATION_ERROR: items.0.breakdown: At least one size/color line is required` — the selected Style had zero `ProductVariant`s generated (confirmed live this is the *common* case, not rare — most seeded styles have none), so the quantity grid had nothing to show and the order couldn't be created at all. Rather than forcing a context-switch to Masters → Products → that style → Variants, added `InlineVariantGenerator` directly on the Style Line — the exact same Color/Size checkbox picker and `POST /api/v1/products/:id/variants/bulk` endpoint already built in Phase 3's `VariantsSection.tsx`, just reused inline. Shown only when a Style is selected and has no variants; on success, refetches that style's variants and the quantity grid appears immediately, no page reload. Verified live end-to-end: "Slim Fit Formal Trouser" (zero variants) → picked Black/Navy Blue/White × Small/Medium/Large → generated exactly 9 real, persisted `ProductVariant` rows → grid appeared immediately with all 9 correctly labeled.
- `npx tsc --noEmit` and `npm run lint` clean throughout.

### Phase 5A extension — file attachments, a barcode, and Design Number (2026-08-20)
Four requests in one message; one was a design decision, three were straightforward reuse of existing infrastructure.
- **Make-to-stock (no customer) production — deliberately NOT built here.** User asked how to model a company manufacturing for its own stock with no customer. Decided (with the user) that a `SalesOrder` always represents a real customer sale — a "Make to Stock" run will be a Production Order created directly in 5C without any Sales Order at all, rather than making `customerId` nullable and blurring what this table means. Noted for when 5C is designed.
- **File attachments**: reused `AttachmentService` verbatim (`RelatedModule.SALES_ORDER` already existed in the schema from Phase 1/2 planning, just had no caller until now) — same three-route shape as Sampling's attachments (`[id]/attachments`, `attachments/[attachmentId]`, `attachments/[attachmentId]/download`), same `contextLabel` snapshot (the order's `status` at upload time, fetched server-side), same `FilePreviewModal` UI. Verified live: uploaded a file to a Confirmed order, confirmed it displayed "Confirmed" as the context label, downloaded/deleted correctly.
- **Barcode**: added a new shared `src/components/ui/Barcode.tsx` (Code128 via the `jsbarcode` package, a new dependency) encoding the order number — rendered on the Server Component detail page (no need to thread it through client state, it's static). Deliberately a shared component, not Sales-Order-specific, so Production Orders/Dispatch can reuse it later without a second barcode library. Verified live: a real SVG with 50 bars rendered for `ORD-2026-00001`.
- **Design Number**: added `Product.designNumber` (nullable string) — some companies identify a style primarily by design number rather than style code/name (confirmed as a real, actively-used field in the Royal Jeans reference schema during the earlier sales-order analysis). Added to `ProductForm.tsx` (Masters → Styles), and surfaced on the Sales Order create form's Style dropdown (`"V-Neck T-Shirt (Design: DN-4521)"`) and the order detail page's style-line header — the two places this session's requester actually needs to see it, not force-added everywhere Style appears.
- **Gotcha hit while migrating**: the `add_product_design_number` migration got created with a copy-pasted, misleading folder name (`..._add_sample_request_style_name`) from stale shell history. Caught before it became permanent history — renamed the migration folder and corrected the corresponding row in `_prisma_migrations.migration_name` directly (safe since this is local dev-only and nothing else had pulled it yet); `npx prisma migrate status` confirmed clean afterward. Worth double-checking migration names match their actual content before moving on, especially when copy-pasting a previous migrate command.
- `npx tsc --noEmit` and `npm run lint` clean throughout.

### Phase 5A fix — order currency always follows the company, not the customer; Edit capability for Draft/Confirmed orders (2026-08-20)
Two more issues from live use: currency showing USD on an order whose customer happens to have `defaultCurrencyCode = "USD"` seeded ("Order Amount: USD AA RHA HAI Ruppe chahiye"), and no way to correct a Sales Order at all once created — including after Confirm, which the user explicitly wanted.

- **Currency fix**: `createSalesOrder()` previously set `currencyCode = customer.defaultCurrencyCode ?? company.baseCurrencyCode` — technically correct multi-currency design, but premature since this business only transacts in INR today (the same reasoning that already simplified the client-side amount preview to a fixed ₹ earlier this session). Simplified to `currencyCode = company.baseCurrencyCode` unconditionally. The one real order affected (`ORD-2026-00006`, created against a USD-default customer before the fix) was corrected directly in the DB (`currencyCode: "USD" → "INR"`, matching what it would have been created as post-fix). `Customer.defaultCurrencyCode` itself is untouched — this only changed which field the order-creation flow reads from.
- **Edit capability, per the user's explicit choice** ("Edit block, naya order banao" was the *rejected* option — user wants editing, not "cancel and recreate"): new `updateSalesOrder()` in `sales-order.service.ts`, allowed only while `status` is `DRAFT` or `CONFIRMED` — any other status (`ON_HOLD`, `CANCELLED`, and future `IN_PRODUCTION`+) throws `INVALID_STATE_TRANSITION` with a message pointing at creating a new order instead, which is where the *other* AskUserQuestion answer this session ("customer wants to add more to an order already in production → new order, don't reopen it") actually landed: editing stays possible right up to Confirmed, but stops being safe once Production exists to consume the order's committed quantities.
- **Editing a Confirmed order re-runs the sample-approval gate** — extracted the gate-check that `confirmSalesOrder()` already had into a shared `assertSamplesApprovedOrOverride()` helper, now called from both `confirmSalesOrder()` and `updateSalesOrder()`. Editing in a sample-request-id for a still-unapproved sample is blocked exactly like confirming would be, with the same Management-override-with-reason escape hatch (self-approval-guarded, same as everywhere else this pattern's used) — an edit to a Confirmed order can't be used to sneak an unapproved style in without the same gate a fresh confirm would apply.
- **`SalesOrderRepository.replaceItems()`** — a full delete-and-recreate of items/breakdown inside one `$transaction`, rather than hand-diffing which lines changed. Simplest correct option for a header+2-level-detail structure with no independent lifecycle per line (unlike Sampling's append-only versions, an order line has no history worth preserving line-by-line) — a mid-transaction failure never leaves a partial item list since it's one atomic write.
- **UI**: new `src/app/(dashboard)/sales-orders/[id]/edit/page.tsx` (Server Component, `notFound()` if the order isn't Draft/Confirmed — mirrors the service's own guard so a stale bookmark to a Cancelled order's edit page fails the same way the API would), reusing `SalesOrderForm` in a new dual-mode (`initialOrder` prop pre-fills customer/buyer/dates/items/quantities; submit does `PATCH` instead of `POST`). An `EditLink` was added to `SalesOrderWorkflowPanel.tsx`'s action rows for both Draft and Confirmed states. The blocked-by-gate → override flow on the edit form mirrors the confirm panel's existing pattern exactly (amber notice, override-reason field, "Save Anyway" button) rather than inventing a second UX for the same concept.
- **Lint gotcha**: the effect that pre-fills each line's variant grid on edit (fetching `/api/v1/products/:id` per existing line) initially lived inside the form's top-level mount effect, which sat *before* `updateItem`'s `const` declaration in the file — tripped `react-hooks/immutability` ("cannot access variable before it is declared"), even though the effect's closure only runs after mount, long after `updateItem` exists at runtime. Fixed by moving the effect to its own `useEffect` placed textually after `updateItem`'s declaration. Worth remembering for any future component with a similar "effect closes over a helper declared later in the same component" shape — the rule cares about declaration order in the source, not actual execution order.
- **Verified live end-to-end**: created a test order against the USD-default customer, confirmed it now stores `currencyCode: "INR"`; opened its Edit page and confirmed every field (customer, style, unit price, quantities) pre-filled correctly; edited a quantity and saved, confirmed the Order Amount recalculated; confirmed the order, then edited the now-Confirmed order via a direct API call linking an unapproved sample — got `409 INVALID_STATE_TRANSITION` as expected, then confirmed the override path succeeds with a reason supplied; cancelled the order and confirmed both the API (`409`, "Cannot edit a sales order in 'CANCELLED' status — create a new sales order for additional quantity instead.") and the Edit page itself (`404`) correctly refuse it. Test order removed afterward. Confirmed the real kept demo order `ORD-2026-00001` is unaffected by the currency-service change (already `CONFIRMED`/`INR`, created before this fix and untouched by it, since the fix only changes what a *new* order picks at creation time). `npx tsc --noEmit` and `npm run lint` clean throughout.

## Phase 6 — Purchase Order + Goods Receipt (fabric roll tracking), pulled forward (2026-08-20)

User asked for a Purchase Order + fabric/raw-material-shipment module. Rather than build this ad hoc, it was
scoped as a proper pull-forward of Phase 6 (Inventory) ahead of 5B/5C, confirmed via three AskUserQuestion
rounds (pull forward now vs. finish 5B/5C first; general-purpose PO vs. fabric-only; roll-level tracking
yes/no), then designed via a full reviewed plan (a Plan-agent critique pass caught and fixed several real
issues before any code was written — see below) before implementation, matching the established
design→review→build→verify rhythm used for Sampling and Sales Orders.

**Schema (5 new models, 3 new enums, migration `20260820102502_add_purchase_orders_and_goods_receipt`)**:
- `PurchaseOrder`/`PurchaseOrderItem` — `PurchaseOrderStatus` (`DRAFT→APPROVED→SENT_TO_SUPPLIER→PARTIALLY_RECEIVED→FULLY_RECEIVED→CLOSED`, plus `ON_HOLD`/`CANCELLED`). `PurchaseOrderItem.receivedQuantity` is a cumulative accumulator, incremented per receipt via an **atomic guarded `updateMany`** (`where: { receivedQuantity: { lte: orderedQuantity - incrementBy } }`) rather than a plain read-then-write — this is the fix for a real TOCTOU race a design-review pass caught (two concurrent receipts against the same line could otherwise both pass a naive check-then-increment and produce a real over-receipt). Currency always `company.baseCurrencyCode`, never `supplier.defaultCurrencyCode` — applying the Sales-Order currency lesson (2026-08-20, above) proactively instead of repeating it.
- `GoodsReceipt`/`GoodsReceiptItem` — the "shipment" record. `GoodsReceiptStatus` (`COMPLETED`/`PARTIALLY_REVERSED`/`CANCELLED`) is a derived/cached status, recomputed after every reversal, never hand-set. `GoodsReceiptItem.reversedQuantity` is the "already-reversed" cap accumulator (same atomic-`updateMany`-guard pattern as the receipt guard above).
- `FabricRoll` — optional per `GoodsReceiptItem` line (required when `Product.materialCategory === "FABRIC"`, enforced at the service layer). **First real wiring of the standalone `FabricGsm`/`FabricDye`/`FabricWeaveType`/`FabricWidth`/`FabricComposition` masters** built in Phase 3 and flagged in this file ever since as "pending — wire in once Sampling/Production phases need them." `rollNumber` is deliberately **not** unique company-wide (a design-review catch — different suppliers routinely reuse roll numbering; the row's own id, rendered via the existing `Barcode` component, is the real identity). `rollQuantity`/`remainingQuantity` named distinctly from the two other tables' `receivedQuantity` to avoid a same-field-name-three-meanings ambiguity the review also flagged.
- `InventoryTransaction`/`StockBalance` — the minimal stock ledger pulled forward from Phase 6 proper, exactly as this file's Domain Reference section already specified (append-only ledger, cache upserted in the *same transaction*, reversing entries not arithmetic-on-edit). `InventoryTransaction.referenceModule` reuses the existing `RelatedModule` enum as its polymorphic discriminator rather than inventing a parallel one.
- Two new `BusinessRuleError` codes: `OVER_RECEIPT_NOT_ALLOWED`, `OVER_REVERSAL_NOT_ALLOWED` (both 409) — the standard 2-line addition to the closed-set code list.

**Module structure** — a deliberate two-module split, `src/modules/purchasing/` (owns `PurchaseOrder`/`GoodsReceipt`/`FabricRoll`) and `src/modules/inventory/` (owns the reusable ledger engine), matching `src/config/rbac.ts`'s existing `purchasing`/`inventory` module split 1:1 — no RBAC changes needed anywhere, both modules were already fully seeded with per-role action matrices back in Phase 1. `inventory.service.ts` exports `recordInventoryTransaction(tx, actor, input)` with **`tx: Prisma.TransactionClient` required, no optional fallback** — a design-review catch: an optional-tx-with-internal-fallback signature would let a careless future caller silently start a second, independent transaction and break the ledger/balance atomicity the whole engine exists to protect. It also re-verifies `productId`/`warehouseId` belong to `actor.companyId` before writing — a cheap chokepoint check that pays off for every future caller (Production in 5C, Dispatch in Phase 8), matching the project's "a shared low-level engine is exactly where a defensive check earns its keep" reasoning from the tenant-scoping sweep.

**`reverseGoodsReceiptLine()`** — the actual "goods-receipt returns" pattern this file's Domain Reference section calls for (per-line, capped, reversal-only — not a blunt whole-receipt void, and not the richer "physical return to supplier + credit note" workflow, which stays explicitly deferred). Requires `fabricRollId` when the line has rolls (ambiguous otherwise which physical roll a reversal applies to); reversal granularity mirrors creation granularity (one negative `InventoryTransaction` per original roll-linked row, never one aggregate reversal for a multi-roll line); decrements the roll's `remainingQuantity` and flips it `CANCELLED` if it hits zero; recomputes both `PurchaseOrder.status` and `GoodsReceipt.status` in the same transaction. `cancelGoodsReceipt()` is a thin wrapper that reverses every line's (and every roll's) full remaining quantity.

**`cancelPurchaseOrder` bug avoided by design, not patched after the fact**: cancellation is blocked once any non-fully-reversed `GoodsReceipt` exists against the PO, checked by directly querying `GoodsReceipt` rows — **not** by trusting the PO's current status label. A design-review pass caught that checking only the status name would let a PO cancel from `ON_HOLD` even when `statusBeforeHold` was `PARTIALLY_RECEIVED`, silently cancelling a PO that already has stock in the warehouse — the same bug class (a business rule gated on a status label instead of the real underlying state) already found once in Sampling's Hold/Resume flow. Verified live: cancel is blocked identically whether attempted directly from `PARTIALLY_RECEIVED` or from `ON_HOLD` after holding from it.

**Reused as-is, zero changes needed**: `generateDocumentNumber()` (prefixes `PO`/`REC` already registered from Phase 1/2 planning), `AttachmentService` (`RelatedModule.PURCHASE_ORDER`/`GOODS_RECEIPT` already existed), `Barcode.tsx`, the Hold/Resume `statusBeforeHold` pattern, `COMMON_FEATURES.md` §7a's edit-after-create pattern (`updatePurchaseOrder()` bounded to `DRAFT`/`APPROVED`, reverting `APPROVED`→`DRAFT` on edit to force re-approval — no override-reason escape hatch needed here since there's no approval-gate concept to bypass, unlike Sales Orders' sample gate).

**UI**: `/purchase-orders` (list, edit, detail with barcode/attachments/receipts list), `/purchase-orders/[id]/receive` (the Goods Receipt creation form — per-line warehouse/location pickers, an "Add Roll" repeatable sub-form for fabric lines with GSM/Dye/Weave/Width/Composition dropdowns sourced from the existing fabric-config masters), `/goods-receipts` (list) and `/goods-receipts/[id]` (detail — per-line/per-roll "Reverse" inline form, "Cancel Entire Receipt"), `/inventory/stock-balances` (a minimal read-only list proving the ledger works, not a full Phase-6 stock-movements UI). Sidebar gained "Purchase Orders" and "Goods Receipts" entries; "Inventory" now points at the one real page under it instead of a dead link.

**Deliberately deferred** (documented, not built): Purchase Request (a separate pre-PO requisition document), the formal "Return to Supplier" workflow (physical reverse-logistics + supplier credit note — `reverseGoodsReceiptLine()` is the correction *primitive* underneath it, not that whole flow), manual "Opening Stock" entry for pre-existing warehouse stock, fabric composition blends (single dominant `compositionId` for MVP), multi-currency UI, Stock Movements/Transfers/Adjustments, a QR-scan-to-lookup screen for `FabricRoll`.

**Verified live end-to-end** through the real UI on one PO (`PO-2026-00001`, 2 lines — Cotton Fabric [FABRIC] + Metal Zipper [non-fabric]): create → Approve (self-approval bypass confirmed for the SUPER_ADMIN creator) → Send to Supplier → attempted a Goods Receipt on the fabric line with zero rolls, confirmed the exact rejection message → added 2 rolls (ROLL-001/002) summing correctly, receipt succeeded, `StockBalance` incremented correctly for both lines, PO flipped to `PARTIALLY_RECEIVED` → attempted an over-receipt (250 against 200 remaining), confirmed `409 OVER_RECEIPT_NOT_ALLOWED` with the exact message → completed the line, PO flipped to `FULLY_RECEIVED` → partially reversed 40 MTR off ROLL-002 (reason supplied), confirmed the receipt flipped to `PARTIALLY_REVERSED`, the roll's `remainingQuantity` dropped 100→60, `StockBalance` decremented 500→460, and the PO recomputed back to `PARTIALLY_RECEIVED` → confirmed Cancel is blocked directly from `PARTIALLY_RECEIVED` *and* from `ON_HOLD` after holding from it (the specific bug class this design avoided) → Resumed, confirmed it restored the exact prior status → received the remaining 40 MTR, PO back to `FULLY_RECEIVED` → Closed. `npx tsc --noEmit` and `npm run lint` clean throughout; no server or console errors during the full walkthrough.

**Gotcha (recorded, matches the project's own established pattern)**: a failed over-receipt attempt still consumes a `GOODS_RECEIPT` document-number sequence value (the number is drawn via `generateDocumentNumber()` *before* the transaction that validates the guard) — so real receipt numbers can have gaps from a rejected attempt. This is the same structural trade-off every document-numbering call in this project already has (a number drawn just before a downstream validation fails is never reused), not a defect introduced here — real accounting systems have the identical trade-off once a number is issued.

## Phase 5B — BOM & MRP, with a prerequisite UOM-conversion fix (2026-08-20)

User asked to continue with 5B. Designed via the same design→review→build→verify rhythm (three
AskUserQuestion rounds — pull-forward-timing-style questions this time were about scope choices: fix a
real UOM-conversion gap now vs. defer, per-color BOM lines yes/no, show available/shortfall in MRP vs.
needed-only, include "generate PO from shortfall" in this pass — all answered "yes/recommended"), then a
Plan-agent critique pass before implementation, matching Sampling/Sales-Orders/Phase-6's precedent.

**Prerequisite correctness fix, found while researching 5B, not part of the original ask**: `UnitOfMeasure`
has had `baseUnitId`/`conversionFactor` fields since Phase 1/2 planning, but **no code anywhere ever
performed a conversion** — confirmed via grep. A user could (and the live-tested data never had, purely by
luck) choose a Purchase Order line's UOM different from a material's own base UOM, and the stock ledger
(`InventoryTransaction`/`StockBalance`, which has no `uomId` column — the design intent is "always the
material's base UOM") would silently record the raw number in the wrong unit. Since MRP's whole point is
comparing "needed" against real `StockBalance`, this gap would have directly corrupted MRP's output — fixed
as a prerequisite, not deferred.
- New `src/lib/uom-conversion.ts` — `convertUomQuantity(quantity, fromUom, toUom)`, depth-1 only by design (a
  derived unit's `baseUnitId` must point to a root unit whose own `baseUnitId` is null) — **enforced**, not
  just coincidentally true of today's seed data: `lookup.service.ts`'s `createUnit`/`updateUnit` now reject
  setting a `baseUnitId` that itself points to an already-derived unit. `baseUnitId` was previously dead
  schema — added to `unitSchema`, threaded through create/update, and exposed as a new "Base Unit" `select`
  field on the Units tab (`/masters/lookups`) — the master-data UI for a schema column that's existed
  unused for a very long time.
- Seed data (`prisma/seed.ts`) gets two real, universal, unambiguous conversions: `DZN.baseUnitId = PCS`
  (factor 12), `YDS.baseUnitId = MTR` (factor 0.9144). `ROL`/`SET`/`KG` deliberately stay roots — a roll's or
  set's quantity has no fixed universal factor to any other unit.
- New `BusinessRuleError` code `UOM_CONVERSION_UNAVAILABLE` (409) — a defensive backstop at the ledger-write
  call sites, distinct from the primary `VALIDATION_ERROR` thrown at PO-creation time.
- `purchase-order.service.ts`'s `createPurchaseOrder`/`updatePurchaseOrder` now reject a line whose chosen
  `uomId` has no fixed conversion path to its material's `baseUomId` (or whose material has no `baseUomId`
  configured at all) — catching the mistake immediately instead of at receipt time, weeks later.
- `goods-receipt.service.ts` — a deliberate split: **`GoodsReceiptItem.receivedQuantity`/`reversedQuantity`
  stay in the PO line's original unit** (the commercial document, compared against
  `PurchaseOrderItem.orderedQuantity` in that same unit), while **`FabricRoll.rollQuantity`/`remainingQuantity`
  and every ledger write are converted to the material's base UOM** — a Plan-agent review catch: converting
  only the ledger while leaving `FabricRoll`'s own numbers in the original unit would make "remaining roll
  quantity" and "stock balance" visibly disagree for a FABRIC material once YDS→MTR conversion existed. The
  roll-quantity-sum-equals-line-quantity validation runs first, in the original unit (as entered); conversion
  to base UOM happens immediately before the nested `create`. `reverseGoodsReceiptLine()` mirrors this: a
  roll-scoped reversal is already base-UOM (matches `remainingQuantity`), a line-scoped reversal is converted
  from the original unit before it can cancel out the ledger entry.

**BOM (`src/modules/bom-mrp/`, new `Bom`/`BomItem` models)**: one mutable `Bom` per Style (`productId
@unique`, no versioning, no approve/reject action — matches the already-seeded `bom_mrp` RBAC module having
none either). `BomItem` gets an optional `colorId` (per-color consumption, e.g. thread color matching the
garment) and a `wastagePercentage` (effective qty = `quantityPerUnit * (1 + wastagePercentage/100)`).
`upsertBom()` is a full replace-items-in-one-transaction (same shape as Sales/Purchase Orders' `replaceItems`
— `COMMON_FEATURES.md` §7a), with two validation layers a review pass insisted on: (1) exact duplicate
`(materialId, colorId)` pairs rejected, and (2) a `colorId: null` ("applies to every color") line rejected
from coexisting with a specific-color line for the *same* material — the two would otherwise silently
double-count that color's consumption in the MRP calc. Zero RBAC changes needed.

**MRP (`GET /api/v1/bom-mrp/requirements?salesOrderId=`)**: for each Sales Order style line, sums
`breakdown` quantities matching each `BomItem`'s `colorId` filter (or all rows if null), applies wastage,
converts to the material's base UOM, and **aggregates by `materialId` only** (never `materialId+uomId` — a
review catch against a mixed-unit sum bug) while nesting a `contributingStyles` breakdown per material so a
merchandiser can see which style(s) are driving a given material's need — a flat total alone would have
lost that traceability. `availableQuantity` is a new `sumAvailableByProductIds()` aggregate in
`inventory.service.ts` (company-wide sum across all warehouses — per-warehouse allocation is Production's,
5C's, job). Styles with no BOM are reported separately (`stylesWithoutBom`), not a hard error for the whole
request; BOM lines that fail conversion are reported in `unconvertibleLines` rather than crashing the
endpoint. No Sales Order status restriction — purely informational, no stock reservation happens here.

**"Generate Purchase Order from shortfall"** — deliberately client-side orchestration, not a new backend
endpoint: the UI groups selected shortfall rows by `defaultSupplierId` (prompting for a manual pick when a
material has none) and calls the *existing* `POST /api/v1/purchase-orders` once per supplier group, reusing
`createPurchaseOrder()` unchanged. Tracks a **per-supplier-group result** (pending/success/failed) explicitly
in its own UI state rather than one all-or-nothing spinner, so a partial failure leaves a clear, inspectable
trail and a retry can't double-post an already-succeeded group. Explicitly documented as an MVP tradeoff — a
server-side multi-PO orchestrator is a reasonable future hardening pass, not built now.

**Bug found and fixed along the way, not part of the plan**: the new `/bom-mrp` style list initially returned
full `Product` rows to `DataTable`, which auto-renders an Active/Inactive toggle for *any* row with an
`isActive` field, PATCHing `${fetchUrl}/:id/status` — a route that doesn't exist for this list (and
shouldn't; style activation belongs to Masters → Products only). Caught live before it could 404 on a real
click. Fixed by having `listStylesWithBom()` return a narrow DTO (`id`/`styleName`/`styleCode`/`bomItemCount`)
instead of spreading the full Product row — worth remembering for any future list page built on `DataTable`
from a master-data model: project only the fields the page actually means to expose, since `isActive`
triggers this affordance implicitly. Separately, `SimpleLookupManager`'s list table previously rendered a
`select`-type field's raw UUID instead of its resolved label (only the edit-form dropdown resolved it) — a
pre-existing gap surfaced by adding the Base Unit column, fixed generically for every current and future
`select` field in that shared component.

**Verified live end-to-end**: added `DZN.baseUnitId`/`YDS.baseUnitId` through the real Units UI, confirmed
the depth-1 guard rejects pointing a new unit's base at `DZN` (already derived) with the exact message;
created a Purchase Order forcing Cotton Fabric (base MTR) to `ROL`, confirmed the exact
`UOM_CONVERSION_UNAVAILABLE`-style rejection; created and fully received a PO in `YDS` for the same MTR-based
fabric, confirmed the `GoodsReceiptItem` shows "10 YDS received" (original unit preserved) while the
`FabricRoll` shows "9.144" (converted, `10 × 0.9144`) and `StockBalance` incremented by exactly `9.144`;
authored a BOM on Round Neck T-Shirt (Cotton Fabric, all colors, 10% wastage + Polyester Thread, Navy Blue
only), confirmed both the exact-duplicate and the null-vs-specific-color overlap validations reject via
direct API calls with the exact messages; created a real Sales Order (`ORD-2026-00009`, 200 Black + 400 Navy
Blue pieces) and ran the MRP preview, hand-verified `Cotton Fabric: needed 792 MTR (1.2 × 1.10 × 600),
available 509.144, shortfall 282.856` and `Polyester Thread: needed 20 ROL (0.05 × 400 Navy-only), available
0, shortfall 20` — both exactly matching the per-color-filtered, wastage-applied, base-UOM-converted
calculation; selected both shortfall rows (same supplier), generated `PO-2026-00003`, confirmed its two
lines match the shortfall quantities/unit costs exactly (`Order Amount: INR 43,128.4`). `npx tsc --noEmit`
and `npm run lint` clean throughout; no server or console errors during the full walkthrough.

---

## Phase 5C — Production, core engine built; live verification pending (2026-08-22/23)

Designed via the project's established design→review→build→verify rhythm on top of the earlier
**Production Schema Blueprint** (a two-layer state model: a small fixed `ProductionOrderStatus` lifecycle
enum + a fully dynamic, `ProductionStage.sequence`-driven Lot stage position — no hardcoded stage names
anywhere, matching the same "don't bake a configurable master into an enum" lesson already learned once
during 5A's own design review). A 23-section user specification demanded an explicit STOP-and-approve gate
before any code was touched; the user then authorized full implementation using the design's own stated
recommendations for all 6 open decisions (Employee-tracks-work/User-tracks-login split, block split/merge
mid-JobOrder, no variant-level Lot tracking in V1, defer a `Bundle` table, no mandatory
`ProductionOrder`-level approval gate, reuse existing RBAC actions rather than mint 3 new verbs).

**Schema (9 new tables, 7 new enums)**: `ProductionOrder` (header, `ORD`-sibling numbering via
`generateDocumentNumber`, `salesOrderItemId` nullable — null means Make-to-Stock, decided explicitly rather
than overloading `SalesOrder`), `Lot` (immutable quantity, `currentStageId` is a **documented cache-only**
convenience column — the ledger below is the sole source of truth, exactly the `stock_balances`/
`inventory_transactions` pattern this project already trusts), `LotRelation` (SPLIT/MERGE genealogy via a
join table, since MERGE needs many-parents→one-child), `JobOrder` (the generic `Lot × ProductionStage` unit
— replaces the old blueprint's stage-named `cutting_plans`/`sewing_production`/`finishing_records` tables
entirely; **not** unique on `(lotId, productionStageId)` since a lot can revisit a stage after rework),
`JobOrderAssignment`/`JobOrderProgressEntry` (Employee tracks the work, User tracks who was logged in and
clicked save — resolved at zero schema cost by reusing the pre-existing `User.employeeId` FK),
`ProductionStageTransaction` (append-only ledger — the actual source of truth a Lot's stage position is
derived from), `QcInspection`/`QcDefect`/`DefectType`. `JobOrder`'s 3-column quantity cap
(`completed+rejected+damaged <= planned`) can't use the project's usual single-column guarded-`updateMany`
idiom, so it's enforced by a read-verify-write inside the transaction *and* backed by a hand-written
Postgres `CHECK` constraint as a hard backstop. `MaterialRequest.productionOrderId` (nullable) threads
Production into the existing BOM→MR→PO chain unchanged.
- **RBAC simplified mid-build**: the design doc's proposed 3 new action verbs (`revert`/`restructure`/
  `skip_stage`) were dropped once a pre-existing, separate `qc` RBAC module (with `QC_MANAGER` already
  seeded) was found — QC actions use `qc.create`; lot restructure (split/merge) and stage-skip-forward both
  reuse the existing `production.approve` action instead (added to `MANAGEMENT`/`PRODUCTION_MANAGER`'s
  grants).
- `npx tsc --noEmit` and `npm run lint` clean on the core engine; unit tests added for `job-order.service.ts`
  (stage-graph validation, the quantity-guard transaction, QC disposition) reaching 85/85 project-wide.
- **Git note**: this work landed on `main` alongside a same-day commit from another contributor
  ("Indradhar Team", message "after changes") touching several of the same files (Material Request,
  Purchase/Customer/Employee/Supplier/Warehouse routes). Two real compile breaks from that merge
  (`customer.schema.ts`'s `customerUpdateSchema`/`CustomerUpdateInput` exports collapsed into
  `customerSchema`/`CustomerInput` without updating its two importers; 5 test-only `unitPrice`-missing
  errors in `material-request.service.test.ts` after `generatePurchaseOrdersForShortfallSchema` correctly
  made `unitPrice` required) were found and fixed same-day — `npx tsc --noEmit`/`npm run lint`/`npm test`
  all clean again afterward. Worth a quick sync with that contributor before further parallel work on
  Production/Material Request/Purchasing files to avoid repeat collisions.

### Phase 5C QA pass — 2 P0 bugs found and fixed in `recordQcInspection()` (2026-08-23)

The deferred live-browser verification ran via the `erp-qa-uat` agent, covering the full Add Lot → Start →
Assign Worker → Log Progress → Forward → Revert → QC → Split → Merge walkthrough end-to-end. Lots, Job
Orders, Forward/Revert, and Split/Merge all passed with zero defects — every cap, guard, and state
transition behaved correctly with clear, specific error messages. QC Inspection had two independent P0
defects, both in `src/modules/production/job-order.service.ts`'s `recordQcInspection()`:

- **ERP-BUG-0001 (stock/WIP double-posting)**: accepting a job order at QC after the same completed
  quantity had already been sent on via a manual Forward created a second, phantom downstream job order and
  double-posted Finished-Goods stock (confirmed live: 5 units manually forwarded, then QC-accepted again,
  produced 10 units in Finished Goods Godam instead of 5). Root cause: the accept branch called the same
  guarded `forwardedQuantity` accumulator increment used by manual Forward, but never checked whether the
  guard actually matched a row (`guard.count === 0`) before proceeding — so a lost guard check still let the
  already-executed `postStageTransactionInTx()` call (downstream job order + FG receipt) stand uncontested.
  Fixed with two layers, mirroring `forwardJobOrder()`'s own existing two-layer defense: a friendly
  pre-transaction check (`notYetForwarded = completed - forwardedQuantity`, rejecting the whole call with a
  clear `409` before any write) plus checking the in-transaction guard's result and throwing to roll back on
  a lost race.
- **ERP-BUG-0002 (crash on the mainline QC-reject scenario)**: recording a Partial Pass/Fail (any
  rejected/damaged quantity) against a job order that was already fully completed — the normal precondition
  for running QC at all — crashed with a raw `500 INTERNAL_ERROR`, the Postgres CHECK constraint
  (`job_orders_quantity_consistency_check`) rejecting the write. Root cause: the disposition path shrank
  `plannedQuantity` to "make room" for the rejected/damaged amount, but `completedQuantity` never shrank to
  match, making `completed+rejected+damaged <= planned` impossible to satisfy once `completed === planned`.
  Fixed by replacing that function with `applyQcDispositionInTx()`, which reclassifies the disposed quantity
  *out of* `completedQuantity` and *into* `rejectedQuantity`/`damagedQuantity` instead — the sum, and
  therefore the CHECK constraint, is preserved automatically; `plannedQuantity` is never touched by this
  path.
- Two regression tests added to `job-order.service.test.ts` (87/87 project-wide) reproducing each bug
  exactly against mocks; both also re-verified live against the real dev DB and Postgres CHECK constraint
  (fresh `PROD-2026-00003`/Lot `L01`, left in the dev DB as reproducible evidence) — confirmed the exact
  double-forward is now blocked with a clear `409`, confirmed the exact QC-reject-on-completed scenario now
  succeeds (`201`) with `completed`/`rejected` correctly split and downstream Checking/rework job orders
  each created exactly once (no duplicates), and confirmed the original "false rejection on an
  already-completed job order" bug the old code was guarding against (referenced in-code as "BUG-03") is
  not reintroduced — a clean QC-Pass on a normal, never-forwarded completed job order still succeeds.
- Also fixed: a P3 UI clarity gap where a Lot's "Currently at: X" label implied its entire quantity sits at
  one stage even after a partial forward + partial revert splits it across stages — relabeled to "Last
  stage transition" with an explanatory tooltip (`LotWorkflowPanel.tsx`). A P4 finding (`ProductionOrderStatus.MATERIAL_ALLOCATED`
  is a reserved enum value no code path currently reaches) was left as-is, matching this project's own
  established "reserved enum value" precedent (`SampleStatus.DRAFT`) rather than force-wiring an
  unrequested transition.
- `npx tsc --noEmit`, `npm run lint`, `npm test` (87/87) all clean throughout.

**Phase 5C is now verified and considered done** — Production Orders, Lots, Job Orders, Split/Merge, and QC
Inspection have all been exercised end-to-end in the real app against the real dev DB with zero remaining
known defects.

---

### Phase 4 extension — material grouping and shade/Pantone precision on Sample Materials (2026-08-21)
User feedback on the live Sampling module, ahead of a planned Buyer Enquiry module: the "Add Material" picker had no grouping (one flat dropdown across every raw material — Fabric/Trims/Zips/Buttons/etc. all mixed together) and no way to record an exact shade beyond the generic `Color` master name (e.g. "Red" alone doesn't tell a factory which physical dye lot to use).

- **Shade/Pantone**: added `SampleMaterial.dyeId` (nullable UUID FK to the existing `FabricDye` master, built in Phase 3's fabric-config batch and unused until now) + `FabricDye.sampleMaterials` back-relation. Reused `MATERIAL_MERGE_KEY_FIELDS`'s extensibility mechanism a second time — `["materialId", "uomId", "colorId"]` → `["materialId", "uomId", "colorId", "dyeId"]`, one line, no changes needed to `buildMaterialMergeKey()` or `addSampleMaterial()`'s merge algorithm — confirms the mechanism generalizes as designed (first proven with `colorId` earlier in Phase 4). Migration `add_sample_material_dye_shade`.
- **Material grouping — user reversed the initial decision mid-build**: first confirmed via AskUserQuestion to reuse existing `materialCategory` values as-is (no new categories); the user then explicitly asked for Zips and Buttons to be split out of the generic `TRIMS` bucket into their own distinct categories, so the grouped picker could distinguish them. Added `ZIPS`/`BUTTONS` to the shared `SupplierCategory` enum (used by both `Supplier.category` and `Product.materialCategory`) — required touching two separate Zod const arrays (`SUPPLIER_CATEGORIES`, `MATERIAL_CATEGORIES` — confirmed these are NOT the same list), `prisma/seed.ts`'s literals, and a one-off correction script for the two already-seeded rows (`MAT-ZIP`/`SUP003` → `ZIPS`, `MAT-BTN`/`SUP004` → `BUTTONS`) since `createMany`/`skipDuplicates` never retroactively updates existing rows. Migration `split_zips_buttons_from_trims`.
- **UI** (`SampleWorkflowPanel.tsx`): the Add Material row gained a "Group" `<select>` (options derived from the distinct `materialCategory` values actually present in the fetched materials list, not a second hardcoded list) that filters the Material `<select>`'s options client-side, plus a "Shade / Pantone (optional)" `<select>` sourced from `GET /api/v1/fabric-dyes`. The materials table gained a "Shade / Pantone" column (`name (pantone)` format, "—" when unset).
- **Bug caught during live verification**: the new material rendered its shade as "—" even though the field had genuinely saved (`dyeId` correct via a direct API check) — root cause was `SampleRequestRepository.findByIdWithDetails()` (the actual query the detail page uses) had its own separate, inline `materials: { include: { material, uom, color } }` that never got `dye: true` added, distinct from `SampleMaterialRepository.findByVersionId()` (a different function, used elsewhere) which did get it. Fixed by adding `dye: true` to the inline include at [sample.repository.ts:32](src/modules/sampling/sample.repository.ts:32) — a reminder that this module has more than one place materials get fetched from, and a new relation needs adding to all of them, not just the first one found.
- **Cleanup note found in passing, not a defect**: `Material.hsnSacCode` already exists on the schema and form — an earlier gap-analysis note (from Buyer-Enquiry-screenshot review) suggesting "HS Code missing" was already incorrect; no action needed.
- Verified live end-to-end through the real UI (not just direct API calls): on `SAM-2026-00014`, selected Group="Zips" and confirmed the Material dropdown narrowed to exactly "Metal Zipper 7 Inch"; added it with Shade="Black Dye (19-4005 TCX)" and Qty 15 PCS; confirmed the row initially showed "—" for shade (the bug above), fixed the repository include, reloaded, and confirmed it then correctly showed "Black Dye (19-4005 TCX)"; confirmed via a direct API fetch that `dyeId` and the full `dye` object round-tripped correctly; removed the test row via a one-off script afterward and confirmed the request reverted to its original single Cotton Fabric line. `npx tsc --noEmit` and `npm run lint` clean throughout.
- **Not yet done**: applying the same Group→Material cascading picker to `BomEditor.tsx`'s or `PurchaseOrderForm.tsx`'s material pickers — the user's ask was scoped specifically to the Sampling module; revisit only if asked. The Buyer Enquiry module itself (the original trigger for this feedback) remains queued, not started.

## Phase 4 extension — Buyer Enquiry: an optional intake layer before Sampling (2026-08-21)

Built per a plan reviewed and refined across several rounds with the user (a full 13-point architecture
critique first, then an explicit final schema-refinement request) before implementation — the same
design→review→build→verify rhythm as every other module this session.

**Hard business requirement, enforced structurally, not by convention**: Buyer Enquiry is OPTIONAL. Direct
`SampleRequest` creation and direct `SalesOrder` creation are both completely unmodified — neither module's
schema, service, or route files were touched at all (confirmed via `grep -rl "buyerenquiry"
src/modules/sampling src/modules/sales-orders` returning zero matches). A merchandiser who never opens this
module never has to know it exists.

**Schema (2 new tables, 3 new enums, migration `add_buyer_enquiry`)** — the final design deliberately uses
**one authoritative nullable FK**, not two: `BuyerEnquiryLine.sampleRequestId` (`@unique`) is the only
physical column linking the two tables; `SampleRequest.buyerEnquiryLine` is a pure virtual Prisma
back-relation (no DB column at all), the same shape already used by `Product.bom`/`Bom.productId`. This was
a direct response to the user's explicit final-review instruction ("do not maintain two independent foreign
keys... unless Prisma/database constraints require it") — an earlier draft of this design had briefly
considered a second FK column on `SampleRequest` for the same traceability, which would have been redundant.
`@unique` on the one real column enforces **both** directions of the cardinality rule at the DB level: a
`BuyerEnquiryLine` converts to at most one `SampleRequest`, and (via the same constraint, from the other
side) a `SampleRequest` originates from at most one line — no second constraint needed.
- `BuyerEnquiry` (header) — `customerId`/`buyerId` both nullable; a not-yet-onboarded **prospect** is
  captured via plain `prospectName`/`prospectContactPerson`/`prospectEmail`/`prospectPhone`/`prospectCountry`
  fields directly on the header, deliberately **not** a separate Prospect/Lead master table — no lifecycle,
  no promotion workflow, no reminders (explicit user instruction: "do not introduce unnecessary CRM
  functionality"). `status` (`OPEN`/`PARTIALLY_CONVERTED`/`CLOSED`/`CANCELLED`) is always derived from line
  statuses except the one manual `CANCELLED` action — same "never let a status label drift from real state"
  discipline this project already learned the hard way twice (Sampling's Hold/Resume bug, Goods Receipt's
  cancel-from-`ON_HOLD` bug).
- `BuyerEnquiryLine` — `productId` nullable (existing Style) with a `styleNameFreeText` fallback, mirroring
  `SampleRequest`'s own "may not exist as a Style yet" precedent exactly. `lineStatus`
  (`PENDING_REVIEW`/`APPROVED_FOR_SAMPLING`/`ON_HOLD`/`REJECTED`/`CONVERTED`) — `CONVERTED` is deliberately
  excluded from the generic line-status-change Zod schema and its `ALLOWED_TRANSITIONS` map, reachable
  *only* through the dedicated conversion action, the same discipline that already protects
  `SampleStatus.TECH_PACK_READY`/`REVISION_REQUESTED` from being forged via a plain status PATCH.
- `Attachment`/photo support was explicitly **deferred out of this V1** despite being in the original
  feature list — the user's final scoping message narrowed the ask to schema/optionality/conversion/RBAC/UI/
  regression, and adding attachments now would have been scope creep beyond what was actually requested;
  revisit only if asked.

**Prospect lifecycle, resolved before implementation per the user's explicit question**: an enquiry that
never converts simply sits in whatever status it's in indefinitely — no expiry, no archival job, no
promotion-to-Customer workflow. `CLOSED`/`CANCELLED` are the only "done" states V1 needs; a prospect that
never becomes a real relationship is filtered out of active-customer reporting by a plain `customerId IS
NULL` check whenever that's needed later, not by any lifecycle machinery in this module.

**Conversion (`convertEnquiryLineToSampleRequest` in `buyer-enquiry.service.ts`)** reuses
`createSampleRequest()` from the Sampling module **completely unchanged** — the conversion function calls it
exactly like any other caller would, then separately links the result back onto the line. This is what makes
"direct Sample Request creation must not accept a BuyerEnquiryLineId" true by construction rather than by
promise: `SampleRequestInput`'s Zod schema has no such field, and there is no column on `SampleRequest` to
even write to. Guarded against a concurrent double-conversion race with an atomic `updateMany` whose `where`
clause re-asserts `sampleRequestId: null, lineStatus: "APPROVED_FOR_SAMPLING"` (the same
express-the-precondition-in-the-where-clause pattern as the Purchasing module's over-receipt/over-reversal
guards) — if the guard loses the race, the `SampleRequest` already created is left as a harmless orphan
rather than double-linking the line, mirroring this project's own already-accepted "a document number drawn
just before a downstream check fails is never reused" trade-off from the Goods Receipt gotcha.
**Verified live**: a genuine concurrent-attempt artifact surfaced during browser testing (a stray duplicate
PATCH landed a real `409 Conflict` — "Cannot move a buyer enquiry line from APPROVED_FOR_SAMPLING to
APPROVED_FOR_SAMPLING") while the underlying data stayed perfectly consistent (exactly one `SampleRequest`
created, exactly one conversion recorded in the audit log) — a live, unplanned demonstration that the guard
does what it's for.

**RBAC**: new `buyer_enquiries` module in `src/config/rbac.ts`. `MERCHANDISER` gets
view/create/edit/reject/export/print (owns the whole intake→triage→convert flow, matching their ownership of
Sampling itself); `MANAGEMENT` gets view/reject only (mirrors their view/approve/reject shape on `sampling`,
minus an "approve" action since there's no header-level approval concept here — approval happens later, at
the Sample stage); `SAMPLING_MANAGER`/`PRODUCTION_MANAGER`/`QC_MANAGER` get view only. Line-status changes
split the same way Sampling's decision route already does: `REJECTED` asserts the `reject` action, every
other transition asserts `edit` — and the convert action itself asserts `edit` too, following
`convertSampleToStyle()`'s own precedent of not inventing a new "convert" RBAC action for a single call site.

**UI**: `/buyer-enquiries` (list, plain `DataTable`, no `isActive` toggle — matches the transactional-record
convention already used by Sampling/Sales Orders lists), `/buyer-enquiries/new` (header form with a
prospect/Customer toggle + repeatable lines, mirroring `SalesOrderForm`'s repeatable-line shape without its
variant grid), `/buyer-enquiries/[id]` (Server Component + `BuyerEnquiryWorkflowPanel` Client Component,
same split as every other module's detail page, including the `key={id}` remount-on-navigation fix and the
`JSON.parse(JSON.stringify(...))` Decimal/Date serialization fix both already established project-wide).
Sidebar gained a "Buyer Enquiries" entry positioned above "Sampling" — a visual "earliest in the pipeline"
cue only, not a functional gate.

**Regression-verified, not just asserted**: created a Sample Request directly via the API with a
`buyerEnquiryLineId` deliberately included in the payload — confirmed it was silently ignored (`201`, no
such field in the response) since the schema has no such field to accept; created a Sales Order directly
with no sample link at all — confirmed `201` with zero Buyer Enquiry involvement. Full happy path also
verified end-to-end through the real UI/API: created an enquiry against a real Customer → approved a line →
converted it (created `SAM-2026-00018`, correct customer/style/color) → header auto-derived to `CLOSED`.
Separately verified: prospect-only enquiry creation (two free-text lines, no Customer); reject requires a
reason (`400` without one, `200` with one); Hold → Resume round-trip; header Cancel blocks all further line
actions (`409 INVALID_STATE_TRANSITION` on both a second cancel attempt and a subsequent line-status change);
conversion correctly blocked for a still-prospect enquiry with a clear message pointing at linking a real
Customer first. `npx tsc --noEmit`, `npm run lint`, and `npm test` (32/32) all clean throughout. Test data
cleaned up afterward; kept the one real end-to-end demo enquiry (`ENQ-2026-00001`, `CLOSED`, converted to
`SAM-2026-00018`).

**Not yet built** (explicitly out of scope for this pass, not oversights): per-line/header attachments (see
above), the Group→Material cascading picker or any other Sampling-module UI pattern applied here (never
asked for), a server-side multi-enquiry bulk-import, and any reporting on enquiry→sample conversion rate
(the schema supports computing it, no report screen exists yet).

## Phase 4 extension — Sample Type + Sample Costing, the P0 pair from the Sampling gap analysis (2026-08-21)

Followed a full analysis → design → Plan-agent critique → approval → build → verify cycle (the most rigorous
review pass this session, per the user's explicit request to independently re-evaluate rather than just
port the reference product's UI). See the session transcript for the full 14-section gap analysis; only the
two P0 items were implemented in this pass — everything else (structured measurements, `assignedToUserId`,
notifications, multi-currency costing, configurable formula templates) stays deferred, several of them
reversed from an earlier, less critical version of the same analysis.

**Sample Type**: new hardcoded `SampleType` enum (`FIT`/`PROTO`/`PP`/`TOP`/`SHIPMENT`/`PHOTOSHOOT`/`SMS`/`OTHER`)
on `SampleRequest` — nullable at the DB level (real rows predate it, same precedent as `styleName`/`color`),
required by the create Zod schema, immutable after creation (identity-like, no edit endpoint — a PP sample
silently relabeled later would undermine its stated future role as a Production-order eligibility gate).
Also threaded through Buyer Enquiry's `convertEnquiryLineToSampleRequest()` — conversion is a real sample
creation moment too, not exempt from "always a deliberate choice."

**Sample Costing, scoped to `SampleVersion`** — the revised, reuse-first design (rejected an earlier draft
that would have duplicated `SampleMaterial` into a parallel `SampleCostLine` table):
- `SampleMaterial` gained two nullable columns, `rate`/`gstPercentage` — set/cleared only through a new
  scoped sub-route (`PATCH /api/v1/sampling/materials/:materialId/costing`, mirroring the existing
  `.../damage` sub-route exactly), never through `addSampleMaterial()`'s create/merge payload. Deliberately
  **not** added to `MATERIAL_MERGE_KEY_FIELDS` — rate is a cost attribute, not an identity attribute that
  should split/merge lines, so a merged line always carries one rate (an accepted, explicitly-flagged
  constraint, not a silent gap).
- New `SampleOtherCharge` model (plain CRUD — `costHead` `PROCESS`/`FABRICATION`/`OTHER`, `description`,
  a flat `amount`) for labor/process/overhead costs that don't fit `SampleMaterial`'s shape at all.
- `SampleVersion` gained `marginPercent`/`commissionPercent`/`freightAmount` (merchandiser-entered) and
  `costSubtotal`/`finalTotal` (system-computed and stored, same precedent as `SalesOrder.totalAmount` —
  never trusted from the client), plus a **reversible lock** — `isCostingLocked`/`costingLockedAt`/
  `costingLockedByUserId` (the first reversible lock in this app; carries its own actor/timestamp columns
  rather than a bare boolean, matching the existing `submittedToCustomerAt`/`customerDecisionAt` precedent
  on this same model, since a lock→unlock→lock cycle would otherwise lose the who/when story).
- Hardcoded formula, base currency only — the standard garment-export FOB-costing shape, not an arbitrary
  choice: `materialCost (Σ qty×rate×(1+gst%)) + otherCharges = costSubtotal → +margin% → +commission% →
  +freight = finalTotal`. No configurable templates, no multi-currency — both explicitly rejected as scope
  this business doesn't need, consistent with the project's already-deliberate multi-currency deferral
  elsewhere.
- `estimatedCostPerUnit` **implicit mode switch** (no new boolean): manual and fully editable while no
  material has a rate and no charge exists; the moment either exists, every recalculation overwrites it to
  equal `finalTotal` and a manual value is silently ignored; clearing all pricing reverts to manual mode,
  keeping the last computed number rather than nulling it — a symmetric toggle, not a one-way ratchet.
- **Costing is never a gate** — zero changes to `ALLOWED_TRANSITIONS` or anywhere else in `SampleStatus`;
  verified by design, not just stated as intent.
- **Lock/unlock gated on `sampling.approve`, not `edit`** — a Plan-agent critique caught that reusing `edit`
  would give the same role (`MERCHANDISER`) both data-entry and freeze/unfreeze power with no maker/checker
  separation. Using the already-seeded `approve` action (held by `MANAGEMENT`, not `MERCHANDISER`) gives a
  real boundary for free, no new RBAC action needed.
- **Race-free lock/supersede enforcement, no separate read-then-write check**: every costing mutation
  (material rate edit, charge create/update/delete, the margin/commission/freight PATCH, and the recompute
  itself) runs inside one `prisma.$transaction`; the *only* guarded write is `SampleVersion`'s own
  `updateCostingIfUnlocked`/`updateCostingIfLocked` (`updateMany` with the precondition in the `WHERE`
  clause) — if that guard fails, the whole transaction rolls back, including whatever material/charge
  mutation triggered it. **Verified live**: locked a version, then attempted a material rate edit and a new
  charge creation — both correctly rejected with `409`, and a direct DB check confirmed *zero* orphan rows
  from the rejected charge attempt and the material's rate genuinely unchanged — the rollback-on-guard-failure
  mechanism works exactly as designed, not just in theory.
- `addSampleMaterial()`'s merge branch (not just create) now also triggers a recompute — a Plan-agent
  critique catch: without this, merging quantity into an already-priced line would silently desync
  `costSubtotal`/`finalTotal` until an unrelated costing edit happened to fire a recompute. This call passes
  `throwIfBlocked: false` — adding a material must never be blocked by a costing lock at all, since it's a
  general workflow action, not a costing edit (rate is never part of that payload).
- **Backward compatible by construction**: any sample that never touches costing behaves identically to
  before — `rate`/`gstPercentage` default `NULL` and display "—"; `estimatedCostPerUnit` stays a plain
  manual field. Confirmed live on a real pre-existing sample (`SAM-2026-00002`): `sampleType: null` renders
  "Not specified," `costSubtotal: null`, zero errors.
- **New routes**, all inside the existing `sampling` module: `PATCH .../materials/:materialId/costing`,
  `POST .../versions/:versionId/charges`, `PATCH`/`DELETE .../charges/:chargeId`,
  `PATCH .../versions/:versionId/costing`, `POST .../versions/:versionId/costing/lock`/`unlock`.
- **UI**: rate/GST inline-edit on the existing materials table (same edit-toggle pattern as damage), a new
  Other Charges mini-table + add-row, a costing summary footer (Subtotal/Margin/Commission/Freight/Final
  Total) with Lock/Unlock buttons — the manual Cost/Unit input only renders while the version has no priced
  data yet, disappearing automatically once real costing exists.
- First unit tests for `sample.service.ts` (`sample.service.test.ts`, 8 tests) — justified here because
  there's now real calculation logic worth testing, not just CRUD (matching this project's "test business
  logic, not the mock" guidance): hand-verified `finalTotal` from a known formula, null-rate-contributes-0,
  locked/superseded rejection, the manual/computed mode switch in both directions, and a regression test for
  the merge-triggers-recompute fix.
- **Verified live end-to-end**: created a real sample (`SAM-2026-00020`, type PP) → added a material →
  priced it (10 MTR × ₹25 × 1.10 GST = ₹275, hand-verified) → added a Process charge (₹45, subtotal ₹320) →
  set margin 10%/commission 5%/freight ₹20 → hand-verified `finalTotal = 320×1.10×1.05+20 = 389.6` exactly →
  locked (further edits correctly `409`, confirmed no orphan data) → unlocked (edits resumed, freight
  30→+10 to `finalTotal` correctly) → progressed through the full state machine to a real revision
  (`addSampleVersion`) and confirmed version 1 flipped to `SUPERSEDED` with its costing permanently frozen
  (a further edit attempt correctly `409`) while version 2 started empty and unlocked. Test record cleaned
  up afterward. `npx tsc --noEmit`, `npm run lint`, and `npm test` (40/40) all clean throughout.
- **Not yet done, explicitly deferred**: adding `sampleType` to the advanced worklist filter panel UI
  (the field itself, the query-param plumbing, and a plain list-column badge are done; the collapsible
  filter panel wasn't touched, to keep this pass scoped to the two approved P0 items) — same for a
  Sample-Type-aware Production gate, which has no consumer yet since Phase 5C doesn't exist.

### Phase 4 extension — Sampling small-CRUD actions moved into Modals (2026-08-21)

Explicit UI/UX requirement: small, focused CRUD actions (Add/Edit Material, Add/Edit Other Charge, Comments,
Attachments, Approval/Rejection confirmation, small configuration actions) should use a Modal/Dialog instead
of an always-visible inline expanding form, while record creation, the detailed workflow panel, the Costing
overview, and the Version timeline stay full page sections. No generic Modal component existed yet (only
`ConfirmModal`, confirm-only, and `FilePreviewModal`, a file viewer) — added `src/components/ui/Modal.tsx`
(title + children + Escape/backdrop-click to close) and refactored `SampleWorkflowPanel.tsx`'s Add Material,
Set/Edit Rate, Report/Edit Damage, Add/Edit Other Charge, Edit Costing, the customer decision form, Add
Comment, and Upload Attachment into Modal-triggered flows — each is now a button that opens a Modal, submits,
and closes on success, instead of an always-rendered row. Convert-to-Style and the read-only Costing summary
`<dl>` were deliberately left as page sections (a substantial one-way action and a "keep visible" overview,
respectively, not "small" actions). See `COMMON_FEATURES.md`'s 2026-08-21 entry for the reusable patterns
(store the whole target row as modal state, not just an id; one Modal + a nullable-target state for
add-vs-edit of the same shape). Verified live: opened/closed via Escape, submitted a real Add Material →
Set Rate → Add Comment sequence through the actual modals (each closed on success, Final Total recomputed
correctly to a hand-verified 138.56), confirmed the Manual Cost/Unit field correctly disappears in the Edit
Costing modal once real pricing exists, then cleaned up the test data and confirmed the record's display
matched its pre-test state exactly. `npx tsc --noEmit`, `npm run lint`, and `npm test` (40/40) all clean.

## Phase 6 extension — Purchase Request (pre-PO authorization workflow) (2026-08-21) — SUPERSEDED SAME DAY

**Superseded within hours by "Phase 6 extension — Material Request" below.** The user reviewed this design
against the real business flow and correctly identified that it had drifted from the actual requirement: an
approval-gated, pricing-carrying document living inside `purchasing` conflated two genuinely separate
responsibilities — "what does a department internally need" (Inventory's job) and "what are we
commercially buying from a supplier" (Purchasing's job) — and added an authorize/approve-line workflow
nobody had actually asked for. The whole module (schema, service, routes, UI, RBAC widening) was removed
and replaced same-day; nothing from this section is still in the codebase. Left in place, not deleted, as a
record of what was tried and why — see the Material Request section for the corrected design and the exact
migration/data-cleanup steps taken to remove this one cleanly.

Built following a full 20-section analysis-only report on a "Requisition Slip" reference module (3 screenshots
the user supplied) — explicitly scoped to STOP after the report and wait for approval, then a design→critique→
build→verify cycle (EnterPlanMode → 2 parallel Explore agents → Plan-agent critique → approval → implementation)
on the report's top "DO NEXT" item. Fills the `DocumentType.PURCHASE_REQUEST`/`RelatedModule.PURCHASE_REQUEST`
placeholders reserved since Phase 1 planning (prefix `PR`, e.g. `PR-2026-00001`) — the first real caller of
either enum value. Built inside the *existing* `src/modules/purchasing/` module (not a new one), directly
alongside `PurchaseOrder`/`GoodsReceipt`, reusing that module's RBAC grants and the currency/receipt lessons
already learned there.

**Schema (2 new tables, 2 new enums, migration `add_purchase_requests`)**: `PurchaseRequest` (header —
Department/Reference/Delivery Date/"Receive At" Warehouse/Remarks, `status` derived except the manual
`ON_HOLD`/`CANCELLED`/`CLOSED` transitions, `statusBeforeHold` reused verbatim from `PurchaseOrder`'s own
Hold/Resume pattern, `isAuthorized`/`authorizedAt`/`authorizedByUserId` — a reversible lock mirroring
`SampleVersion.isCostingLocked`'s exact shape but gated on the `approve` RBAC action rather than `edit`,
`estimatedTotalAmount` stored rollup), `PurchaseRequestItem` (Material/Color/Shade — reusing the `Color`/
`FabricDye` masters exactly like `SampleMaterial`, not free text — `requestedQuantity`/`rate`/
`approvedQuantity`/`lineStatus`/`rejectionReason`/`salesOrderId` traceability for "Add from BOM" lines).
`PurchaseOrderItem.purchaseRequestItemId` (`@unique`, nullable) is the single authoritative FK back to the
originating line — same "one real FK, virtual back-relation" shape already proven on
`BuyerEnquiryLine.sampleRequestId`; `@unique` is load-bearing, not decorative: it's what turns a concurrent
double-"Generate PO" race into a DB-level `P2002` instead of a silent double-order.
- **`approvedQuantity` is deliberately non-nullable, defaulting to 0** — a `null` (not reviewed) vs. `0`
  (rejected) dual signal would be the exact `SampleMaterial.damagedQuantity` landmine repeated on purpose
  (a Decimal `0` serializes as the JSON string `"0"`, which is truthy). `lineStatus` alone is the "has this
  been reviewed" signal; the UI shows "—" while `PENDING_REVIEW` regardless of the underlying `0`.
- **`computePurchaseRequestStatus(lines)`** (`purchase-request.service.ts`) is a small pure function with a
  critical guard a Plan-agent critique caught before any code was written: `if (approvedLines.length === 0)
  return "OPEN"` *before* checking "every approved line converted" — without it, an all-rejected or
  all-still-pending request would vacuously satisfy that check over an empty set and wrongly report
  `CONVERTED_TO_PO`. Verified live on a real 2-line request (one approved+converted, one rejected) — status
  correctly landed on `CONVERTED_TO_PO` (only the approved line counts), and a second request confirmed
  `PARTIALLY_CONVERTED`/`OPEN` render correctly for the intermediate cases.
- **Maker/checker workflow**: `approveRequestLine`/`rejectRequestLine`/`approveAllLines` are gated on
  `purchasing.edit` and deliberately **not** self-approval-guarded (matches the project's established
  pattern that only the *final* authority checkpoint gets that guard — a Sales Order's own creator fills in
  its own lines with no gate either). `authorizePurchaseRequest` is the real checkpoint: gated
  `purchasing.approve` **and** self-approval-guarded via `PermissionService`'s existing
  `resourceContext.createdBy` mechanism, same as `approvePurchaseOrder()`. `unauthorizePurchaseRequest` is
  gated `approve` but **not** self-guarded (undoing isn't the same risk as granting) and is permanently
  blocked once any line has actually converted — enforced via a guarded `updateMany`
  (`where: { isAuthorized: true, status: { notIn: ["PARTIALLY_CONVERTED", "CONVERTED_TO_PO", "CANCELLED"] } }`),
  not a plain read-then-write.
- **`generatePurchaseOrdersFromRequest()`** groups `APPROVED`, not-yet-linked lines by the material's own
  `defaultSupplierId` (rejecting the whole call with a `VALIDATION_ERROR` naming every material that needs a
  manual supplier assignment, rather than silently skipping any), then calls the *existing, unchanged*
  `createPurchaseOrder()` once per supplier group — each resulting `PurchaseOrderItem` carries
  `purchaseRequestItemId` back to its origin. A concurrent double-generate hits the `@unique` constraint
  (Prisma `P2002`), caught per-group and reported as a failed group rather than aborting every other group's
  result. Explicitly asserts `purchasing.create` (not `edit`) since this functionally creates real
  `PurchaseOrder`s — a gap a Plan-agent critique flagged (`MERCHANDISER`/`PRODUCTION_MANAGER`, the realistic
  requester personas, previously had `create`+no `edit` on `purchasing` at all — **deliberately widened** to
  add `edit` to both roles in `src/config/rbac.ts`, an explained widening rather than silent inheritance of
  the gap).
- **`addLinesFromBom()`** reuses the *unchanged* `getMaterialRequirements()` from `bom-mrp/mrp.service.ts`
  (already company-scoped — no second tenant check needed) to append shortfall lines from a Sales Order's
  BOM, tagged with `salesOrderId` for traceability. Appends via a dedicated `createMany` repository call
  rather than routing through the header's `replaceLines()` full-replace — reconstructing every existing
  line's `lineStatus`/`approvedQuantity` just to add new ones would have been fragile for no reason.
- **Small additive threading, not a new mechanism**: `purchase-order.schema.ts`'s item schema and
  `purchase-order.service.ts`'s `createPurchaseOrder()` item-mapping both gained an optional
  `purchaseRequestItemId` — direct PO creation (no Purchase Request involved) is completely unaffected, the
  field is simply absent from that payload. `PurchaseOrderWorkflowPanel.tsx` shows "Originated from Purchase
  Request PR-XXXXX" (linked) whenever any item carries that FK — closes a traceability gap the critique
  flagged: `createPurchaseOrder()` always attributes `requestedByUserId` to whoever clicked Generate, not the
  original requester, so without this a reviewer approving the generated PO would have no visibility into the
  original request's own review trail.
- New `BusinessRuleError` code `OVER_APPROVAL_NOT_ALLOWED` (409) — approving a line above its
  `requestedQuantity`, same 2-line-addition convention as `OVER_RECEIPT_NOT_ALLOWED`.
- **UI**: full pages mirroring `purchase-orders`' exact shape (list/new/detail/edit) plus the small-focused-
  action convention this session already established for Sampling — Approve/Reject line, Add from BOM, and
  Generate Purchase Order(s) are all `Modal`-driven, Authorize/Un-Authorize/Cancel use `ConfirmModal`. The
  Generate-PO modal has no separate "preview" endpoint — it optimistically calls the real endpoint, and a
  `VALIDATION_ERROR` naming unresolved materials turns into an inline supplier-picker for exactly those
  materials rather than a dead-end error, then resubmits.
- **Migration-tooling gotcha (new, worth remembering)**: `npx prisma migrate dev` refuses to run at all in
  this non-interactive shell once Prisma's own risk-confirmation prompt fires (here, triggered by adding a
  `@unique` constraint to a nullable column) — `--create-only` doesn't help, and `npx prisma migrate diff
  --from-migrations ... --to-schema ...` additionally requires a `shadowDatabaseUrl` this project's
  `prisma.config.ts` doesn't define. The workaround that unblocked this: `npx prisma migrate diff
  --from-config-datasource prisma.config.ts --to-schema prisma/schema.prisma --script` diffs directly against
  the *live* dev database (no shadow DB needed) and prints the raw SQL; hand-place that into a new
  `prisma/migrations/<timestamp>_<name>/migration.sql`, apply it via `npx prisma db execute --file <path>`,
  then mark it tracked with `npx prisma migrate resolve --applied <name>` — mirrors this project's own
  earlier-documented precedent for `_prisma_migrations` recovery, just for a different root cause this time.
- **Not yet built** (explicitly out of scope per the original analysis report's DO LATER/DO NOT BUILD
  buckets): Issue Requisition (store→department handout — needs a real Production consumer, Phase 5C),
  Purchase-Requisition history as a dedicated UI (relies on `AuditLog` + the derived
  `purchaseOrderItem !== null` trail instead), a separate Authorization/RequisitionType table, currency
  fields on `PurchaseRequestItem` (budget estimate only, implicit base currency), `productionOrderId`
  traceability (add nullable once Phase 5C exists).
- **Verified live end-to-end** through the real UI (not just direct API calls): created `PR-2026-00001`
  (Cotton Fabric, Navy Blue / Indigo shade, 100 MTR) → Approve All Pending → Authorize (self-approval bypass
  confirmed for the SUPER_ADMIN creator, same as every other Approve action this session) → Generate Purchase
  Order(s) → `PO-2026-00004` created with the "Originated from Purchase Request PR-2026-00001" link rendering
  correctly on the PO's own page; created a second request `PR-2026-00002` (2 lines) to exercise the mixed
  case — approved one line, rejected the other with a required reason, confirmed status stayed `OPEN` (not
  vacuously `CONVERTED_TO_PO`) — authorized, un-authorized successfully *before* any conversion (confirming
  that path isn't blocked prematurely), re-authorized, generated `PO-2026-00005` off the one approved line,
  confirmed status correctly landed on `CONVERTED_TO_PO`; then confirmed via direct `fetch()` calls that both
  `unauthorize` and `cancel` now correctly return `409 INVALID_STATE_TRANSITION` with the exact expected
  messages, that editing the now-authorized `PR-2026-00001` returns the exact "unauthorize it first" `409`,
  and that its Edit page correctly `404`s. `npx tsc --noEmit`, `npm run lint`, and `npm test` (48/48) all
  clean throughout; zero server or console errors during the full walkthrough.

## Phase 6 extension — Material Request replaces Purchase Request (2026-08-21)

User provided a full business-rule spec re-analyzing the ERP's procurement/inventory split and asked for a
suggestion before coding. The core correction: **Purchase Request (above) conflated two separate
responsibilities** — "what does a department internally need" belongs to Inventory, "what are we
commercially buying from a supplier" belongs to Purchasing — and added an authorize/approve-line workflow
the actual business flow never called for. Analyzed the existing codebase first (an Explore-agent pass
confirmed: Inventory was a thin ledger-only module with zero request/reservation concept; no
`MATERIAL_REQUEST`/`MATERIAL_ISSUE` document type existed yet, only unused `InventoryTransactionType` enum
values of the same name; Purchase Order/Goods Receipt already matched the target architecture and needed no
change; blast radius of removing Purchase Request was fully contained). Presented the analysis + a concrete
design, then used two targeted questions (drop the old module cleanly vs. keep both — dropped cleanly;
add a per-line triage/approval step vs. straight stock-check-and-issue — no approval step, matching the
user's own diagram) rather than guessing on decisions only the user could make.

**Schema**: dropped `PurchaseRequest`/`PurchaseRequestItem` and their two enums entirely; replaced with
`MaterialRequest`/`MaterialRequestItem` (migration
`replace_purchase_requisition_with_material_request`) — owned by Inventory's domain, not Purchasing's.
Deliberate differences from the removed design: **no `rate`/pricing field anywhere** (Material Request is
never a commercial document); **no `isAuthorized`/authorize/unauthorize** (no approval gate — an
inventory/warehouse user directly checks stock and issues, matching "Production/Department → Material
Request → Inventory checks stock → Issue or escalate" exactly); **no stored `lineStatus` column** — a
line's state (pending/partially issued/fully issued/escalated) is fully derived from `issuedQuantity` plus
whether a `purchaseOrderItem` exists, deliberately avoiding a second source of truth that could drift (the
same class of bug this project has fixed twice already by *adding* a stored status column — this time the
fix was to *not add one in the first place*). `warehouseId` is required (not optional like the old
"Receive At") since Material Issue must decrement one real warehouse's stock balance.
`PurchaseOrderItem.purchaseRequestItemId` renamed to `materialRequestItemId` (same `@unique`
single-authoritative-FK shape, unchanged reasoning).
- **Migration gotcha hit and fixed**: a mechanical find-and-replace across the schema (`purchaseRequestItems`
  → `materialRequestItems` on `Product`/`Color`/`UnitOfMeasure`/`FabricDye`/`SalesOrder`) carried over the
  *shape* of the old `SalesOrder` back-relation without checking whether the new item model still had the
  field it was pairing with — it didn't (that traceability moved to the header, `MaterialRequest.salesOrderId`,
  not the line). `prisma validate` caught it immediately with an exact "missing opposite relation field"
  error pointing at the orphaned line; a second, more insidious layer was that an earlier `prisma format` run
  had already silently auto-added a phantom `salesOrderId`/`salesOrder` column onto `MaterialRequestItem` to
  paper over the same orphaned relation before it was caught — worth remembering that `prisma format` will
  silently synthesize a missing relation side rather than erroring, so a stray back-relation can survive a
  format pass and only surfaces via `prisma validate` (or by noticing an unexpected column in the generated
  migration SQL, which is exactly how this was actually caught — a stray camelCase `"salesOrderId"` UUID
  column with no `@map` in the generated `CREATE TABLE`, inconsistent with every other column's snake_case).
- **Data migration note**: the 3 real `document_sequences` counter rows and `PurchaseRequest` test records
  (including the user's own "test" record, `PR-2026-00003`) were dropped per the user's explicit choice — the
  stale `PURCHASE_REQUEST` `document_sequences` row had to be deleted *before* the `DocumentType` enum swap
  could succeed (Postgres refuses to migrate an enum column to a new type that no longer contains a value
  still present in the data). The 2 already-generated demo POs (`PO-2026-00004`/`00005`) were **not**
  affected at all beyond losing their now-meaningless "Originated from" traceability line — confirmed live,
  both still show their correct supplier/line/amount data untouched after the migration.

**Service** (`src/modules/inventory/material-request.schema.ts`/`.repository.ts`/`.service.ts`, new
module inside Inventory, not Purchasing): `issueMaterialRequestLine()` is the "Inventory checks stock" step
— two independent caps, both real and race-free: cannot issue more than remains on the line (guarded
`updateMany` on `issuedQuantity`, same idiom as every other accumulator in this project) and cannot issue
more than is actually on hand at the request's own warehouse (checked via a new
`getAvailableQuantity(companyId, productId, warehouseId)` in `inventory.service.ts` — the company-wide
`sumAvailableByProductIds` MRP already had wasn't warehouse-specific enough for a real stock decrement).
`generatePurchaseOrdersForShortfall()` is a direct relocation of the removed module's mature
`generatePurchaseOrdersFromRequest()` engine (supplier grouping, per-group partial-failure tolerance, P2002
concurrent-escalation protection) — one behavioral fix during the move: it now orders the *remaining*
shortfall (`requestedQuantity - issuedQuantity`), not the original full line quantity, since some of the line
may already be sitting in a warehouse from a prior partial issue. `computeMaterialRequestStatus()` keeps the
exact empty-set guard lesson (`if (lines.length === 0) return "OPEN"`) already learned twice on this
project's other status-derivation functions.
- **Real-state guards, not label-based**: editing and cancelling are blocked once anything has *actually*
  been issued or escalated (`assertNothingIssuedOrEscalated()`, checked via `countIssuedLines`/
  `countLinkedPurchaseOrderItems`), never inferred from the status label alone — the same lesson this
  project has now learned three times (Sampling's Hold/Resume bug, Purchasing's cancel-from-`ON_HOLD` bug,
  and this one).
- **RBAC**: the `purchasing` grant widening given to `MERCHANDISER`/`PRODUCTION_MANAGER` for the old module
  was reverted back to `["view", "create"]` (they don't touch real commercial POs); `inventory` widened to
  `["view", "create", "edit"]` for both instead, since raising/editing their own Material Requests is an
  Inventory action. `generatePurchaseOrdersForShortfall()` still explicitly asserts `purchasing.create`
  internally (it creates real `PurchaseOrder`s) — the same "assert the permission the action actually needs,
  not the one the route happens to sit under" discipline as before.
- **UI bug caught and fixed during live verification**: the Edit page's guard only checked the header's
  derived status label (`CANCELLED`/`CLOSED`), which let a `FULFILLED` (or even nominally `OPEN`, if only
  some lines had activity) request's Edit page render a form that would then fail server-side — a live
  reproduction of the exact "check the label, not the real state" bug class this file just finished warning
  about in the paragraph above, caught in the same session it was written. Fixed by deriving `hasActivity`
  from the lines themselves (`issuedQuantity > 0` or `purchaseOrderItem !== null`) in both the Edit page's
  `notFound()` guard and the detail panel's Edit-link visibility, matching the service's own real guard
  exactly instead of approximating it from the status label.
- New `BusinessRuleError` code `OVER_ISSUE_NOT_ALLOWED` (409); removed the now-unused
  `OVER_APPROVAL_NOT_ALLOWED` from the closed set rather than leaving dead code behind.
- **UI**: full pages mirroring the removed module's shape (list/new/detail/edit), reusing every established
  common component as-is (`Modal`, `ConfirmModal`, `FilePreviewModal`, `DataTable`, `Breadcrumb`,
  `FormField`, `Barcode`) — zero new shared components needed. Sidebar entry "Material Requests" placed
  directly after "Inventory", not near "Purchase Orders".
- **Verified live end-to-end** through the real UI and direct `fetch()` calls together: created
  `MR-2026-00001` (Cotton Fabric 100 MTR with real stock at Fabric Store + Denim Fabric 50 MTR with zero
  stock anywhere) → partially issued 60 MTR of Cotton (confirmed `StockBalance` decremented
  509.144→449.144, exactly −60) → confirmed over-issue (`999`) correctly `409 OVER_ISSUE_NOT_ALLOWED` with
  "only 40 remains" → confirmed issuing the zero-stock Denim line correctly `409
  INSUFFICIENT_RAW_MATERIAL_STOCK` with "Available: 0, Requested: 5" → clicked "Generate Purchase Order(s)"
  once, correctly split into **two** POs by the two materials' different default suppliers
  (`PO-2026-00006`/`Om Fabrics Pvt Ltd` for the Cotton 40 MTR shortfall, `PO-2026-00007`/`Shree Balaji
  Textiles` for the Denim 50 MTR shortfall) — confirmed `PO-2026-00006` shows "Originated from Material
  Request MR-2026-00001" and orders exactly **40** MTR (the shortfall), not the original 100 — confirmed the
  header status correctly derived to `FULFILLED` (every line either issued or escalated) with "No actions
  available"; separately created `MR-2026-00002` (single line, fully issued 5/5) and confirmed its Edit link
  disappears and its Edit page `404`s once fulfilled, while a genuinely untouched fresh request still shows
  a working Edit link (regression check); finally confirmed a **direct** `POST /api/v1/purchase-orders` call
  with zero Material Request involvement still succeeds normally with `materialRequestItemId: null`. `npx
  tsc --noEmit`, `npm run lint`, and `npm test` (49/49) all clean throughout; zero server or console errors
  during the full walkthrough.
- **Not yet built** (explicitly out of scope per the user's own spec): Issue Requisition / department-side
  material handout beyond Material Request itself (no separate document — Material Request already *is*
  this), Stock Transfer/Return/Adjustment as first-class documents (the `InventoryTransactionType` enum
  values exist, no UI/service consumes them yet), a `productionOrderId` traceability field on
  `MaterialRequest` (Production/5C doesn't exist yet — schema left extensible, add it non-breaking later).

## Material Request lifecycle extension — BOM→MR→Issue/Shortfall→PO→GR traceability (2026-08-22)

Closed the gap flagged right after the module above shipped: BOM/MRP's own "Create Purchase Order(s)"
button still bypassed Material Request entirely, creating two independent, uncoordinated paths into
Purchasing. Designed via 3 parallel `Explore` research agents + 2 parallel `Plan` agents synthesized into
one reviewed plan (approved before implementation, per this project's established design→review→build→verify
rhythm), then implemented incrementally.

- **Schema**: new `MaterialRequestType` enum (`PRODUCTION_REQUIREMENT` default / `DAMAGE_REPLACEMENT`) on
  `MaterialRequest`, plus nullable `bomId` (populated only when every selected shortfall row traces to a
  single style — a multi-style request has no one correct BOM to point at) and a self-referencing
  `originalMaterialRequestId`/`replacementRequests` pair (damage replacement points back at the original
  requirement; no `ProductionOrder` FK since Production/5C still doesn't exist). `MaterialRequestItem` gained
  `purchaseReceivedQuantity` (guarded accumulator, same idiom as `issuedQuantity`) and `damageReason`.
  **`PurchaseOrderItem.materialRequestItemId` lost its `@unique`** (replaced by a plain index) — a single
  Material Request line can now legitimately spawn more than one `PurchaseOrderItem` over its lifetime, since
  Purchase Qty is user-edited and no longer forced to equal the shortfall (a first PO can cover part of it,
  a later one the rest). The accepted trade-off: the `@unique` used to make a concurrent double-"Generate PO"
  attempt fail loudly via Prisma P2002; removing it moves that protection to an explicit
  re-check-`availableToOrderQuantity`-immediately-before-each-`createPurchaseOrder()`-call inside the service
  instead — not airtight against a true race, but this is a manual, low-frequency, reviewed action, not a hot
  concurrent path, so real locking here would be exactly the "complicated stock reservation" the user said
  not to build.
- **Status derivation fix, not just a type change**: `computeMaterialRequestStatus()`'s old "any linked PO
  item exists → fulfilled" heuristic stopped being safe the moment PO quantity became editable — a line
  could have an active PO for 4 out of a 10-unit shortfall and the old code would still call it done. Fixed
  with `isLineFulfilled()`: a line counts as fulfilled only once `issuedQuantity` plus the sum of its *active*
  (non-cancelled-PO) linked `orderedQuantity` actually covers `requestedQuantity`. A new, deliberately
  separate `computeRequiresPurchaseAction()` boolean (surfaced as an amber "Purchase Required" badge, not
  folded into the status enum) — a request can be `PARTIALLY_FULFILLED` on some lines *and* still need
  purchasing on others, a fact one mutually-exclusive status column can't express. `DRAFT`/`PARTIALLY_ISSUED`
  /`PURCHASE_REQUIRED` were all deliberately rejected as new enum values for the same "derive, don't
  duplicate" reasons already established elsewhere in this codebase (no stored `lineStatus` anywhere else
  either).
- **Quantity projections, computed not stored**: `remainingQuantity = requested − issued` (deliberately does
  *not* subtract already-ordered quantity — that's what separates it from `availableToOrderQuantity`, and is
  what makes repeat/partial escalation safe: without the split, a second "Generate PO" pass would re-suggest
  the *full* remaining shortfall and double-order the part an earlier PO already covers).
  `purchaseOrderedQuantity` sums active-PO quantity; `availableToOrderQuantity = max(0, remaining −
  purchaseOrdered)` is what the review modal suggests. `purchaseReceivedQuantity` is deliberately **not**
  wired into `remainingQuantity` at all — receiving goods against a linked PO grows the warehouse's general
  stock, it does not auto-fulfill the request line; that still requires an explicit Issue action by the
  Inventory Incharge. Verified live: after a full 400 MTR receipt against a 400 MTR PO, the MR line's
  "Purchase-Received" column showed 400 while "Remaining" stayed unchanged at 247.856.
- **Goods-Receipt → Material-Request rollup, fail-soft by design**: `createGoodsReceipt()`/
  `reverseGoodsReceiptLine()` (in `goods-receipt.service.ts`, not the Material Request module — the write
  belongs where the transaction already is) increment/decrement `purchaseReceivedQuantity` via the same
  guarded-`updateMany` idiom as every other accumulator in this project, converting through the material's
  UOM chain. A lost race or an unconvertible UOM skips the rollup silently rather than aborting the goods
  receipt — this field is a secondary traceability mirror, not a stock-affecting write (that protection
  already happened one step earlier via the existing PO-item receive guard). Verified live end-to-end:
  received 400 MTR (rollup → 400), reversed 40 MTR with a reason (rollup correctly decremented → 350).
- **BOM/MRP page rewritten**: removed the entire supplier-grouping/direct-PO-creation UI and logic from
  `/bom-mrp/requirements`; replaced with a warehouse picker and a single "Generate Material Request" button
  hitting a new `POST /api/v1/bom-mrp/generate-material-request` (asserts `inventory.create`, not
  `bom_mrp.create`, so a view-only MRP user can't back-door a Material Request through this button). A
  proactive, advisory duplicate-request check (`GET /api/v1/material-requests/duplicate-check`, reusing the
  same repository query the server-side hard-block uses) shows an inline amber warning per affected material
  *before* the click, not only as a rejected-submit error; the server-side check is the real gate, with an
  `overrideDuplicateCheck` escape hatch surfaced as a "Generate Anyway" button on the exact
  `DUPLICATE_MATERIAL_REQUEST_EXISTS` (409) rejection. Verified live: selecting the same Sales
  Order/material twice showed the exact remaining-quantity warning with a working link, and "Generate
  Anyway" correctly created a second request despite it.
- **Redesigned "Generate Purchase Order(s)" review modal**: now fetches a dedicated `GET` on the existing
  `.../generate-purchase-orders` route (Requested/Available Stock/Issued/Remaining/Suggested PO qty/
  default supplier per still-open line in one call) instead of reusing the panel's already-loaded data,
  which lacked stock availability. Purchase Qty is a genuinely editable number input, pre-filled with the
  suggestion but never forced to match it (verified live: edited Cotton Fabric's suggested 247.856 up to 400
  and the resulting PO ordered exactly 400); Supplier is per-line and editable; one optional Expected
  Delivery Date applies to every order the batch creates. A "Purchase Quantity Changed" audit entry is
  written per line whose submitted quantity differs from the suggestion, visible in a new **Timeline**
  section (`GET /api/v1/material-requests/[id]/audit-log`, scoped to the request's own `material_requests`/
  `material_request_items` audit rows — deep-linking into a linked PO's own page is how a user follows the
  trail further, not a merged cross-table feed).
- **Damage Replacement**: same `createMaterialRequest()` function, no second code path — a Zod `.refine()`
  requires `originalMaterialRequestId` and a per-line `damageReason` only when `requestType ===
  "DAMAGE_REPLACEMENT"`. The original request is loaded once purely to confirm it exists/belongs to the same
  company; nothing in this function ever writes to it, so "must not mutate the original" is structural, not
  a promise. Verified live: `MR-2026-00006` (Damage Replacement, linked to `MR-2026-00005`) created correctly
  with its own Damage Reason column, while `MR-2026-00005` itself remained completely unchanged.
- **Regression-verified, not just asserted**: a direct `POST /api/v1/purchase-orders` call with no
  `materialRequestItemId` at all still returns `201` unaffected; `issueMaterialRequestLine`'s
  `OVER_ISSUE_NOT_ALLOWED` and `INSUFFICIENT_RAW_MATERIAL_STOCK` guards both still fire with their exact
  messages.
- **Browser-automation gotcha hit twice this session, not an app bug**: the sandboxed browser tool's
  `form_input` on a plain `<select>` intermittently committed the *wrong* option (once landing on the last
  option in the list) despite being called with the exact visible text of the intended option — confirmed by
  cross-checking the saved value via a direct API `fetch()` immediately after. Root-caused as a tool
  limitation, not a React state bug, by re-reading the accessibility tree immediately after each `form_input`
  call before proceeding (the correct value was reliably visible in that immediate re-read); worth doing this
  defensively for every future `<select>` interaction via this tool, and falling back to a direct
  `fetch()`-based `PATCH`/`POST` to correct or re-verify state when a page action's visible result doesn't
  match what was submitted.
- Extended `src/modules/inventory/material-request.service.test.ts` to 26 tests: the rewritten
  `computeMaterialRequestStatus`/new `computeRequiresPurchaseAction` cases (including the specific
  active-vs-cancelled-PO and partial-coverage regressions the old heuristic would have missed),
  `generatePurchaseOrdersForShortfall` (submitted-supplier grouping, stale/already-covered line skipping,
  one-group-failure-doesn't-abort-another), the duplicate-check repository query, and
  `createMaterialRequestFromShortfall` (server-side requirement recomputation, single-vs-multi-style `bomId`
  population, the duplicate block and its override). `npx tsc --noEmit`, `npm run lint`, and `npm test`
  (66/66) all clean throughout; full manual browser walkthrough covering every numbered step in the reviewed
  plan's testing section, including the two goods-receipt rollup directions and the damage-replacement flow,
  with zero server or console errors.

## Phase 6 completion — Stock Movements (Transfer / Adjustment / Return to Supplier) (2026-08-23)

Closed the last open item on Phase 6's roadmap line. Scoped via one AskUserQuestion: Return to Supplier is
built stock-side only (a real physical movement out of a warehouse, ledger + a `StockMovement` header for
traceability) — a supplier credit note is a Phase 7 (Accounts) concept that doesn't exist yet, so the
financial side is deliberately deferred, the same way Goods Receipt already operates independently of
invoicing.

- **Schema**: one new unified `StockMovement`/`StockMovementItem` pair (migration `add_stock_movements`),
  not three separate tables — this is Phase 1's own original architecture-doc decision ("material
  issues/returns/transfers merged into one `stock_movements` table via a `movement_type` discriminator"),
  finally implemented rather than re-derived. `StockMovementType` (`TRANSFER`/`ADJUSTMENT`/
  `RETURN_TO_SUPPLIER`); a single `warehouseId` (the only warehouse for Adjustment/Return, the source for
  Transfer) plus a conditionally-required `toWarehouseId` (Transfer) or `supplierId` (Return). Reused the
  already-reserved `DocumentType.STOCK_MOVEMENT` → prefix `STK` (numbers render as `STK-2026-00001`, zero
  numbering-service changes needed) and the already-reserved `InventoryTransactionType.ADJUSTMENT`/
  `STOCK_TRANSFER` enum values (unused since Phase 1 planning); added the one genuinely new value,
  `RETURN_TO_SUPPLIER`. Immutable once created — no delete/edit column, matching every other inventory
  transactional table in this project; a mistake is corrected with a new, opposite-direction
  `StockMovement`, not an edit endpoint on this one.
- **Deliberately scoped to raw materials only** (reusing the existing `MaterialPicker` + `/api/v1/materials`
  verbatim, zero new picker component) — matches every other Inventory-side document in this project
  (Material Request, Purchase Order, Goods Receipt); finished-goods stock movements are a Dispatch-phase
  (8) concern with its own carton/picking workflow, not retrofitted here.
- **One shared code path for every movement type**: `createStockMovement()` posts through the *existing*
  `recordInventoryTransaction()` ledger engine unchanged — a Transfer posts two entries (negative at
  source, positive at destination) inside one transaction, so the two sides can never observably disagree,
  even under a mid-write crash; Adjustment posts the line's own signed quantity as-is (positive = stock
  found, negative = write-off); Return to Supplier posts one negative entry. No new low-level ledger
  mechanism — Stock Movement is the fourth caller of an engine already proven by Goods Receipt, Material
  Request, and Production.
- **Stock-sufficiency check, not a DB-level guard**: a pre-write check via the existing
  `getAvailableQuantity()` blocks a Transfer/Return/negative-Adjustment that would take a warehouse's
  balance negative, throwing the new `INSUFFICIENT_STOCK_FOR_MOVEMENT` (409) — the same "manual,
  low-frequency, reviewed action; a pre-check is enough, a hot-path race guard isn't warranted" tradeoff
  this project already accepted for Material Request's own issue-from-stock check, applied consistently
  rather than inventing a stricter standard for this one feature.
- **RBAC**: reused the existing `inventory` module's `create`/`view` actions — no new module, no approval
  gate, matching this project's now-repeated "no unnecessary approval states" conclusion (Material Request
  superseding the approval-gated Purchase Request design, Sampling's costing lock being the one place a
  real maker/checker split was actually needed).
- **UI**: `/inventory/stock-movements` (list, `DataTable`), `/new` (a single form whose fields
  conditionally show/hide by Movement Type — From/To Warehouse for Transfer, Warehouse+Supplier for Return,
  Warehouse+required Reason for Adjustment, with a "+ found / − written off" hint on the quantity field),
  `/[id]` (a plain read-only Server Component detail view — no interactive workflow panel needed for an
  immutable document). Sidebar gained "Stock Movements" under Inventory.
- **Gotcha hit again, same root cause as twice before this project**: after `prisma db execute` + `prisma
  generate`, the already-running dev server's in-memory `@prisma/client` was stale, throwing `Cannot read
  properties of undefined (reading 'findMany')` on the new `stockMovement` delegate until the dev server was
  fully stopped and restarted — CLAUDE.md's own documented gotcha, bitten a third time, worth internalizing
  as a reflex ("just changed the schema → restart the dev server before testing," not "if something breaks
  after a schema change").
- **New, unrelated tooling gotcha found this session**: running `npx tsc --noEmit` while the dev server is
  live can transiently fail with a `TS1128` syntax error inside the Next.js–generated
  `.next/dev/types/validator.ts` (a route-type-validator file the dev server continuously rewrites as routes
  are exercised) — caught it reading a genuinely corrupted mid-rewrite file (`Specific` truncated to
  `ecific`), confirmed by inspecting the exact byte range, and resolved by clearing `.next/dev/types`/`.next/types`
  and letting the dev server regenerate them (a full dev-server restart, or any page hit after clearing,
  is enough). Not a real source-code defect — if a future `tsc` run ever produces an inexplicable syntax
  error pointing inside `.next/`, this is almost certainly the cause; don't chase it as a real bug.
- 6 new unit tests (`stock-movement.service.test.ts`, 93/93 project-wide): both ledger entries posted
  correctly for a Transfer, the over-transfer rejection, Return to Supplier's single negative entry, a
  positive Adjustment skipping the stock check entirely, a negative Adjustment correctly rejected/allowed
  against real availability.
- **Verified live end-to-end** through the real UI and direct API calls together (the sandboxed browser's
  own documented `form_input`-on-`<select>` unreliability was hit again on this form specifically —
  confirmed via a stale ref-map error immediately after a select changed the form's own conditional fields
  — so verification switched to direct `fetch()` calls per this project's own established fallback
  discipline): created `STK-2026-00001` (Transfer, 50 MTR Cotton Fabric, Fabric Store → Raw Material
  Godam) and hand-verified both sides of the ledger (694.144→644.144 at source, 0→50 at destination);
  confirmed an over-transfer (9999 MTR) correctly `409`s with the exact expected message; created
  `STK-2026-00002` (Adjustment, +5 found) and `STK-2026-00003` (Return to Supplier, −10) and confirmed the
  resulting balance (50+5−10=45) matched exactly; confirmed a negative Adjustment exceeding real
  availability correctly `409`s; confirmed the list page renders all three movement types with correct
  warehouse-routing display and the detail page renders a Transfer's From/To Warehouse and line items
  correctly. `npx tsc --noEmit`, `npm run lint`, and `npm test` (93/93) all clean throughout.
- **Not built** (explicitly out of scope, matching the AskUserQuestion decision and this project's own
  "don't build for hypothetical future requirements" discipline): the supplier credit-note/financial side
  of Return to Supplier (Phase 7), a reversal/void endpoint for a posted Stock Movement (corrections are a
  new opposite-direction movement, matching the "no delete column on inventory transactional tables"
  convention already established), Opening Stock manual entry (still separately deferred, unrelated to this
  pass), and finished-goods/style-level stock movements (Dispatch phase's own scope).

**Phase 6 is now fully done** — Purchase Order, Goods Receipt (with fabric roll tracking), the stock
ledger, Material Request (with full BOM→MR→Issue/Shortfall→PO→GR traceability), and Stock Movements
(Transfer/Adjustment/Return to Supplier) are all built, tested, and verified live.

## Phase 7A — Chart of Accounts, Tax Config, Journal Engine (2026-08-24)

First slice of Phase 7 (Accounts), on a new `phase-7-accounts` branch. Built via the established
design→Explore→Plan-agent-critique→build→verify rhythm.

- **Schema**: `ChartOfAccount` (self-referencing `parentAccountId`, schema-only for now — no hierarchy UI
  yet, matching the `ProductionStage.parentStageId` precedent; `isSystemAccount` protects seeded control
  accounts from deactivation), `TaxType`/`TaxRate` (effective-dated, service-layer overlap validation on
  `[effectiveFrom, effectiveTo)`), `Journal`/`JournalLine` (`sourceModule`/`sourceRecordId` reuse the
  existing `RelatedModule` enum as a polymorphic discriminator for later slices to populate). Hand-added
  CHECK constraints on `journal_lines` (non-negative amounts, never both debit and credit on one line) —
  same precedent as `job_orders_quantity_consistency_check`; no DB trigger for balance validation (confirmed
  zero `CREATE TRIGGER` statements exist anywhere in this codebase — app-layer check only, matching real
  practice over CLAUDE.md's own aspirational trigger language for inventory).
- **Journal engine** (`src/modules/accounts/journal.service.ts`): `postJournal()` recomputes
  `totalDebit`/`totalCredit` from a fresh DB read inside the transaction (never a client-submitted total),
  guarded-conditional status flip (`JournalRepository.updateStatusConditional`, same race-closing idiom as
  `SalesOrderRepository`'s), and is deliberately self-approval-guarded (`PermissionService.assert(...,
  "accounts", "post", { createdBy })`) — a journal moving real ledger balances gets the same maker/checker
  rigor as a Payment approval, even though it means a solo `ACCOUNTS_MANAGER` can't post their own
  manually-created journal. `reverseJournal()` creates a new journal with every line flipped, auto-posts it
  via an internal `postJournalCore()` (exported for reuse) that deliberately skips the permission check
  (the reversal's `createdByUserId` is unavoidably always the actor, so routing it through the public
  self-approval-guarded path would make reversal unusable for anyone but `SUPER_ADMIN`) — the original
  journal's own status never changes, since a posted journal is an immutable historical fact, not something
  that "un-happens." No new `"reverse"` RBAC action — reuses the existing `"cancel"` action, which already
  matches "gated to Accounts Manager+" (`ACCOUNTS_EXECUTIVE` lacks `cancel`).
- Seeded a default Chart of Accounts (Cash, Bank, AR, AP, GST Payable/Input Credit, Sales Revenue, COGS,
  expense heads) and GST tax rates (5/12/18%) via a one-off script against the real dev DB — `prisma db
  seed` is not safe to re-run against it (documented gotcha from earlier phases).
- **Verified live end-to-end**: balanced manual journal posted, ledger/trial-balance updated correctly;
  unbalanced post rejected (422 `UNBALANCED_JOURNAL`); edit/cancel blocked once posted (409); reversal nets
  to zero on both accounts with the original showing a "Reversed by JRN-…" badge; system-account and
  referenced-account deactivation blocked (409 `REFERENCED_RECORD_IN_USE`); overlapping tax rate rejected
  (400). Two real bugs caught and fixed during verification: a Server Component passing a function prop to
  a Client Component (not serializable across the RSC boundary), and a Decimal-serialized-as-string-is-
  truthy display bug in a confirmation dialog (the exact bug class `SampleMaterial.damagedQuantity` hit
  earlier this project). `npx tsc --noEmit`, `npm run lint`, and `npm test` (125/125) all clean.
- **Not built this slice** (explicitly deferred): Sales/Purchase Invoices, Payments+Allocations, Expenses,
  account hierarchy UI (`isGroup`/postable-leaf distinction not yet decided), a "default account" resolution
  mapping (deferred to the first invoicing slice that actually needs it).

## Phase 7B — Sales Invoices (2026-08-24)

Second slice, building directly on 7A. Explored via 1 Explore agent (re-verified current schema facts, not
assumed from memory) and reviewed via 1 Plan-agent critique before implementation — it caught two real gaps
a naive design would have shipped with, both fixed before any code was written:

- **Stale-copy hole**: `updateSalesOrder()` allowed a full item/price/customer rewrite while `status ===
  CONFIRMED` with no guard against an already-existing invoice — a DRAFT invoice's copied lines/prices could
  silently desync from a concurrently-edited order. Fixed: `updateSalesOrder()` now throws
  `REFERENCED_RECORD_IN_USE` if an active (non-cancelled) `SalesInvoice` already exists for the order.
- **Real create-race, not just a sequential-check case**: "at most one active invoice per order" needed a
  DB-level guarantee, not a `findFirst`-then-insert check two concurrent requests could both pass. Fixed
  with a hand-added Postgres **partial unique index** — `CREATE UNIQUE INDEX
  sales_invoices_one_active_per_order ON sales_invoices(sales_order_id) WHERE status != 'CANCELLED'` — a
  racing second insert hits `P2002`, caught and translated to `REFERENCED_RECORD_IN_USE`. Chosen over a
  stateful pointer-column approach (the critique's initial suggestion) since Postgres already has the
  native tool for exactly this "at most one non-cancelled child" shape.
- **Schema**: `SalesInvoice`/`SalesInvoiceItem` — quantity/unitPrice always derived server-side from the
  linked `SalesOrderItem`/breakdown, never client-accepted; per-line tax rate is a **manual user choice**
  (nothing maps a Product/HSN code to a `TaxRate` yet); `taxRateId`/`taxPercentage`/`taxAmount` frozen
  directly on the item rather than building CLAUDE.md's originally-planned shared `tax_transactions` table
  — a documented, deliberate deviation (revisit once Purchase Invoices or a third consumer justifies the
  shared shape). Correct branch-scoped uniqueness from day one (`@@unique([companyId, branchId,
  invoiceNumber])`) — several older models (`SalesOrder`, `Journal`, `GoodsReceipt`) have this latent gap,
  not retrofitted here but not propagated into this new model either.
- **Posting** (`postSalesInvoice`): self-approval-guarded like Journal's own post gate; one single
  transaction creates+auto-posts a settlement Journal (Dr Accounts Receivable / Cr Sales Revenue / Cr GST
  Payable if any tax) via 7A's exported `postJournalCore()`, then guarded conditional flips of both the
  invoice (DRAFT→POSTED) and the Sales Order (`CONFIRMED`/`IN_PRODUCTION`→`INVOICED`, the latter via a new
  `SalesOrderRepository.updateStatusConditionalIn()` accepting a status set, since the existing
  `updateStatusConditional` only took one exact value). Uses the specifically-reserved `POSTED_INVOICE_LOCKED`
  (unused since Phase 1) for edit/cancel/post attempts on a non-DRAFT invoice — distinct from the generic
  `INVALID_STATE_TRANSITION`. **No reversal/void path for a POSTED invoice this slice** — a real Credit Note
  is a separate, comparably-sized document type with no reserved enum values anywhere; the documented
  stopgap is reversing the invoice's own linked Journal directly if a correction is truly needed.
- **Verified live end-to-end**: created `INV-2026-00001` against a real confirmed order (`ORD-2026-00001`,
  220 pcs @ ₹9, GST 18%) — correct subtotal (1980)/tax (356.40)/total (2336.40) and due date (invoice date +
  customer's `paymentTermsDays`); a second invoice attempt against the same order blocked
  (`REFERENCED_RECORD_IN_USE`); editing the underlying order blocked once invoiced (same code); posted →
  `JRN-2026-00004` auto-created with the exact Dr AR / Cr Sales Revenue / Cr GST Payable lines, `SalesOrder`
  flipped to `INVOICED`, trial balance reflected it exactly (grand total 4336.40/4336.40 including the
  pre-existing 7A demo journal); edit/cancel/re-post on the posted invoice all correctly blocked with
  `POSTED_INVOICE_LOCKED` (409); cancelling a fresh draft against a second order correctly freed the
  partial-unique-index slot for a new invoice. `npx tsc --noEmit`, `npm run lint`, and `npm test` (136/136,
  11 new) all clean.
- **Not built this slice**: Purchase Invoices (7C, the next slice), Payments+Allocations, Expenses, a real
  Credit Note workflow, any Product/HSN→TaxRate auto-inference.

## Phase 7C — Purchase Invoices (2026-08-24)

Fourth slice, deliberately diverging from 7B's shape in three ways rather than copying it verbatim — each
divergence was explicitly justified and reviewed, not an oversight.

- **Partial, repeatable invoicing, not one-shot-per-order**: multiple Goods Receipts against one PO are
  already a live pattern, so multiple Purchase Invoices are too. A new `PurchaseOrderItem.invoicedQuantity`
  accumulator tracks progress, incremented only at POST time (never DRAFT-creation). **Quantity AND unit
  price are both real user input per line** (not derived, unlike Sales Invoice) — a supplier invoice can
  cover a subset of a PO's lines and routinely bills at a different price than the PO (rate revision,
  discount); freezing price to the PO's number would have made real price variance unrepresentable.
  **Posting never changes `PurchaseOrder.status`** — no invoiced-adjacent status value exists (unlike
  `SalesOrderStatus.INVOICED`), and a single flip wouldn't be semantically correct for an inherently partial
  document; "how much has been invoiced" is derived by comparing `invoicedQuantity` to `receivedQuantity`.
- **A Plan-agent critique caught a genuine cross-module accounting-integrity bug**, not a new-code issue:
  `PurchaseOrderItemRepository.decrementReceived()` (called when reversing a Goods Receipt line, a function
  that predates this slice) was completely unguarded — once `invoicedQuantity` existed, a receipt could be
  reversed below an already-invoiced amount, leaving a posted invoice's Journal entry standing against stock
  the books no longer show as received. Fixed by replacing it with `guardedDecrementReceived`, a **raw-SQL
  conditional update** (`receivedQuantity - decrementBy >= invoicedQuantity`) — **the first use of raw SQL
  anywhere in this codebase**, used narrowly because the guard compares two live, mutable columns, which
  Prisma's `updateMany` `where` clause cannot express (no column-to-column comparison support). The
  symmetric `guardedIncrementInvoiced` (the real over-invoice guard, `invoicedQuantity + incrementBy <=
  receivedQuantity`) uses the identical technique. `reverseGoodsReceiptLine()` now throws
  `OVER_REVERSAL_NOT_ALLOWED` (reused) on guard failure.
- Closed a companion hole the same critique found: `transitionPurchaseOrderStatus()`'s `CANCELLED` branch
  already blocked cancellation once goods had arrived (`countActiveReceipts`), but had no idea invoicing had
  happened at all — a new sibling `countInvoicedItems` check closes it, checked unconditionally including
  after an `ON_HOLD` round-trip (same discipline as the existing receipts guard).
- Explicit eligibility policy: a Purchase Invoice can be created when the PO is `SENT_TO_SUPPLIER`,
  `PARTIALLY_RECEIVED`, `FULLY_RECEIVED`, or **`CLOSED`** — supplier bills routinely arrive after the buyer
  has already closed receiving, so `CLOSED` is deliberately included. `PurchaseInvoiceStatus` mirrors 7B's
  full narrative enum (`DRAFT/POSTED/PARTIALLY_PAID/PAID/CLOSED/CANCELLED`) for future Payments-slice
  consistency, even though this slice's cardinality shape differs from Sales Invoice's.
- A hand-added partial unique index (`purchase_invoices_supplier_invoice_number_unique`, scoped to
  non-cancelled rows) guards against double-entering the same physical supplier bill — 7B's one-invoice-
  per-order constraint incidentally provided this safety net; removing that constraint here required an
  explicit replacement. Debiting `COGS` (an EXPENSE account) directly at invoice-post time — rather than a
  raw-material inventory asset account, which doesn't exist in the seeded Chart of Accounts — is a conscious
  periodic-inventory-style simplification, stated explicitly since it's expensive to unwind later.
- **Verified live end-to-end**: created `PINV-2026-00001` against a real `FULLY_RECEIVED` order
  (`PO-2026-00001`) for a partial quantity (400 of 1000 available) at a manually-entered price (₹235, not
  the PO's own ₹220) with GST 5% — correct subtotal/tax/total; posted → `JRN-2026-00005` with the exact
  Dr COGS / Dr GST-ITC / Cr AP lines, `invoicedQuantity` incremented to 400, **`PurchaseOrder.status`
  confirmed unchanged** (`FULLY_RECEIVED`); a second invoice (`PINV-2026-00002`) against the same order for
  the remaining quantity succeeded (confirming partial/repeatable invoicing actually works); an over-quantity
  create attempt correctly rejected with the exact available amount; a duplicate supplier-reference invoice
  rejected (`REFERENCED_RECORD_IN_USE`); edit/cancel/re-post on a posted invoice all blocked
  (`POSTED_INVOICE_LOCKED`); a Goods Receipt reversal beyond the invoiced floor blocked
  (`OVER_REVERSAL_NOT_ALLOWED`, confirming the cross-module fix); Purchase Order cancellation blocked both
  directly and via an `ON_HOLD` round-trip. `npx tsc --noEmit`, `npm run lint`, and `npm test` (147/147,
  11 new) all clean throughout.
- **Not built this slice**: Payments+Allocations, Expenses, a real Credit Note workflow, any
  Product/HSN→TaxRate auto-inference (same gaps as 7B, still open).

## Phase 7D — Payments + Allocations (2026-08-24)

Fifth slice. A `Payment` records money received from a Customer (`RECEIPT`) or paid to a Supplier
(`PAYMENT_OUT`), allocated across one or more invoices via `PaymentAllocation`; posting it finally wires up
`SalesInvoiceStatus`/`PurchaseInvoiceStatus`'s `PARTIALLY_PAID`/`PAID` values reserved-but-dead since 7B/7C.
Reviewed via a Plan-agent critique before implementation, per this project's established rhythm; a single
shared `PAY-` numbering series for both directions was confirmed with the user (matches the single-table
design — no enum split).

- **`paidAmount` accumulator is safe with the plain Prisma `updateMany` idiom — no raw SQL needed**, unlike
  7C's newer guards: `SalesInvoice`/`PurchaseInvoice.totalAmount` is frozen once `POSTED` (never touched by
  cancel or post), so it's captured once as a JS literal before the transaction and used as the cap —
  the same safety condition that made 7C's *original* `guardedIncrementReceived` safe.
- **A real gap the critique refused to accept as "precedented"**: the generic `reverseJournal()` (7A) had no
  awareness of *why* a journal existed — reversing a Payment's auto-posted journal would desync `paidAmount`
  (and derived invoice status) from the ledger, and unlike Sales/Purchase Invoice's own harmless "no reversal
  path" gap (nothing re-reads their status after posting), `paidAmount` is **load-bearing**: it directly
  gates the next payment via `OVER_PAYMENT_NOT_ALLOWED`. Fixed by adding a `sourceModule` guard directly
  inside `reverseJournal()` — reversal is now blocked for any journal sourced from `PAYMENT`,
  `SALES_INVOICE`, or `PURCHASE_INVOICE`, closing this slice's own gap *and* retroactively closing 7B/7C's
  identical latent one in one change, rather than building a full accumulator-aware reversal flow nobody has
  asked for.
- **Status recompute uses a fresh in-transaction read + unconditional write, not a guarded conditional
  transition** — `updateStatusConditional` is for one-shot transitions keyed to exactly one expected prior
  status; a second or third partial payment has no single "expected prior status" to key against. Follows
  the exact precedent already established in `goods-receipt.service.ts`'s own received-quantity status
  recompute (`findManyForStatusRecompute` + `updateStatusInTx`, both unconditional).
- **Cash/Bank account resolution is keyed off `PaymentType.type` (the `PaymentTypeKind` enum), never off
  `PaymentType.code`** — a real trap the critique flagged: `PaymentType.code` "BANK" (a seeded code) and
  `ChartOfAccount.code` "BANK" are the same string in two unrelated tables purely by coincidence; resolving
  via `ChartOfAccount.findByCode(companyId, paymentType.code)` directly would silently return nothing for
  CHEQUE/CARD/UPI-typed payment types. `{ CASH: "CASH", default: "BANK" }` is the actual resolution rule,
  verified live with a CHEQUE-typed payment type correctly resolving to the BANK account, not failing.
- **`PaymentAllocation` uses two nullable FKs (`salesInvoiceId`/`purchaseInvoiceId`) + a hand-added CHECK**
  (`(sales_invoice_id IS NOT NULL) != (purchase_invoice_id IS NOT NULL)`), not a polymorphic
  `relatedModule`/`relatedRecordId` shape — matches CLAUDE.md's own architecture doc, which lists
  `payment_allocations` as a concrete Accounts table, separate from the explicit polymorphic-tables list.
- **No `updatePayment` — deliberately**: RBAC confirms nobody except `SUPER_ADMIN`'s wildcard has `"edit"`
  on the `payments` module (`ACCOUNTS_MANAGER`: view/create/approve/cancel/export/print; `ACCOUNTS_EXECUTIVE`:
  view/create only). The only DRAFT-stage correction is cancel-and-recreate; confirmed live (`405` on a
  direct `PATCH` attempt — no route exists at all, not just a permission block).
- **Posting is gated on `"approve"`, not `"post"`** — `payments`' RBAC grants use `"approve"` as the real
  verb, matching CLAUDE.md's literal "payments cannot be approved by their own creator" rule. `"approve"` is
  already in `PermissionService`'s `SELF_APPROVAL_GUARDED_ACTIONS`, so the same maker/checker protection
  applies with zero `PermissionService` changes.
- **Verified live end-to-end** through the real UI: created `PAY-2026-00001` (RECEIPT, Bank Transfer) for the
  full outstanding balance of a real `POSTED` Sales Invoice → approved → confirmed the auto-posted Journal
  (Dr Bank / Cr AR, exact amounts) and the invoice flipping to `PAID`; created `PAY-2026-00002` (RECEIPT,
  Cash — a new "Cash"-kind `PaymentType` created in-session, since none existed yet) for a **partial** amount
  against a different invoice → approved → confirmed Dr Cash / Cr AR and the invoice landing on
  `PARTIALLY_PAID`, not `PAID`; created `PAY-2026-00005` (`PAYMENT_OUT`, Bank Transfer) for the full balance
  of a real `POSTED` Purchase Invoice → approved → confirmed Dr AP / Cr Bank and the invoice flipping to
  `PAID`. Confirmed the `reverseJournal()` guard blocks reversal of all three auto-posting document types
  (`PAYMENT`/`SALES_INVOICE`/`PURCHASE_INVOICE`) with `409 INVALID_STATE_TRANSITION`. Exercised the real race
  the guard exists for: created two DRAFT payments both claiming the same remaining outstanding balance on
  one invoice, approved the first (succeeded, invoice fully paid), then approved the second — correctly
  rejected with `409 OVER_PAYMENT_NOT_ALLOWED`, invoice untouched by the failed attempt, failed payment
  cleanly cancelled afterward. Confirmed re-approving and re-cancelling an already-`POSTED` payment both
  correctly `409 INVALID_STATE_TRANSITION`. `npx tsc --noEmit`, `npm run lint`, and `npm test` (161/161, 14
  new in `payment.service.test.ts`) all clean throughout; zero unexpected server or console errors during
  the full walkthrough (only the deliberately-triggered 409/405s from the guard tests above).
- **Not built this slice**: Expenses (the last remaining Phase 7 item — see below, now done), a real Credit
  Note/payment-reversal workflow (the `reverseJournal()` guard above is the enforced absence, not a built
  correction path), unallocated/advance payments, multi-currency UI (payments are always
  `company.baseCurrencyCode`, same project-wide deferral).

## Phase 7E — Expenses (2026-08-24)

Sixth and final slice of Phase 7. An Expense records a direct, day-to-day cost (rent, utilities, salaries,
misc.) that doesn't flow through Purchase Order → Goods Receipt → Purchase Invoice — a petty-cash-voucher-
style document, not a vendor-terms bill. Reviewed via a Plan-agent critique before implementation. Two scope
questions were confirmed with the user beforehand: **Expense is always paid immediately at posting time**
(no unpaid/payable lifecycle, no later settlement via Payment — an unpaid vendor bill with terms already has
a home: Purchase Invoice + Payment), and **one Expense is a single flat row** (no child items table, no
"Expense Report" multi-line shape).

- **Schema**: `ExpenseStatus` (`DRAFT/POSTED/CANCELLED`, Payment's minimal 3-state shape, not Invoice's
  6-state narrative enum). `Expense` — `accountId` (FK `ChartOfAccount`), optional `supplierId` (pure
  reference, no gated logic), `description`, `amount`/`taxRateId`/`taxAmount`/`totalAmount` (same tax-line
  shape as Purchase Invoice), `paymentTypeId`/`bankAccountId` (reused from Payment), `currencyCode` (always
  `company.baseCurrencyCode`, no exchangeRate split — matches Payment's own simplification), `journalId`
  (set at post time). `RelatedModule.EXPENSE`/`DocumentType.EXPENSE` (prefix `EXP`) were reserved since
  Phase 1/2 planning — this is their first real consumer. Hand-added CHECK constraints (`amount > 0`,
  `tax_amount >= 0`, `total_amount = amount + tax_amount`) match every prior Phase 7 migration.
- **`reverseJournal()`'s `sourceModule` guard (7D) now also blocks `EXPENSE`** alongside `PAYMENT`/
  `SALES_INVOICE`/`PURCHASE_INVOICE`. Expense has no cross-table accumulator like Payment's `paidAmount`
  that reversal would desync, but the critique argued (and the fix adopts) the simpler, consistent rule:
  "document-sourced journals aren't reversible; manual journals are" — carving Expense out as the one
  exception would just make every future reader re-derive why it's different. A wrongly-posted Expense
  therefore has zero correction path this slice (a manual adjusting journal entry is the only recourse) —
  stated explicitly in code comments rather than left as a stale "reverse the journal" promise (the mistake
  Purchase Invoice's own doc comment made before 7D's guard shipped).
- **`COGS` is explicitly excluded from the Expense account picker, not just filtered by `accountType`.**
  `COGS` is seeded with `accountType: "EXPENSE"` but is deliberately **not** `isSystemAccount: true` (only
  `AR`/`AP`/`GST-ITC`/`GST-PAY` are) — `postPurchaseInvoice` debits it via a hardcoded `findByCode` lookup,
  never exposing it as user-selectable. A validation that only checked `accountType === "EXPENSE"` would let
  a user post an ad hoc Expense straight into the same account Purchase Invoice postings drive automatically,
  polluting any COGS-based margin reporting with manual, PO-disconnected debits. Fixed with an explicit
  `code !== "COGS"` check in `assertValidExpenseAccount()`, verified live via a direct API call. Expense is
  also the first module in this codebase to expose a free `ChartOfAccount` picker to end users at all
  (Payment/Purchase Invoice only ever resolve control accounts by hardcoded `code`) — `isActive` is
  validated at both create and post time, and the picker itself filters to active, non-COGS `EXPENSE`-type
  accounts.
- **Journal line numbering is a dynamic incrementing counter** (Purchase Invoice's `let nextLineNumber = 2`
  pattern), **not** Payment's hardcoded `lineNumber: 1`/`lineNumber: 2` literals — Expense's journal is a
  variable 2-or-3-line shape (Dr account, optional Dr GST-ITC, Cr cash/bank), and copying Payment's fixed
  literals would have made a tax-bearing expense's Cr cash/bank line collide with the GST-ITC line at
  `lineNumber: 2`. `JournalLine` has no DB unique constraint on `(journalId, lineNumber)`, so this would have
  been a silent, undetected data-quality bug rather than a thrown error — a dedicated regression test in
  `expense.service.test.ts` asserts no two lines in a tax-bearing expense's journal share a `lineNumber`.
- **Error code for the non-DRAFT guard is `INVALID_STATE_TRANSITION`**, not `POSTED_INVOICE_LOCKED` —
  Expense's lifecycle is anchored to Payment (not Invoice), so it reuses Payment's own vocabulary for
  exactly this guard; no new `BusinessRuleError` code was needed anywhere in this slice.
- **RBAC**: new `expenses` module. `ACCOUNTS_MANAGER`: `view/create/edit/approve/cancel/export/print`
  (exact `invoices` shape with `approve` swapped in for `post`, since posting is gated on `"approve"` to
  match Payment's verb, not Invoice's). `ACCOUNTS_EXECUTIVE`: `view/create/edit` (exact match to `invoices`).
  `MANAGEMENT`: `view/approve` (exact match to `payments` — Management's approval power in this codebase is
  specifically scoped to the `"approve"` verb, which Invoice posting doesn't use, so mirroring `payments`
  here rather than `invoices` is the correct asymmetry). Since `prisma db seed` isn't safe to re-run against
  the dev DB (documented gotcha), the new `expenses` permission rows and `role_permissions` links were
  inserted via a narrow one-off script re-running only the seed's idempotent permission-catalog logic
  (`createMany`+`skipDuplicates` and `upsert`, both purely additive) — not a full reseed.
- **Edit-while-DRAFT is supported** (unlike Payment's deliberate "no edit, cancel-and-recreate only") —
  Expense is single-row, the same shape Purchase/Sales Invoice already support update-while-DRAFT for (a
  *harder* problem, replacing a whole item collection), so this is the well-precedented choice, not an ad
  hoc one. A `/accounts/expenses/[id]/edit` page reuses `ExpenseForm` in dual-mode (mirrors Sales Order's
  own `initialOrder` pattern), guarded `notFound()` for non-DRAFT expenses matching the service's own guard.
- Reuses the existing `AttachmentService` for receipt/bill photo uploads against `RelatedModule.EXPENSE`
  (already reserved, zero schema change) — the same 3-route shape and `FilePreviewModal` UI already proven
  by Sampling's and Sales Order's attachments.
- **Verified live end-to-end** through the real UI and direct API calls together: created `EXP-2026-00001`
  (Utilities, GST 18%, Bank Transfer, ₹1,000 → ₹1,180 total) through the real form — confirmed the Expense
  Account dropdown correctly excluded `COGS` and any inactive account; edited it while DRAFT (amount
  1000→1200, confirmed the live preview and the persisted total both recalculated to ₹1,416.00); approved →
  `JRN-2026-00013` with the exact 3 correctly-numbered lines (Dr EXP-UTIL 1200 / Dr GST-ITC 216 / Cr BANK
  1416, `lineNumber` 1/2/3, no collision); created and posted `EXP-2026-00002` (Factory Rent, no tax, Cash)
  → confirmed a clean 2-line journal (Dr EXP-RENT / Cr CASH); confirmed a direct API attempt to post an
  Expense against `COGS` correctly rejected (`400 VALIDATION_ERROR`); deactivated `EXP-SALARY` and confirmed
  an Expense against it was rejected, then reactivated it; confirmed re-approve/re-cancel/edit on the POSTED
  `EXP-2026-00002` all correctly `409 INVALID_STATE_TRANSITION`, and its `/edit` page correctly `404`s;
  confirmed reversing `EXP-2026-00001`'s auto-posted Journal is blocked with `409 INVALID_STATE_TRANSITION`;
  uploaded a receipt attachment, confirmed byte-for-byte download, then deleted it. `npx tsc --noEmit`, `npm
  run lint`, and `npm test` (172/172, 11 new in `expense.service.test.ts`) all clean throughout; zero
  unexpected server or console errors during the full walkthrough (only the deliberately-triggered
  400/404/409s from the guard tests above). One unrelated environment gotcha hit and fixed: after this
  session's heavy schema/migration work, the dev server's route manifest briefly 404'd on every page
  (including pre-existing ones like `/accounts/payments`) until a full stop + `.next/dev/types` cache clear
  + restart — same class of stale-`.next`-cache issue already documented for `tsc` in the Stock Movements
  section, just manifesting as page 404s instead of a `tsc` syntax error this time.

**Phase 7 (Accounts) is now fully done** — Chart of Accounts, Tax Config, the Journal engine, Sales
Invoices, Purchase Invoices, Payments + Allocations, and Expenses are all built, tested, and verified live.

## Phase 8 — Dispatch (2026-08-24)

First slice of Phase 8, on a new `phase-8-dispatch` branch (created off `main` after Phase 7 was merged).
Dispatch is the shipping workflow that fulfills a confirmed Sales Order — picking, packing into cartons,
confirming the shipment (which decrements Finished-Goods stock), and recording delivery. Explored via 2
parallel Explore agents and reviewed via a Plan-agent critique before implementation. Two scope questions
were confirmed with the user beforehand:

1. **Product-level stock check only.** The FG stock ledger (`InventoryTransaction`/`StockBalance`) has no
   `productVariantId` dimension at all — confirmed neither it nor Production's `Lot`/`JobOrder` track
   color/size, only flat per-style quantity. Making the ledger variant-aware would have cascaded into
   already-shipped, verified Phase 5C Production code, far beyond Dispatch's own scope. Dispatch validates
   and decrements stock at the style level; `CartonItem.productVariantId` records real color/size detail for
   packing-list purposes, but it's informational only, never enforced against per-variant stock.
2. **Consolidated documents, no separate Picking List / Packing List tables.** One `Dispatch` record owns
   its own `DispatchItem`s (what to ship) and `Carton`/`CartonItem`s (how it's packed) — picking/packing are
   status states on the same document, matching this project's Material-Request/Stock-Movement
   consolidation precedent.

- **A real, ordinary-usage-reachable bug the Plan-agent critique caught by reading `updateSalesOrder()`/
  `replaceItems()` closely**: `replaceItems()` unconditionally deletes and recreates *every*
  `SalesOrderItem`/breakdown row on any edit to a `CONFIRMED` order, and `updateSalesOrder()`'s only existing
  guard checked for an *active* Sales Invoice — nothing stopped a plain edit from trying to delete a
  `SalesOrderItem` row a Dispatch's `DispatchItem.salesOrderItemId` FK already pointed at, a raw DB
  constraint violation reachable through completely normal usage. **Fixed**: `updateSalesOrder()` gained a
  new guard — throws `REFERENCED_RECORD_IN_USE` if **any** Dispatch (any status, including `CANCELLED` — a
  cancelled Dispatch's `DispatchItem` rows still sit on the FK) references the order, via a new
  `DispatchRepository.findAnyByOrderId()`. (The same critique flagged that the existing Sales Invoice guard
  has this same "active-only" weakness already latent in shipped Phase 7 code — noted here as a known
  pre-existing gap, deliberately not copied into Dispatch's own guard, and not fixed in this pass since it's
  outside Dispatch's scope.) This also made `SalesOrderItem.dispatchedQuantity`'s guarded increment
  (`guardedIncrementDispatched`-shaped, same idiom as `PurchaseOrderItem.receivedQuantity`) safe with the
  plain Prisma `updateMany` idiom rather than needing 7C's raw-SQL technique — the cap
  (`sum(breakdown.orderedQuantity)`) is now genuinely frozen for the lifetime of any Dispatch referencing
  the order.
- **A genuine cross-module status collision that would have broken shipped Phase 7 code on day one**: Sales
  Invoice's `ELIGIBLE_ORDER_STATUSES` had no awareness of `PARTIALLY_DISPATCHED`/`DISPATCHED` — the moment an
  order was ever partially dispatched, `createSalesInvoice()` would have permanently rejected it. **Fixed**
  by widening `ELIGIBLE_ORDER_STATUSES` in `sales-invoice.service.ts` to include both. Dispatch's own
  eligibility set is `["CONFIRMED", "PARTIALLY_DISPATCHED", "INVOICED"]` — deliberately allowing shipment
  either before or after invoicing, not assuming one fixed order (`DISPATCHED` itself is excluded from
  Dispatch eligibility — nothing left to ship).
- **Stock-sufficiency check**: `recordInventoryTransaction`'s underlying `StockBalanceRepository
  .upsertIncrement` has no floor guard at all — it will drive `quantityOnHand` negative with no complaint.
  `confirmDispatch()` pre-checks `getAvailableQuantity()` per `DispatchItem`, throwing the
  reserved-since-Phase-1 `INSUFFICIENT_FG_STOCK` if requested exceeds available — the same "pre-check is
  enough, a hot-path race guard isn't warranted for a manual, low-frequency action" tradeoff already
  accepted project-wide for Stock Movement's own negative-quantity paths.
- **The CANCELLED-reachability design deliberately avoids relying on the transition map alone** — the exact
  bug class this project has now hit twice (Sampling's Hold/Resume bug, Purchasing's cancel-from-`ON_HOLD`
  bug). `ON_HOLD` is reachable only from `DRAFT`/`PACKED` in the transition map (post-dispatch "hold" isn't
  a real floor action once goods have left), **and** `cancelDispatch()` independently, unconditionally
  rejects cancellation whenever `dispatchedAt` is already set — a hard fact stamped only inside the
  Confirm-Dispatch transaction, checked directly rather than reasoning about status labels. Two independent
  layers, neither relying on the other; a dedicated regression test exercises the hypothetical
  `ON_HOLD`-with-`dispatchedAt`-set case directly to prove the guard doesn't depend on that combination
  being unreachable today.
- **RBAC**: `DISPATCH_MANAGER` gained `"post"` (Confirm Dispatch, self-approval-guarded via
  `{createdBy: requestedByUserId}` — `"post"` is already in `SELF_APPROVAL_GUARDED_ACTIONS`, matching
  Invoice/Journal's precedent rather than Payment's `"approve"` verb, since this is posting a ledger-
  affecting confirmation, not approving someone else's request). `WAREHOUSE_USER` gained `"edit"` (the
  workflow needs the same actor to add `DispatchItem`s and pack `Carton`/`CartonItem`s after creation, no
  bespoke "pack" verb was warranted). `cancelDispatch()` is gated on the module's own pre-existing `"cancel"`
  action (not `"edit"`), matching Payment/Invoice's dedicated-cancel-route precedent — Hold/Resume/Pack/
  Deliver got their own dedicated body-less POST endpoints for this reason too, rather than a single generic
  edit-gated status route like Sales Order's own (which predates Dispatch's `"cancel"` grant existing as a
  meaningfully different permission). New `expenses`-batch-style permission rows/role_permissions links were
  inserted via the same narrow one-off script used for Expenses' RBAC rows (`prisma db seed` remains unsafe
  to re-run against the dev DB).
- **Make-to-stock dispatch (no Sales Order) is an explicit v1 scope cut**: `ProductionOrder.salesOrderItemId`
  is nullable specifically to support Make-to-Stock production, but `Dispatch.salesOrderId` is required —
  make-to-stock FG shipped with no formal order has no Dispatch path this slice (a plain `StockMovement`
  `STOCK_TRANSFER` is the workaround if ever actually needed).
- **A genuine hydration bug found and fixed during live verification, not present anywhere else in this
  codebase**: `DispatchWorkflowPanel`'s "Dispatched At"/"Delivered At" fields render `toLocaleString()`
  directly on a `Date` derived from a server-passed prop — unlike every other workflow panel's own
  `toLocaleString()` usage (all confirmed to live only inside `useEffect`-populated attachment lists that
  start empty), this ran once during SSR in the server's locale and again during client hydration in the
  browser's locale, a real text mismatch React couldn't reconcile. Fixed with a small `<ClientDateTime>`
  wrapper using `suppressHydrationWarning` (React's own documented escape hatch for content that legitimately
  differs between server and client) rather than a manual mounted-state effect (which trips this project's
  `react-hooks/set-state-in-effect` lint rule for no benefit here).
- **Verified live end-to-end** through the real UI and direct API calls together: created `DSP-2026-00001`
  against a real `INVOICED` order (`ORD-2026-00001`, 220 pcs, confirming the widened eligibility works) for a
  partial 100 pcs → packed 2 cartons (one plain, one with a real color/size variant) via the real carton
  packer UI → confirmed `SalesOrderItem.dispatchedQuantity` incremented to 100, `StockBalance` decremented
  365→265, `SalesOrder.status` became `PARTIALLY_DISPATCHED`, `dispatchedAt` stamped; confirmed
  `updateSalesOrder()` now correctly `409 REFERENCED_RECORD_IN_USE`s on that order, including via a separate
  test dispatch that was cancelled first (proving the "any status" guard, not just active); confirmed a
  Sales Invoice could still be created against a `PARTIALLY_DISPATCHED` order (the exact regression the
  critique caught); dispatched the remaining 120 pcs and confirmed `SalesOrder.status` became `DISPATCHED`;
  marked the second dispatch Delivered through the real UI (with a Received-By name) and confirmed
  `SalesOrder.status` stayed `DISPATCHED` (delivery is Dispatch-level only); confirmed a deliberately
  zero-stock warehouse correctly `409 INSUFFICIENT_FG_STOCK`s at Confirm time with the exact available/
  requested numbers; confirmed a Hold→Resume round trip restores the exact prior status; uploaded a POD
  attachment and confirmed byte-for-byte download and delete. `npx tsc --noEmit`, `npm run lint`, and `npm
  test` (194/194, 20 new in `dispatch.service.test.ts` + 2 regression tests added to
  `sales-invoice.service.test.ts`) all clean throughout.
- **Not built this slice**: make-to-stock dispatch (see above), an "un-dispatch"/reversal correction path
  once `DISPATCHED` (matching this project's now-repeated "no reversal, correction requires a manual
  compensating entry later" stance for Payment/Sales/Purchase Invoice/Expense), rack-level location tracking
  specifically for packed cartons (`WarehouseType.DISPATCH` already exists as an enum value — confirmed via
  the "Dispatch Yard" seed row — but nothing yet validates a Dispatch's own `warehouseId` against it), and
  printable delivery-challan/packing-slip documents.

## Full-system QA/UAT pass across every completed module, P0/P1 fixes (2026-08-24/25)

On branch `test_all_complete_module`. Six parallel `erp-qa-uat` agent passes drove the real app end-to-end
against the live dev DB, covering every completed module group (Foundation/RBAC/Masters, Buyer Enquiry→
Sampling→Sales Orders→BOM/MRP, Production+the newly-merged Job Work module, Inventory/Purchasing, Accounts+
Dispatch, CRM/Marketing/HRMS) — ~320+ test cases, full findings preserved in `QA_UAT_REPORT_2026-08-24.md`.
One environment gap was fixed mid-pass: the dev DB was missing `Permission` catalog rows for `marketing`/
`hrms_attendance`/`hrms_leave` entirely (403 for every user including Super Admin) — backfilled via the same
idempotent one-off-script pattern already used for Expenses/Dispatch's RBAC rows, dev server restarted to
clear `PermissionService`'s in-process cache, confirmed live.

Two confirmed P0 stock-corruption bugs and four P1s were found and fixed:

- **P0 — re-forwarding or re-QC-inspecting a Job Order already completed at a final stage** double-posted
  Finished-Goods stock and silently un-completed its Lot. Root cause: `completeAtFinalStageInTx()` sets the
  newly-created final-stage JobOrder's raw `status` column to `"COMPLETED"` but never bumps its
  `forwardedQuantity`/`qcPassedQuantity` — so `forwardJobOrder()`/`recordQcInspection()`'s only guards
  (`notYetForwarded`/`notYetInspected`) stayed wide open on a job order that had already flushed to stock.
  Fixed with an explicit `if (jobOrder.status === "COMPLETED") throw INVALID_STATE_TRANSITION` guard at the
  top of both functions — safe specifically because that raw status value is *only* ever written by
  `completeAtFinalStageInTx`, confirmed by grep; an ordinary job order whose `completedQuantity` reaches
  `plannedQuantity` through normal progress entries keeps its prior stored status (PENDING/IN_PROGRESS) and
  is computed as "COMPLETED" only for *display* purposes via the separate `computeJobOrderStatus()` helper —
  so the new guard doesn't touch the normal, legitimate "QC a fully-completed-but-not-yet-forwarded job
  order" path at all. Two regression tests added to `job-order.service.test.ts`.
- **P0 — Job Work Order raw-material issuance had no stock-sufficiency check** (found independently by this
  pass; fixed upstream by another contributor's same-day `e4992f9` "full ERP readiness audit" commit, merged
  into this branch before this pass's own fix work began — `recordInventoryTransaction()` now floors every
  stock decrement with an atomic guarded `updateMany`, and Job Work issuance gained the same
  `getAvailableQuantity()` pre-check every sibling module already had).
- **P1 — cancelling a Job Work Order never reversed its issued raw material**, permanently understating
  warehouse stock. Fixed with a new `reverseIssuedMaterialsInTx()` in `job-work-order.service.ts`, called
  only when cancelling (zero receipts exist, per the pre-existing guard) — recomputes each line's base-UOM
  quantity the same way `createJobWorkOrder()` did at issuance (never stored on `JobWorkOrderMaterial`
  itself), posts a new dedicated `JOB_WORK_ISSUE_REVERSAL` ledger type (mirroring `GOODS_RECEIPT_REVERSAL`'s
  precedent — a dedicated reversal type, not the original type with a flipped sign) inside the same
  transaction as the status flip, and restores a fabric roll's `remainingQuantity` via a new
  `FabricRollRepository.incrementRemaining()`. Migration `add_job_work_issue_reversal_type`.
- **P1 — the "Adjustment Entry" correction feature crashed with a raw 500 on every call**:
  `recordAdjustmentEntry()` passed `actor.userId` (a `User` id) straight through as
  `JobOrderProgressEntry.employeeId` (a required FK to `Employee`), failing the FK constraint unless a User
  happened to share a UUID with an Employee row. Fixed by resolving the acting user's own linked Employee via
  `User.employeeId` and making `JobOrderProgressEntry.employeeId` nullable specifically for
  `isAdjustment=true` rows (every non-adjustment row still always carries a real Employee) — an adjustment
  now records `employeeId: null` rather than crashing when the actor (e.g. Super Admin) has no linked
  Employee. Migration `make_job_order_progress_entry_employee_nullable`.
- **P1 — Leave Request approval had no self-approval guard**: the approve route's own
  `PermissionService.assert` call had no `resourceContext`, so the self-approval branch was unreachable —
  unlike every other approve checkpoint in the app (Campaign's `approveCampaign()` confirmed as the working
  positive-control pattern). Fixed by re-asserting inside `approveLeaveRequest()` itself with
  `{ createdBy: existing.createdByUserId }`, matching the Payment/Expense "route does a coarse check, the
  service re-asserts with the real resourceContext" double-gate shape already established in this codebase.
- **P1 — Lead/Deal/Campaign/Marketing-Dashboard/Sampling detail & edit pages had zero server-side permission
  check**: these are Server Components that called the service layer directly with only `companyId`
  scoping — no `PermissionService.assert` anywhere in the chain — even though the equivalent API routes
  correctly gate on `view`. Confirmed live: the Marketing Dashboard rendered full financials for a session
  that gets `403` on the equivalent API call. This is a codebase-wide architectural gap (the same pattern
  was already present in Sampling's own detail page, predating this pass), not specific to CRM/Marketing.
  Fixed by adding `await PermissionService.assert(session!.user.id, "<module>", "view").catch(() =>
  notFound())` to the top of all 8 affected pages (`leads/[id]`, `leads/[id]/edit`, `deals/[id]`,
  `deals/[id]/edit`, `campaigns/[id]`, `campaigns/[id]/edit`, `marketing` dashboard, `sampling/[id]`) —
  denying as a plain 404 rather than a distinct "forbidden" page deliberately doesn't reveal whether the
  record exists to a caller without view rights, reusing the exact `notFound()` mechanism these same pages
  already use for "record doesn't exist." Verified live (Super Admin happy path unaffected on Marketing
  Dashboard and a real Lead detail page, zero new console errors on a fresh-tab reload); the denial path
  itself relies on `PermissionService`'s already-separately-unit-tested `assert()` behavior, since this
  session's sandboxed browser couldn't cleanly complete a second-user sign-out/sign-in round trip to drive it
  end-to-end (see the Administration fix below, which *did* get a full live create-then-verify pass).
- **P1 — no UI or API existed anywhere to create additional Users or assign Roles**, found independently by
  two of the six QA passes (Foundation/Masters and CRM/Marketing/HRMS) — `/admin` 404'd despite the
  `administration` RBAC module being fully seeded, and the DB had exactly one user (the seeded Super Admin)
  ever. This structurally blocked exercising the app's own well-built 13-role RBAC matrix by anyone but one
  person. Fixed with a new minimal `src/modules/administration/` module (`user-admin.schema/repository/
  service.ts` — `createUser` hashes the password via the existing `hashPassword()` helper from
  `src/core/auth/password.ts`, checks email uniqueness with a clean `DUPLICATE_EMAIL_EXISTS` error [new
  `BusinessRuleError` code] before creating the `User` + its one initial `UserBranchRole` assignment in a
  single transaction; `setUserStatus` toggles `ACTIVE`/`SUSPENDED`, blocked against suspending your own
  account), two new minimal read-only lookups (`GET /api/v1/branches`, `GET /api/v1/roles`, same
  no-dedicated-module pattern as `/api/v1/currencies`), and a UI at `/admin` (finally resolving the
  previously-dead sidebar link) — a Server Component page + `AdminUsersPanel` client component reusing the
  existing `Modal`/`ConfirmModal`/`ToggleSwitch`/`FormField` components, matching this project's established
  small-CRUD-in-a-Modal convention. **Verified live end-to-end through the real UI, not just API calls**:
  created a real second user ("QA Test Manager", STORE_MANAGER role, Head Office branch) through the actual
  New User modal — confirmed it appeared correctly in the list with the right role/branch. (The first request
  against this brand-new route took ~53s due to one-time Turbopack dev-compile, not a hang — worth
  remembering as the likely explanation for the separate not-fully-confirmed Purchase Order route slowness
  noted below, rather than assuming every slow first-hit is a real bug.)
- **Not confirmed as a real defect at the time — since root-caused, see the P2-P4 pass below**: one QA pass
  reported `GET /api/v1/purchase-orders/[id]` hanging indefinitely under this session's own heavy load (6
  concurrent QA agents). Initially guessed as a Turbopack dev-compile stall; the P2-P4 fix pass below hit the
  exact same symptom again on a brand-new route and got a definitive root cause — see that section.
- **Remaining open items from the QA report, not addressed in this pass** (all P2 or lower, see
  `QA_UAT_REPORT_2026-08-24.md` for full detail — all fixed in the P2-P4 pass immediately below): malformed-
  `:id` routes returning a raw 500 instead of a clean 400/404; duplicate-code creation races producing an
  occasional raw 500 instead of a clean 409; QC's exact-float-equality quantity validation; Production
  Orders having no cap against their linked Sales Order item's real ordered quantity; Journal's already-
  reversed-journal reversal attempt raising a raw 500 instead of a clean 409; and a long tail of P3/P4
  cosmetic/UX items.
- `npx tsc --noEmit`, `npm run lint`, and `npm test` (412/412, 8 new) all clean throughout every fix in this
  pass.

## P2-P4 fix pass — every remaining QA/UAT finding addressed (2026-08-25)

Continuation of the QA/UAT report (`QA_UAT_REPORT_2026-08-24.md`) — every P2, and every practically-fixable
P3/P4 finding, addressed in one pass. Two items were deliberately left open (see end of this section).

**P2 (all fixed):**
- **Malformed `:id` routes / duplicate-code races → raw 500s, fixed at the shared choke point.** Both were
  systemic (2+ modules, 10+ service files respectively) but shared one root cause: `toErrorResponse()`
  (`src/core/errors/BusinessRuleError.ts`) had no handler for two specific Prisma error codes it can see from
  *any* module — `P2007` ("Data validation error" — a non-UUID string reaching a `@db.Uuid` column,
  confirmed via a live probe script against a real malformed-id query) and `P2002` (unique constraint —
  reachable from any `findFirst`-then-`create` duplicate check under a genuine concurrent-request race, the
  DB constraint the actual protection, this only gives the failure a clean shape). Both now map to a clean
  400/409 respectively, fixed once for every module rather than patched per call site.
- **QC quantity validation used exact float equality** (`0.1 + 0.2 !== 0.3` under IEEE-754) — switched to the
  same epsilon-tolerance convention every other quantity-cap check in `job-order.service.ts` already uses.
  Bundled in the same schema edit: the QC schema's `reworkTargetStageId`-required rule was stricter than what
  `recordQcInspection()` actually reads (only when `rejectedQuantity > 0`) — a pure-damage FAIL was
  unrecordable at a job order's very first stage (no earlier stage to name) purely because of this
  schema/service mismatch. Both fixed in `production.schema.ts`'s `createQcInspectionSchema`.
- **Production Orders had no cap against their linked Sales Order item's real ordered quantity** — a 500-unit
  Production Order could be planned against a 5-unit order line with zero pushback, and multiple Production
  Orders could silently attach to the same line. `createProductionOrder()` now sums the line's real
  `orderedQuantity` from its breakdown, subtracts what other non-cancelled Production Orders already
  committed to that same line, and rejects planning more than what's left (`OVER_PRODUCTION_NOT_ALLOWED`,
  reused). Make-to-Stock orders (no `salesOrderItemId`) are correctly unaffected.
- **Journal double-reversal raised a raw 500** — `reverseJournal()` relied solely on the DB's `@unique`
  constraint on `reversalOfJournalId` to prevent a second reversal (correct for data integrity, confirmed no
  double-reversal ever occurred), but the resulting `P2002` had no explicit pre-check, so the *common*
  (non-racing) case surfaced the raw Prisma error instead of a clean one. Added an explicit
  `if (original.reversedByJournal) throw INVALID_STATE_TRANSITION` check naming the existing reversal; the DB
  constraint remains the real backstop for a genuine concurrent-reversal race.

**P3 (all practically-fixable items done):**
- `OVER_RECEIPT_NOT_ALLOWED`'s message now states ordered/already-received/remaining, matching the
  `Available: X, Requested: Y` template already used elsewhere in Inventory.
- Journal detail page's Total row now sums the visible lines client-side instead of showing
  `journal.totalDebit`/`totalCredit` (only ever computed at POST time) — a DRAFT journal no longer shows a
  self-contradictory "Total 0.00 / 0.00" under correctly-populated line rows.
- Job Work's `pendingQuantity` metric now reports `0` for a `CANCELLED` order regardless of raw
  issued/received figures — consistent with cancellation now reversing issued material back to stock (see
  the P0/P1 pass above).
- `forwardJobOrder()` now re-fetches and returns the freshly-completed job order when the target stage is
  final, instead of the pre-mutation object `postStageTransactionInTx()` originally created (status
  `PENDING`, `completedQuantity` 0) before `completeAtFinalStageInTx()` mutated that same row later in the
  same transaction.
- `updateLead()` no longer silently unassigns a lead when `assignedToUserId` is omitted from a partial-intent
  API update (only an explicit empty string still unassigns) — the real UI form was never affected (it always
  resubmits the field), this was purely a direct-API-consumer robustness gap.
- Three client pages (`marketing/ad-integrations`, `attendance`, `marketing/channel-performance`) now check
  `res.ok` before consuming a fetch response, with a visible error state instead of an infinite spinner or an
  uncaught `TypeError` on a denied/failed request.
- **`UnitOfMeasure` gained a real `isActive` column and deactivate capability** (migration
  `add_unit_of_measure_is_active`) — previously had no way to hide a unit at all once created. While fixing
  this, found and fixed the *same* latent bug for Color/Size too: their `isActive` Zod field had a
  `.default(true)`, so the ordinary "Edit" form (which never sends this field — only the dedicated
  Active/Inactive toggle does) silently reactivated an already-deactivated record on every routine edit.
  Fixed uniformly across all three (`isActive` now `.optional()` with no default; `create` defaults to
  `true` when omitted, `update` preserves the existing value when omitted, applies an explicit value when
  supplied) — verified live end-to-end (deactivate → reactivate round trip via the real UI).
- **Bulk variant generation accepted a deactivated Color/Size with no check at all** — `generateVariants()`
  now rejects outright (naming which masters are inactive) rather than silently generating fewer variants
  than requested, matching the "inactive masters can't be used in a new transaction" pattern already
  established elsewhere (e.g. Expense's COGS exclusion).
- **Buyer records had no update or deactivate path at all** (create-only since Phase 3) despite
  `Buyer.isActive` existing on the model since day one. Added `updateBuyer()` (same
  optional-isActive-preserved-on-omit pattern as above), a new `PATCH /api/v1/customers/[id]/buyers/[buyerId]`
  route, and rebuilt `BuyersSection.tsx` with a real Edit modal + Active/Inactive toggle, reusing the existing
  `Modal`/`ConfirmModal`/`ToggleSwitch` components. Verified live end-to-end through the real UI.
- Added the same `job_orders_quantity_consistency_check` CHECK-constraint precedent for `job_work_orders`
  (migration `add_job_work_orders_quantity_check`) — the app-layer guarded accumulators were already correct;
  this was a hard backstop it was missing relative to its sibling table.
- **`SampleVersion.status` finally tracks the header's real workflow stage** — previously frozen at
  `IN_DEVELOPMENT` from creation through Internal QC and Submitted-to-Customer (`SampleVersionStatus` already
  *had* `INTERNAL_QC`/`SUBMITTED` values, `transitionSampleStatus()` just never set them). Now mirrors the
  header's status onto the current, still-live version for exactly these three in-flight stages; never
  touches a terminal version status (`APPROVED`/`REJECTED`/`SUPERSEDED`), which stays reachable only through
  `addSampleVersion()`/`recordSampleApproval()` as before.

**P4 (all done):**
- MRP's `contributingStyles` now merges into one entry when a single style reaches a material through two
  different color-scoped BOM lines, instead of listing it twice with a partial quantity each.
- MRP's `neededQuantity`/`availableQuantity`/`shortfallQuantity` (and each contributing style's own quantity)
  are now rounded to 4 decimal places, eliminating IEEE-754 noise like `103.60000000000002` from the JSON
  response (matches this project's `Decimal(18,4)` quantity-column precision everywhere else).
- Lead CSV import now aggregates every validation issue in a row into one combined message, matching Deal
  import's own (already-correct) behavior — the gap was a manual pre-check for an invalid `source` value that
  threw immediately, short-circuiting before `createLeadSchema.parse()` (whose own `z.enum(LEAD_SOURCES)`
  already validates the same thing) got a chance to collect every issue in the row together. Removed the
  redundant pre-check entirely.
- `GET /api/v1/departments?pageSize=N` no longer reports a `meta.pageSize` that contradicts what was actually
  returned — the route deliberately floors `take` to 200 (departments are few; dropdowns want the full list)
  but was never updating `pageSize` to match, so `meta` lied about it. One-line fix.

**Root-caused the P1-6 "PO route hang" from the previous pass, while fixing this one's Buyer feature**: the
exact same symptom recurred on a brand-new route (`PATCH .../buyers/[buyerId]`) — `preview_logs` showed
`TypeError: updateBuyer is not a function` despite the export genuinely existing and `tsc` passing clean, with
the request taking 65s-2.3min before failing. This is a **stale Turbopack module cache** in the long-running
dev server process, not a request-volume/compile-latency issue as originally guessed — a full dev-server
restart (not just `prisma generate`) resolved it immediately, and the same request succeeded normally
afterward. Worth internalizing as a new variant of this project's existing "stale artifact" gotcha family
(alongside the stale-Prisma-client-in-a-running-dev-server and stale-`.next/dev/types` ones): **after adding
a new export to a file a route already imports from, or a brand-new route file, if the very first request
against it fails with an "X is not a function"-shaped error or hangs far longer than a normal compile,
restart the dev server before assuming it's a real bug** — this cost real debugging time in this session
before the pattern was recognized.

**Also hit and fixed in passing**: `npx tsc --noEmit` transiently failed with `TS1128`/`TS1005` syntax errors
inside `.next/dev/types/routes.d.ts` after clearing that directory mid-session (the same class of gotcha
already documented for `.next/dev/types/validator.ts` in the Stock Movements section) — resolved by hitting
any page once to force regeneration, then a full dev-server restart once `LayoutProps` still didn't resolve
from a single page hit alone.

**Deliberately left open, not addressed in this pass** (both broad, cross-cutting audits rather than
single-file fixes — flagging for a dedicated future pass rather than attempting a rushed partial fix):
- `DELETE` on Customer/Supplier/Employee performs an unconditional soft-delete with no check for
  transactional references and no restore path. Real-world risk is low (only `SUPER_ADMIN` holds
  `masters_core.delete`, and no UI button anywhere calls this endpoint), but a proper fix means auditing
  reference-checking conventions across every "rich" master, not a one-line change.
- Internal worker Assignment and the external Job-Work-Issue pool are uncoordinated — the same unprocessed
  Job Order quantity can be double-committed to both a worker and an external contractor simultaneously.
  Fixing this properly means `assignWorker()` and `createJobWorkOrder()` cross-checking each other's
  commitments, a real design change to both functions rather than a guard tweak to one.

412 tests → **450 tests** (38 new), `npx tsc --noEmit`, `npm run lint`, and `npm test` all clean throughout
every fix in this pass.

## Full ERP readiness audit + P0 inventory/UOM/validation fixes (2026-08-25)

A full evidence-based audit (`FASHION_ERP_COMPLETE_READINESS_AUDIT.md`) covering multi-tenancy, product/
manufacturing, procurement/inventory, sales/dispatch/accounting, HRMS/reporting, API/database architecture,
and frontend/testing/production-readiness — classified **C (Feature Complete but Business Gaps Remain)**,
with a scored breakdown per area and a P0–P3 gap matrix. Read that file for the full findings; this entry
covers only the P0 fixes made off the back of it (on `main`, before the `Hardening` branch existed):
- `recordInventoryTransaction()` (`src/modules/inventory/inventory.service.ts`) now floors every stock
  decrement with an atomic guarded `updateMany` at the one shared ledger choke point, instead of the plain
  `upsert` every caller previously relied on — closes negative-stock races in Material Request issue, Stock
  Movement, Dispatch confirm, Goods Receipt reversal, and Job Work issue all at once, rather than patching
  each call site separately.
- Job Work Order raw-material issuance had **no** stock-availability check at all for non-fabric-roll
  materials (not a race — a single ordinary request could drive stock negative) — added a real pre-check
  plus the atomic backstop above.
- Stock Movement and Job Work Order both skipped UOM conversion before posting to the ledger, unlike every
  other ledger-writing module — both now convert to the material's base UOM first, matching Purchase
  Order/Goods Receipt/Material Request's existing convention.
- Sales Order line items were never validated as actual Styles (`itemType`) — the one exception to a guard
  every sibling module (BOM/PO/Material Request) already enforces via `findMaterialById`/`findStyleById`.
  Closed on both `createSalesOrder` and `updateSalesOrder`.
- 96 new tests added for the previously zero-coverage modules most tied to the above:
  `inventory.service.ts` (the ledger engine itself), `sales-order.service.ts`, `purchase-order.service.ts`,
  `goods-receipt.service.ts`, `bom.service.ts`, `mrp.service.ts`.

## Phase 11 — Hardening, first pass (2026-08-25, branch `Hardening`)

Started directly off the audit's own Phase D roadmap, prioritizing items that needed no new external
dependency or infrastructure decision (2FA, OpenAPI generation, a CD pipeline, cloud file storage, and a
Redis-backed rate limiter/permission cache all still need that kind of decision and are **not** done —
see the audit's own Phase D section for what's still open).
- **Found and fixed a live cross-tenant gap, not a hypothetical one**: the audit had flagged
  `UserBranchRole` having no cross-company consistency check as "harmless — no role-assignment API exists
  yet." That API now exists (`src/modules/administration/`, pulled in from a separate contributor's same-day
  commit) — and `createUser()` took `branchId`/`roleId` straight from client input with no check either
  belonged to the actor's own company. The picker endpoints (`/api/v1/branches`, `/api/v1/roles`) already
  scope by `companyId`, but that only constrains the UI, not a direct API call. Fixed with the same
  chokepoint-validation pattern used everywhere else in this codebase (`UserAdminScopeRepository.
  findBranchCompanyId`/`findRoleCompanyId`, checked before `createUser()` writes anything) — verified both
  via 8 new unit tests and live against the real dev DB (`POST /api/v1/administration/users` with a
  nonexistent `branchId` correctly `404`s instead of silently succeeding).
- **Security headers hardened**: added `Strict-Transport-Security` (2-year max-age, `includeSubDomains`)
  and a real `Content-Security-Policy` to `next.config.ts`, alongside the existing `X-Frame-Options`/
  `X-Content-Type-Options`/`Referrer-Policy`/`Permissions-Policy`. The CSP's `script-src` deliberately
  includes `'unsafe-inline'` — a stated, explained tradeoff, not an oversight: the App Router injects its
  own inline `<script>` tags for streaming RSC hydration (`self.__next_f.push(...)`) on every page, and a
  strict nonce-based policy (the textbook-correct fix) would require wrapping the NextAuth `proxy.ts`
  middleware's `auth()` call, which drives every page's login-redirect behavior — not a risk worth taking in
  this pass. Still real protection: blocks any externally-sourced or injected `<script src>`, all
  object/embed plugins, all framing, and restricts navigation/form targets to same-origin. Verified live:
  loaded the dashboard and a masters list page with zero CSP-violation console errors, confirmed all three
  new headers are actually present via a direct `fetch()` header check.
- **Health-check endpoint added** (`GET /api/v1/health`) — deliberately unauthenticated (load
  balancers/orchestrators/uptime monitors can't carry a session cookie) and minimal-information (up/down +
  a DB ping only, no stack traces or config values). Previously didn't exist anywhere, flagged explicitly by
  the audit as a real deploy blocker for any container/orchestrator-based deployment. Verified live.
- **Structured logging added** (`src/core/logging/logger.ts`) — a minimal JSON-per-line logger
  (`level`/`timestamp`/`message`/`context`, with `Error` objects in context explicitly unwrapped since they
  don't survive a plain `JSON.stringify`), wired into the shared `toErrorResponse()` handler in place of the
  single bare `console.error("Unhandled error:", error)` call that was previously the *entire* backend
  observability story (confirmed by the audit — this was the only console call in all of `src/`). This does
  **not** pick an observability vendor (Sentry/Datadog/etc. — a real infra decision, deliberately left
  open) — it just gives every log line a consistent, greppable shape so a log aggregator can be pointed at
  stdout later with zero further code changes. Verified live: triggered a real unhandled error (malformed
  JSON body to a POST route) and confirmed the resulting log line in the dev server's own output was a
  correctly-shaped JSON object with the error's name/message/stack intact.
- Confirmed already fixed by the same upstream pull that added the Administration module:
  `approveLeaveRequest()`'s missing self-approval guard (the audit's other live RBAC-completeness finding) —
  no action needed, verified the fix is already in place with the exact reasoning the audit itself gave.
- 12 new tests (`user-admin.service.test.ts` ×8, `logger.test.ts` ×4). `npx tsc --noEmit`, `npm run lint`,
  and `npm test` all clean throughout (462/462 total).
- **Not done this pass, explicitly deferred** (each needs a decision only the user can make, or a new
  dependency): TOTP-based 2FA (schema column `User.mfaSecret` has existed unused since Phase 1/2 — needs a
  TOTP library choice and an enrollment/backup-codes UX design), an OpenAPI/Swagger spec, a CD pipeline
  (needs a deployment target decision), cloud file storage (needs an S3-compatible provider decision), and a
  Redis-backed rate limiter/permission cache (only matters once horizontally scaled — no infra to point it
  at yet). Nonce-based CSP (removing the `'unsafe-inline'` on `script-src`) is also deferred until the
  `proxy.ts`/auth-middleware flow is revisited, since layering it in safely means touching the one piece of
  code that gates every page's login redirect.

## Phase 11 — Hardening, P1 pass (2026-08-25)

Worked through the independent audit's (`HARDENING_BRANCH_INDEPENDENT_AUDIT.md`) P1 tier — the items flagged
"must fix before production," as distinct from the P0 tier fixed in the first pass above.

- **CF-6 fixed — magic-byte content verification on file upload.** `saveFile()` (`src/core/file-storage/
  FileStorage.ts`) previously trusted the client-declared MIME type alone; a `.exe` declared as
  `application/pdf` was accepted, stored, and served back for download unmodified. Now sniffs the buffer's
  real content via the new `file-type` dependency (`fileTypeFromBuffer`) and rejects on mismatch — legacy
  `.doc`/`.xls` (pre-OOXML Compound File Binary) is the one deliberate exception, since file-type can only
  fingerprint the generic CFB container, not which legacy Office format it holds; an undetectable buffer is
  treated as suspicious rather than trusted on the client's word. **Verified live**: uploaded a real MZ-header
  executable declared as `application/pdf` to a real Sampling attachment — server correctly rejected with
  `400 VALIDATION_ERROR` naming the actual detected type (`application/x-msdownload`); a genuine PDF upload
  immediately after succeeded normally (`201`), confirming no regression. 5 new tests
  (`FileStorage.test.ts`, new file).
- **CF-7 fixed — suspending a user now actually revokes their access immediately, not "eventually."**
  JWT sessions are stateless; nothing previously re-checked `User.status` after initial login, so a
  suspended user's existing 30-day session cookie kept working everywhere. Fixed at two chokepoints:
  `PermissionService.can()` (`src/core/rbac/PermissionService.ts`) now re-checks live DB status on every
  call, deliberately uncached (unlike permission keys) so a suspension takes effect on the very next
  request — covers both API routes and the handful of Server Component pages that call it directly; and
  `requireSession()` (`src/lib/api-route.ts`) does the same re-check, closing the smaller set of routes
  gated on session presence alone with no follow-up permission assert. `setUserStatus()` also now calls
  `PermissionService.invalidate()` on every status change — not required for this fix (the check is
  uncached), but closes the separately-flagged P2 gap ("no cache invalidation wired into any production
  code path") for free. **Verified live end-to-end, not just via unit tests** — created a real second user
  through the actual `/admin` UI's `POST /api/v1/administration/users`, signed in as them (capturing a real,
  unexpired 30-day session), confirmed a permission-gated API call succeeded, then suspended them via a
  direct DB update **without touching that session's cookie at all**, then replayed the identical API call
  on the exact same never-refreshed session — confirmed it now fails with `403 PERMISSION_DENIED` ("Your
  account is no longer active. Please sign in again."), and confirmed the equivalent page navigation
  surfaces the same message inline instead of data. Reactivated the test user and restored the Super Admin
  session afterward. 3 new tests in `PermissionService.test.ts`.
- **CF-5 fixed for Goods Receipt — idempotency key protects against a network-retry double-post.**
  `GoodsReceipt` gained a nullable `idempotencyKey` column (migration `add_goods_receipt_idempotency_key`),
  `@@unique([companyId, idempotencyKey])`. `createGoodsReceipt()` checks for an existing receipt under the
  caller-supplied key *before* drawing a document number (so a replay doesn't burn a real sequence value
  either) and returns it unchanged on a match; a genuine concurrent double-submit that both pass the
  pre-check race to the DB's own unique constraint, caught as `P2002` and resolved the same way (return the
  winner's receipt, not a raw conflict). `GoodsReceiptForm.tsx` generates one UUID per mounted form instance
  and resends it on every submit attempt from that page (including a manual retry after a shown error) —
  the form's fetch call also gained a proper `try/catch/finally` it was missing entirely, since a thrown
  network error previously left the Submit button permanently disabled with no way to retry at all, which
  would have made the new key useless in exactly the scenario it exists for. A full page reload still
  starts a fresh key (an accepted, documented residual gap, not covered by this scope). 7 new tests in
  `goods-receipt.service.test.ts`, including the genuine-concurrent-race path. **Not extended to the other
  ledger-writing document-creation endpoints this pass** (Stock Movement, Job Work receipt, Payment,
  Sales/Purchase Invoice, Expense) — the audit's own phrasing scoped this to Goods Receipt first; the
  identical pattern (nullable key column + `@@unique([companyId, key])` + pre-check + P2002 fallback) is
  ready to replicate once prioritized.
- **`next-auth` pinned to an exact version** (`^5.0.0-beta.32` → `5.0.0-beta.32`) — a routine `npm ci` could
  previously have pulled in an unreviewed breaking change to the auth/session/RBAC layer from a new beta.
- **`npm audit`'s `uuid` finding resolved** via a package.json `overrides` entry forcing `uuid@^11.1.1` —
  `exceljs`'s only use of the vulnerable package (`cf-rule-ext-xform.js`, a conditional-formatting
  extension) calls `v4()` with no arguments, so the specific advisory (missing bounds check when a `buf`
  argument is supplied) was never reachable through this app anyway, but the override closes it cleanly
  with zero code changes needed (uuid v11 still ships a CJS build `exceljs` can `require()`). The remaining
  3 `npm audit` findings (`deepmerge-ts` via `@prisma/config`, a dev-tooling dependency chain) are left as
  accepted risk — fixing them means downgrading Prisma to 6.12.0, which conflicts with this project's
  Prisma 7 driver-adapter architecture and isn't part of the running application's own attack surface.
- **Dispatch's race-guard test gap closed** — `dispatch.service.ts` had the most `updateStatusConditional`/
  guarded-`updateMany` call sites of any module (6, across 5 functions) but the fewest `{count: 0}`
  rejection tests proving those guards actually reject under contention. Added the missing case for every
  one: `markPacked`, `confirmDispatch`'s second (dispatch-level) guard, `markDelivered` (previously not
  even imported into the test file), `transitionDispatchStatus`'s genuine race path (distinct from its
  already-tested "illegal transition" rejection), and `resumeDispatchFromHold` (also not previously
  imported) — 7 new tests, `dispatch.service.test.ts` now 27 tests.
- **Request-correlation ID + actor context threaded into every log line**, closing the audit's observability
  gap ("error logs carry no actor context... a real gap for diagnosing a production incident"). New
  `src/core/logging/requestContext.ts` uses Node's `AsyncLocalStorage` with `enterWith` (not `run` — there
  is no single call site that wraps "the rest of this route handler" in a callback, since `requireSession()`
  is called partway through each handler's own body, not around it; `enterWith` sets the store for the
  remainder of the current async continuation instead, which is all that's needed here). `requireSession()`
  — the one near-universal per-request chokepoint — initializes a correlation ID immediately and records the
  actor once the session resolves; `logger.ts`'s `write()` picks both up automatically with zero changes
  needed at any of this app's ~270 individual route handlers. Degrades gracefully to no requestId/actor
  fields for the rare code path that logs outside of a request (e.g. a background script). 3 new tests in
  `logger.test.ts`.
- **CI now applies every migration to a real Postgres 16 service container** before running tests/build —
  previously "zero automated verification exists that Prisma queries/migrations actually work against real
  Postgres" (every test mocks the repository/Prisma layer). `.github/workflows/ci.yml` gained a `services:
  postgres` block (matching the documented local dev version) and an `npx prisma migrate deploy` step
  between `prisma generate` and the type-check step.
- **Gotcha hit and caught before it caused real damage**: `npx prisma db execute --file <path> --schema
  <path>` fails in Prisma 7 (`--schema` was removed as a flag; the datasource now comes solely from
  `prisma.config.ts`) — but `npx prisma migrate resolve --applied <name>` was run immediately afterward,
  in the same command sequence, which succeeded and marked the migration as tracked-and-applied **without
  the SQL ever actually running**. `prisma migrate status` then reported "up to date," which was true only
  of the tracking table, not the real schema. Caught immediately by not trusting that output — a direct
  `pg` query confirmed the new column/index were genuinely missing, the corrected `db execute` command (no
  `--schema` flag) was run to actually apply the SQL, and a second direct query confirmed both existed
  before proceeding. Worth remembering: `prisma migrate status`/`resolve --applied` only ever reflects the
  tracking table's own bookkeeping, never re-verifies the live schema — a manual spot-check after any
  non-standard migration workflow (this project's own established `db execute` workaround, needed because
  `prisma migrate dev` can't run in this non-interactive shell) is not optional.
- `npx tsc --noEmit`, `npm run lint`, `npx prisma validate`, `npm test` (508/508, 46 new), and `npm run
  build` all clean throughout every fix in this pass.
- **Closed in the next pass, immediately below**: password-reset/change capability, and CF-5 replicated
  onto the other 6 ledger-writing document-creation endpoints.

## Phase 11 — Hardening, P1 tier closed out (2026-08-26)

Closes every remaining item from the P1 tier: CF-5 extended to the 6 modules the first pass hadn't reached,
the Job Work Receipt numbering race found along the way, a full password-security capability (change +
admin-reset + session invalidation), and every bounded P2 item. Reviewed and scoped with the user via an
explicit architecture-validation pass before implementation — see that discussion for the two evaluations
below; nothing here was built speculatively.

**CF-5 idempotency — architecture confirmed, then extended to Stock Movement, Job Work Receipt, Payment,
Sales Invoice, Purchase Invoice, and Expense.** Evaluated module-specific columns (Goods Receipt's own
pattern) against a centralized idempotency table before touching any code — concluded a central table
would still need per-module logic to turn a stored reference back into a real response, providing no actual
simplification while introducing exactly the kind of new polymorphic-table pattern this project has
consistently declined without a forcing reason. Kept Goods Receipt's pattern, adapted per module rather than
copy-pasted:
- **One real correctness deviation from Goods Receipt, found during design, not copied blindly**: every new
  `idempotencyKey` unique constraint is `[companyId, idempotencyKey]` — company-only — even for the four
  modules (Payment, Sales/Purchase Invoice, Expense) whose own document-number uniqueness is branch-inclusive
  (`[companyId, branchId, ...]`). Matching that branch-inclusive shape for the idempotency key specifically
  would have been a real bug: Postgres treats a NULL in any column of a composite unique constraint as
  non-conflicting with every other row, so a branch-inclusive key would silently provide **zero** protection
  the moment `branchId` is null — the common case, not an edge case. Company-only avoids this entirely, since
  a client-generated UUID key needs no branch scoping to already be effectively unique.
- **Sales Invoice and Purchase Invoice each already had an unconditional P2002 handler** (for their own
  pre-existing partial unique indexes — `one_active_per_order` and `supplier_invoice_number` respectively).
  Adding a second unique constraint on the same table meant that handler could no longer assume any P2002
  was "its" collision. Fixed with a new shared `isUniqueConstraintViolationOnColumn(error, columnName)`
  helper (`src/core/errors/BusinessRuleError.ts`) that inspects the actual violated constraint — **the exact
  shape was confirmed empirically, not assumed**: this project's `@prisma/adapter-pg` driver adapter reports
  `meta.driverAdapterError.cause.constraint.fields`, not the classic `meta.target` array most Prisma
  documentation describes (which doesn't appear under this adapter at all) — confirmed by deliberately
  triggering both real constraints against the live dev DB and inspecting the raw error before writing a
  single line of disambiguation logic.
- **Job Work Receipt got a second fix in the same pass**: its `receiptNumber` was never drawn via
  `generateDocumentNumber()` at all — a pre-existing, separate race (`${jobWorkNumber}-R${count+1}`, the
  count read outside any lock) discovered while surveying the module for the idempotency work. Fixed by
  switching to the same atomic `document_sequences` counter every other document type already uses — a new
  `DocumentType.JOB_WORK_RECEIPT` value (prefix `JWR`), not a new numbering mechanism. **Verified live**: an
  old receipt from a prior session still shows its legacy `JWO-2026-00002-R1` format untouched (no
  backfill — history is never rewritten); a brand-new receipt against the same order correctly drew
  `JWR-2026-00001` from the real counter.
- **Payment had no `$transaction`/`try-catch` around its create call at all** — this is the first one it's
  ever had; Stock Movement and Job Work Receipt already had a `$transaction` to wrap. Expense was the
  simplest (flat row, no items, nothing to disambiguate).
- Every module: pre-check before drawing a document number, store the key on create, a P2002-race fallback
  that re-fetches and returns the winner's row, and a client-generated key regenerated per real submit
  attempt (per-form for the 5 dedicated `/new` pages; regenerated on each open of the Job Work Order's
  Receive modal, since that panel handles many distinct receive actions over one order's lifetime, not one
  per page load). Every form's fetch call also gained the same `try/catch/finally` fix as Goods Receipt's own
  earlier pass — a thrown network error no longer leaves the Submit button stuck disabled forever.
- **Verified live end-to-end, with direct DB proof, not just unit tests**: created a real Stock Movement with
  a client-generated key, replayed the identical request — the server returned the exact same movement id
  both times, and a direct query confirmed exactly one `stock_movements` row and exactly one
  `inventory_transactions` ledger entry exist despite the duplicate request.
- 30 new tests across the 6 modules (replay, fresh-key, no-key-unaffected, genuine-concurrent-P2002-race,
  plus the Sales/Purchase Invoice disambiguation regression proving a same-table-different-constraint
  collision is never misattributed) — all against the real, empirically-confirmed error shapes, not
  hypothetical ones.

**Password security — architecture confirmed against what actually exists before building anything.**
Surveyed first: bcrypt (cost 12) already exists; JWT sessions with no versioning; no email infrastructure
anywhere in the codebase (confirmed by grep); no token/reset-model exists. Scoped to exactly what the
existing infrastructure supports, per the user's explicit decisions:
- **`POST /api/v1/account/change-password`** (new `src/modules/account/` module) — self-service, no RBAC
  permission required (self-scoped by construction, the same category as "view your own session"),
  verifies the current password before accepting a new one.
- **`POST /api/v1/administration/users/[id]/reset-password`** — admin-triggered, gated `administration.edit`,
  company-scoped via the same `findById` pattern `setUserStatus` already uses (confirmed live: a nonexistent/
  cross-scope id correctly 404s), no current-password check (that's the entire point of a reset).
- **`User.passwordChangedAt`** (new nullable column) is stamped by both paths through one shared
  `UserAdminRepository.updatePasswordHash()` — the two flows can never drift out of sync on this. Never
  logged in either flow's audit entry (`{ passwordChanged: true }` / `{ passwordReset: true }` only) —
  confirmed live via a direct query that no plaintext password or hash value appears anywhere in the
  resulting `audit_logs` rows.
- **Session invalidation reuses CF-7's exact mechanism, extended to cover it symmetrically at both of CF-7's
  own chokepoints**: a new `session.user.sessionIssuedAt` JWT claim (stamped once, at sign-in only, via
  `auth.config.ts`) is compared against `passwordChangedAt` in `requireSession()` (covers the ~285 API
  routes that call it) and inside `PermissionService.can()` via a new optional `resourceContext.sessionIssuedAt`
  field (covers the 10 Server Component pages that call `PermissionService.assert()` directly without going
  through `requireSession()` — each updated to pass it). **Verified live, end-to-end, not just via unit
  tests**: created a real second user, signed in as them, confirmed a permission-gated call succeeded (200),
  called `change-password` from that exact session, and — with zero new login — the identical never-refreshed
  session immediately got `403` ("Your password was changed. Please sign in again.") on its very next call.
  Separately confirmed the old password no longer authenticates at all and the new one does (via a real
  sign-out/sign-in round trip, not just a session-state read, since a *failed* login attempt doesn't clear an
  existing cookie — a subtlety this session initially got wrong and caught by insisting on an unambiguous
  test).
- **A real, unavoidable deployment nuance, documented rather than glossed over**: a session whose JWT was
  issued **before** this change ships has no `sessionIssuedAt` claim at all (NextAuth doesn't retroactively
  inject a new claim into an already-issued, stateless JWT) — `undefined * 1000 < anything` is `NaN <
  anything`, which is always `false` in JS, so such a session is silently exempt from the staleness check
  until it naturally re-authenticates (JWT expiry, or an explicit sign-out/sign-in). This is inherent to
  layering a new claim onto an existing stateless-JWT scheme, not a bug in this implementation — flagged here
  so it isn't mistaken for one later.
- 3 new tests in `PermissionService.test.ts`, a new `src/lib/api-route.test.ts` (7 tests, `requireSession`
  had none before), 4 new tests in `account.service.test.ts`, 3 new tests in `user-admin.service.test.ts`.

**Sampling's self-approval guard moved from the route into `recordSampleApproval()` itself** — previously
lived only in `decision/route.ts`, which independently re-fetched the version/request via a separate query
purely to build the resourceContext, then called the service, which fetched everything a second time via
different repository calls. A second future caller of the service directly would have silently bypassed the
guard. Fixed by moving the real, self-approval-guarded assert inside the service (using `request.requestedByUserId`,
already fetched there — no extra query), leaving only a coarse `sampling.approve`/`reject` check (no
resourceContext) in the route for early rejection. Matches `approveLeaveRequest()`'s own already-established
precedent for this exact fix shape. New regression test proves the guard survives a direct service call with
no route-level check at all.

**Fixed the flaky encryption tamper test** — the old assertion replaced the ciphertext's last 2 base64
characters with a fixed `"AA"`, a ~1-in-4096 chance of leaving the value unchanged (a false negative: the
test would pass for the wrong reason). Replaced with a deterministic XOR-flip of the last decoded byte —
guaranteed different every time, no probability involved.

**New cross-cutting contract test** (`src/modules/__tests__/company-scoping.contract.test.ts`) — scans every
`*.service.ts` file for exported `update*`/`transition*` functions and asserts each one's own source body
references `actor.companyId` somewhere, with a small, explicit, reviewed allowlist (`updateUnit` — `UnitOfMeasure`
is deliberately global, no `companyId` column at all). Deliberately crude (source-text matching, not a real
AST/type-flow pass) but targets exactly the repeated bug class this project has found and fixed the most
times. Found 54 matching functions; all 54 passed on the first run except the one correctly allowlisted one —
a genuine, if retroactive, confirmation that this codebase's own hard-won tenant-scoping discipline has
actually held across every one of these functions.

**Dependabot + CodeQL added** (`.github/dependabot.yml`, `.github/workflows/codeql.yml`) — weekly npm +
GitHub Actions dependency checks, and JS/TypeScript CodeQL analysis on push/PR/weekly schedule. This
repository's visibility/GitHub Advanced Security entitlement could not be verified from this environment;
per explicit instruction, the workflow was added anyway rather than blocking on that unknown — if GitHub
blocks or skips runs due to a licensing/visibility constraint, that will show up directly in the Actions tab
as a platform limitation, not a code defect.

**`EXPORT_ROW_CAP` deduplicated** — the 3 Excel export routes (`products`, `stock-balances`, `job-work-orders`)
each declared their own local `const EXPORT_ROW_CAP = 20000`. All three now import the single existing
`EXPORT_ROW_CAP_EXCEL` constant from `src/core/reports/constants.ts` (already existed for this exact purpose,
just not yet reused here).

`npx tsc --noEmit`, `npm run lint`, `npx prisma validate`, `npm test` (620/620, 100 new), and `npm run build`
all clean throughout. Every new column/index/enum value independently re-verified against the live database
via a direct query — never trusted from `prisma migrate resolve --applied` alone, per this project's own
established gotcha.

**Not addressed, explicitly out of scope per this pass's own instructions**: TOTP/2FA, Redis-backed rate
limiting, nonce-based CSP, cloud storage, CD/deployment platform decisions — all remain documented P3 items
requiring a decision only the user can make.

## Phase 9 — Reports & MIS, first slice (2026-08-25)

Built on branch `report`, merged to `main` on 2026-08-25. The user supplied an extremely detailed ~150-report, 27-
category spec, with an explicit instruction to inspect the real schema/services first, never invent data
for a genuine gap, and never create a duplicate calculation that could disagree with an existing one.
Scoped via two AskUserQuestion rounds before any code was written: (1) build the full architecture + Report
Center nav for all 27 categories now, but implement only the highest-value ~40-50 reports this pass (every
unbuilt report shows an honest "not yet built"/"not available" state, never a fake page) — ended up
shipping **58 reports** across 24 categories, comfortably past that target; (2) add `@react-pdf/renderer`
(pulled in `yoga-layout@3.2.1`, the WASM build, not the old native-binding one — confirmed via `npm ls`) with
one shared generic PDF template, not a bespoke layout per report.

**The reconciliation guarantee, architecturally enforced, not just promised**: every report has exactly ONE
`async function get<X>Descriptor(companyId, generatedByName, filters)` — registered once via
`registerReport()` (`src/modules/reports/registry.ts`) — called identically by the JSON view route
(`GET /api/v1/reports/[category]/[report]`) and every export route
(`GET /api/v1/reports/[category]/[report]/export/[format]`), both single dynamic route files shared by
every report rather than one pair of files per report (a `?export=` query param was explicitly rejected in
favor of matching the existing sibling-route precedent already used by `stock-balances/export/xlsx` etc.).
This is what makes an export unable to silently disagree with its own screen — not the routing style. Two
registries exist deliberately split by server/client boundary: `registry.ts` (server, holds the real
Prisma-backed `buildDescriptor` functions) and `report-page-meta.ts` (client-safe, zero Prisma imports
anywhere in its chain, holds title/filterFields/linkBuilders/renderKpis) — the generic
`/reports/[category]/[report]` detail page is a Client Component that imports only the latter, so a report's
filter config never accidentally drags Prisma into the browser bundle.

**Verified data-mapping was the actual first deliverable**, not skipped: three parallel Explore agents
confirmed exact schema field names against every one of the 27 categories before any report was coded (see
the plan file's own "Confirmed reusable" / "Confirmed hard gaps" tables, preserved in git history on this
branch). Concrete gaps found and handled honestly rather than papered over:
- **Payroll** — zero schema anywhere (`Payroll`/`Salary` models don't exist). Report Center shows it as
  "Not available — no payroll module exists in this ERP," not a fake page.
- **Sample Material Issue/Return/Consumption** — `SampleMaterial` only has `plannedQuantity`+
  `damagedQuantity`; only a Sample Material **Requirement** report was built, with an explicit subtitle
  stating issue/return/consumption tracking doesn't exist in the schema yet.
- **True Login History** — only `User.lastLoginAt` (a single overwritten timestamp, no history table). Built
  as "Last Login per User," explicitly labeled as not a history list.
- **Labour Cost / Overhead Cost in Profitability** — `CostMaster` exists but has zero FK from any
  transactional table. Both Profitability reports render these columns as the literal string `"Not Tracked"`
  — never computed from `CostMaster.rate` as if it were a real incurred cost. An order/style whose BOM chain
  is incomplete (missing BOM, or a BomItem material with no `unitCost`) shows `"Incomplete (no BOM)"` rather
  than a silently-undercounted number, and totals report the exact count of excluded rows rather than
  quietly summing over a partial set.
- **"Color-wise / Size-wise Packing"** — built as real data (`CartonItem.productVariantId` is genuine
  user-entered packing detail), explicitly subtitled as packing composition, not a sales/revenue figure —
  no schema exists to support a genuine variant-level revenue number, and none was fabricated.
- **Production Achievement %/Rejection %** — confirmed absent everywhere in the codebase via grep; built
  fresh as pure ratios over real, existing `JobOrder` quantity columns per the spec's own formulas — this is
  deriving, not inventing.
- **"Production Planning"** — no distinct planning/schedule concept exists beyond `ProductionOrder`'s own
  planned fields; folded into Production's own reports rather than inventing a separate category's worth of
  sub-reports.

**RBAC reuses the existing catalog untouched** — zero new modules/actions. `assertReportAccess()`
(`src/core/reports/permissions.ts`) asserts `reports.<action>` plus every "owning module" `view` permission
for that category (a static `REPORT_CATEGORY_MODULES` map, e.g. `sales-orders` → `sales_orders`,
`accounts`/`invoicing`/`receivables`/`payables`/`expenses`/`profitability` → `accounts`+`financial_reports`).
The one cross-module exception is the **Order Lifecycle Report** — the single bespoke, non-generic report in
this module (its own page + its own API route, not built on the generic `ReportTable` shell, mirroring
`getCustomer360()`'s multi-section precedent since forcing a many-stage trace into flat columns/rows would
lose the hierarchy). It's gated on `reports.view` only; each of its 9 sections (Order/Sampling/Material
Requirement/Purchase/Production/QC/Dispatch/Invoice/Payment) is independently checked against the viewer's
real per-module permission via `canAccessModule()` and **omitted** (not shown-then-blocked) if they lack
it — a Merchandiser without Accounts access still sees every stage they ARE allowed to see instead of being
denied the whole report for lacking one stage's permission. Verified live end-to-end against a real order
(`ORD-2026-00009`): populated Sampling and Dispatch sections rendered correctly, empty sections (Material
Requirement/Purchase/Production/QC/Invoice/Payment) showed honest "not yet" messages rather than blank space
or errors.

**PDF/Excel/CSV export**: `src/core/reports/pdf.tsx` is one shared `@react-pdf/renderer` `Document`
component reused by every report (repeating header via `fixed`, page numbers via the `render={({pageNumber,
totalPages})}` footer callback, `landscape` orientation for wide reports like General Ledger/Day Book/Order
Aging), capped at 2,000 rows (`EXPORT_ROW_CAP_PDF`) with an explicit "showing first N of M" notice rather
than silently truncating — large registers should use Excel/CSV instead. `src/core/reports/excel.ts` wraps
the existing `buildXlsxBuffer`/exceljs convention with a filter-summary block, frozen header row, and a
totals row; `src/core/reports/csv.ts` wraps the existing hand-rolled `toCsv`. All three verified live via a
direct `fetch()` per format against Trial Balance's export routes — all three returned `200` with correct
`Content-Type`/`Content-Disposition` headers and non-trivial byte sizes.

**Reconciliation verified live, not just asserted**: Trial Balance's report page showed an identical
₹3,51,288.90 / ₹3,51,288.90 grand total, row-for-row, against the pre-existing `/accounts/trial-balance`
page for the same data — confirming `getTrialBalance()` (journal.service.ts) is genuinely reused unchanged,
never re-derived. General Ledger's Cash account closing balance (₹-465.00) matched Trial Balance's own Cash
Net Balance exactly, confirming `getAccountLedger()` (chart-of-account.service.ts) is likewise reused
unchanged — the one small supporting change was adding `journal.id` to an existing `include` in
`ChartOfAccountRepository.findLedgerLines()` (`chart-of-account.repository.ts`) purely for the drill-down
link, a minimal additive change with no behavior change for existing callers (confirmed via the full 450-test
suite staying green).

**Two real bugs caught and fixed before merge-readiness**: an ESLint `react-hooks/set-state-in-effect`
violation in `ReportPage.tsx` (calling `setLoading(true)`/`setError(null)` synchronously at the top of the
data-fetching effect, before any promise chain — fixed by following the exact pattern already established in
`channel-performance/page.tsx`: never call setState synchronously in an effect body, only inside `.then()`/
`.catch()` callbacks, with loading derived as `descriptor === null && error === null` instead of a separate
state variable); and a Next.js `no-assign-module-variable` violation in `permissions.ts` (a `for (const
module of ...)` loop — Next.js reserves the bare identifier `module` — renamed to `mod`).

**A genuinely surprising TypeScript gotcha hit and documented, worth remembering for any future barrel
file**: `tsc --noEmit` does **not** report `TS2307` ("Cannot find module") for a bare side-effect-only import
(`import "./some-missing-file";`) — confirmed by deliberately creating both a side-effect import and a named
import of the same nonexistent module: the named import correctly errored, the side-effect import produced
zero diagnostic. This meant `all-reports.ts`/`all-report-page-meta.ts` (the two barrels that each import one
file per category) stayed "tsc-clean" throughout this session even while several category files hadn't been
written yet — `tsc` is not a reliable signal that a barrel's referenced files actually exist; only Next.js's
own bundler (or a manual `ls`) catches a missing file in this specific import shape.

**Delegation note**: 11 of the ~14 category-report file-pairs were built via parallel background `general-
purpose` agents, each given the exact `ReportConfig`/`ReportPageMeta` interfaces, the full worked
`sales-orders.reports.ts`/`sales-orders.page-meta.ts` reference implementation, and precise schema excerpts
for their category (never left to guess field names). Several agents were terminated mid-task by a session
usage-limit reset; the ones that completed produced files reviewed and confirmed correct, and the
incomplete/missing pieces (`receivables-payables-expenses.reports.ts`, `hr-attendance.reports.ts`, and six
missing `page-meta` files) were finished directly afterward, reusing the same exact patterns already
established by the completed agents' output.

**Verified**: `npx tsc --noEmit`, `npm run lint`, and `npm test` (450/450, no regressions) all clean after
every commit. Full report inventory (report/category/key/DB source/filters/drill-down/QA status) in
[REPORTS_INVENTORY.md](REPORTS_INVENTORY.md).

**Known limitations, explicitly not fixed this pass** (documented, not silently dropped):
- The on-screen "Applied filters: X" summary line echoes a `<select>` filter's raw stored value (e.g. a
  UUID for Customer/Supplier/Account) rather than its human-readable label, since the label only exists
  client-side in the already-fetched dropdown options, not in the server-built descriptor. Cosmetic only —
  every report's actual data and totals are correct; only this one summary line reads awkwardly for
  ID-based filters.
- Every category is capped at 1-5 of the highest-value named reports from the original ~150-report spec,
  not the full list (e.g. Purchase Price Comparison, Slow-Moving/Dead Stock, Line/Department/Operator-wise
  Production, Rework Report, Fabric/Trims/Accessories Consumption splits, Cash Flow/Balance Sheet, Leave
  Register). Follow-up sessions can add more reports directly onto this same architecture — the pattern is
  now proven end-to-end.
- Saved report filters (a user-preference system) — deferred; no existing preference-storage mechanism to
  reuse, would need new schema.
- Weekly/Monthly MIS trend views beyond the Daily MIS built this pass — sequencing, not a gap.

### Phase 9 QA sweep — 4 real bugs found and fixed (2026-08-25)

Walked every one of the 58 reports live in the browser after the initial build (not just the handful spot-
checked during the build itself) and found four real bugs:

- **P1 — "today"/"this month"/"this year" boundaries were computed one UTC calendar day too early on this
  server.** `startOfDay`/`startOfMonth`/`startOfYear` in `dashboard.reports.ts` (Executive Dashboard, Daily
  MIS) and the equivalent helpers in `hr-attendance.reports.ts` (Daily Attendance, Monthly Attendance
  Summary) built boundaries via `new Date(year, month, day)` — the LOCAL-timezone component constructor. This
  server runs IST (UTC+5:30), so local midnight is 5.5 hours *behind* UTC midnight of the same calendar day.
  Every `@db.Date` column in this schema (`dispatchDate`, `orderDate`, `invoiceDate`, `expenseDate`,
  `attendanceDate`, ...) is populated from a plain "YYYY-MM-DD" date-input string, which the JS `Date`
  constructor always parses as UTC midnight — so comparing a `@db.Date` column against a local-midnight
  boundary silently pulled in the previous UTC calendar day's rows as "today". Confirmed empirically with a
  standalone script against the real dev DB: a `dispatch.count({ dispatchDate: { gte: todayStart } })` query
  matched every dispatch dated the day before "today," not zero as it should have. Fixed by deriving every
  boundary from UTC calendar components instead (`d.toISOString().slice(0,10)` for a day boundary,
  `Date.UTC(...)` for month/year) — the same convention this app's own client-side code already uses for
  "today" (`toIsoDate()` in `marketing/channel-performance/page.tsx`). **Worth remembering for any future
  report/dashboard code that buckets by day/month/year**: never build a date-column comparison boundary with
  `new Date(y, m, d)` — always derive it from UTC components, since the server's local timezone has nothing
  to do with how a `@db.Date` value was written.
- **P3 — null-vs-zero conflation, the same bug class this project has hit before.** Supplier Register's
  Payment Terms (days) and Customer Register's Credit Limit both defaulted a genuinely-unset (`null`) value
  to `0` before display, rendering "0" — indistinguishable from a real, deliberately-configured zero. Fixed
  to pass `null` through so `ReportTable` renders "—" instead, matching the `SampleMaterial.damagedQuantity`
  precedent from Phase 4.
- **P3 — floating-point noise in the Customer Ledger's running balance.** Summing many sequential
  invoice/payment amounts left IEEE-754 drift (a fully-paid customer's final balance was `1.8e-13`, not
  exactly `0`) — invisible in the currency-formatted on-screen table (which rounds for display) but printed
  raw and ugly (`1.8118839761882555e-13`) in the CSV export, which prints numbers as-is. Fixed by rounding to
  currency precision (`Math.round(x * 100) / 100`) at every accumulation step, the same fix already applied
  to MRP's quantity calculations in the P2-P4 QA pass.
- **P4 — redundant flat table under KPI-card reports.** `ReportPage` rendered the generic `ReportTable`
  underneath a report's own KPI cards (Executive Dashboard, Daily MIS) even though the cards already show
  every row — purely visual duplication. The table is now skipped whenever a report supplies `renderKpis`.

Verified live after each fix (including a full dev-server restart each time, per this project's own
documented stale-Turbopack-cache gotcha): Executive Dashboard/Daily MIS correctly show ₹0/0 for "today" (all
seeded activity is dated the prior day); Customer/Supplier Register show "—" for unset values; Customer
Ledger's total and CSV export both show a clean `0`. Re-swept all 58 reports end-to-end after the fixes to
confirm cross-report reconciliation still holds throughout (Trial Balance ⇄ General Ledger ⇄ Day Book ⇄
Journal Register; Executive Dashboard ⇄ every domain's own register/summary report — Stock Value, Low Stock
count, Production Achievement/Rejection %, AR/AP totals, Expenses, Stock Valuation all cross-checked
row-for-row). `npx tsc --noEmit`, `npm run lint`, and `npm test` (450/450) clean throughout.

## Phase 9B — Complete remaining reports (2026-08-25)

Follow-up pass on the same `report` branch, filling in the 4 categories the first pass left as "Coming
soon" and adding the highest-value reports from Phase 9A's own "explicitly deferred" list — using the exact
same architecture (one descriptor-builder per report, `registerReport`/`registerReportPageMeta`, no new
infrastructure needed). **17 new reports, 75 total** (see [REPORTS_INVENTORY.md](REPORTS_INVENTORY.md)).

**New categories, now genuinely built instead of "Coming soon"**:
- **Warehouse** (2) — Warehouse Stock Summary (a per-warehouse rollup of the exact same StockBalance/
  unitCost/reorderLevel source the Inventory category's own reports use) and Warehouse Register (the
  Warehouse master itself with a live `WarehouseLocation` count). Caught mid-build:
  `Warehouse.managerEmployeeId` is a bare scalar column with **no declared Prisma relation** to `Employee`
  (confirmed by reading the schema — no `@relation` line exists for it) — an `include`/`select` on it would
  have been a compile error; resolved with a manual secondary `Employee.findMany({ where: { id: { in:
  managerIds } } })` lookup instead.
- **Production Planning** (2) — Production Schedule (planned vs. actual start/end dates straight off
  `ProductionOrder`'s own columns) and Delayed Production Orders (open orders past `plannedEndDate` with no
  `actualEndDate` yet). This dev DB's seed data never populated `plannedStartDate`/`plannedEndDate` on any
  Production Order, so both reports correctly show all-dashes/empty — an honest reflection of what's
  actually in the database, not a bug.
- **Material Consumption** (2) — Material Consumption Variance (BOM-computed requirement, converted to the
  material's base UOM via the existing `convertUomQuantity()` helper — never re-derived — vs. actual issued
  quantity summed directly from the `InventoryTransaction` ledger, scoped through `MaterialRequest
  .productionOrderId`) and Consumption by Material Category (the same ledger source grouped by
  `Product.materialCategory` — the generalized "Fabric/Trims/Accessories consumption split" the original
  spec asked for, covering whatever categories actually exist rather than hardcoding three).
- **Business Performance** (3) — Top Customers by Revenue and Top Styles by Revenue (both the same posted-
  Sales-Invoice source as Sales & Orders'/Profitability's own reports, ranked and capped to the top 20) and
  Monthly Sales Trend (revenue by calendar month across all history).

**Extensions to already-built categories**: Purchase Price Comparison (unit price paid per material across
every PO, sorted to surface cross-supplier variance), Slow-Moving/Dead Stock (stock whose most recent
`InventoryTransaction` predates a configurable threshold, or that has never moved at all — genuinely empty
on this freshly-seeded dev DB at the default 60-day threshold, confirmed non-empty at `thresholdDays=0` to
prove the mechanism itself works), Line-wise Production and Operator-wise Production (JobOrder/
JobOrderProgressEntry grouped by `ProductionLine`/`Employee`, with an honest "Unassigned"/"Adjustment"
bucket for rows with no line or employee attributed), Rework Report (queries
`ProductionStageTransaction.transactionType === "REWORK"` — the ledger's own explicit marker, confirmed via
schema read rather than inferring rework from `isBackward`+quantity heuristics), Leave Register (a thin
read over the existing `LeaveRequest`/`LeaveType` HRMS schema, zero new leave-tracking mechanism), and two
real financial statements:
- **Profit & Loss Statement** — queries `JournalLine` directly (POSTED only, INCOME/EXPENSE accounts,
  period-scoped) rather than via `getTrialBalance()`, since a P&L is inherently a date-range statement and
  `getTrialBalance()` only ever takes a single "as of" date. Expense rows are deliberately stored as
  *negative* amounts specifically so the descriptor's `totals` bar (a plain sum of the Amount column) is
  exactly Net Profit — never a second, separately-computed net-profit figure that could disagree with the
  line items shown.
- **Balance Sheet** — a thin wrapper over `getTrialBalance()` (never re-derived), grouped by `accountType`.
  This project's Chart of Accounts has no period-closing mechanism, so Current Period Net Profit (computed
  from the SAME trial balance rows' INCOME/EXPENSE accounts) is folded into Equity, matching real accounting
  practice. The report's last row is a literal, checkable statement of the fundamental identity
  (`Assets − (Liabilities + Equity)`, which must be exactly 0) — not asserted in prose, shown as a real
  computed row a user can verify themselves. Verified live down to the cent.

**One more floating-point bug caught and fixed, before it shipped this time**: the Balance Sheet's own
identity-check row initially showed `-1.4551915228366852e-11` instead of a clean `0` — the same IEEE-754
noise-from-many-Decimal-additions class already fixed once in the Customer Ledger during the Phase 9 QA
sweep. Caught by directly inspecting the raw JSON (the currency-formatted on-screen table rounds for
display and would have hidden it) before committing, not after a user complaint — added a shared `round2()`
helper to `accounts.reports.ts` and applied it to every computed total in both the P&L and Balance Sheet
(`totalIncome`/`totalExpense`/`netProfit`/`totalAssets`/`totalLiabilities`/`totalEquityAccounts`/
`totalEquityInclProfit`/the final difference check) — verified the identity check reads exactly `0` after
the fix, with a full dev-server restart to clear Turbopack's cache before re-checking (this project's own
now-thoroughly-documented gotcha, hit again and immediately recognized rather than mistaken for a real
regression).

Every new report live-verified in the browser and cross-checked against its already-verified sibling
(Warehouse Stock Summary ⇄ Inventory's Stock Summary/Valuation/Low Stock; Line-wise/Operator-wise
Production ⇄ Production Achievement's own totals; Top Customers/Styles by Revenue ⇄ Customer-wise Sales/
Style Profitability; Profit & Loss ⇄ Trial Balance's own Income/Expense account balances). `npx tsc
--noEmit`, `npm run lint`, and `npm test` (450/450, no regressions) all clean throughout.

## Phase 10 — Full ERP Testing, Bug Fixing & Required Updates (2026-08-26, branch `phase-10-testing`)

A full QA/UAT pass across every completed module and all 75 reports, per an extensive 37-section user
specification. Branch created off `main` at `c8c9c47` (the post-Hardening-P1 commit). Methodology: establish
a clean baseline, dispatch parallel read-only `erp-qa-uat` agents to find bugs (no fix authority — findings
only), synthesize and deduplicate their reports, then fix everything found with regression tests, verifying
each fix live before committing in small logical commits. Full raw agent findings (every individual
`ERP-BUG-*` id, per-agent PASS confirmations, and the fix-to-commit cross-reference) preserved in
[PHASE_10_QA_REPORT.md](PHASE_10_QA_REPORT.md); this section is the synthesized narrative.

**Baseline** (before any Phase 10 changes): `npx tsc --noEmit` clean, `npm run lint` clean, `npm test`
508/508 (45 files), `npx next build` clean (188/188 static pages). Module inventory: 117 Prisma models, 289
API routes, 119 dashboard pages, 49 services, 43 repositories.

**Agent dispatch**: 9 parallel `erp-qa-uat` agents, each scoped to a module cluster or the reports catalog
(RBAC/Auth/API security; Sales+Sampling+BOM/MRP; Purchase+Inventory+Material Request; Production+QC+
Packing+Dispatch; Accounts+financial reconciliation [flagged highest priority]; Reports parts 1–3 covering
all 75 reports; a dedicated timezone+floating-point sweep + light CRM/Marketing/HRMS regression check). All
9 hit a session usage-limit mid-run partway through and were resumed (not restarted) from their exact
transcript cutoff via `SendMessage` once the limit reset — each correctly picked up mid-task rather than
re-doing already-completed work.

**Environment note surfaced by nearly every agent**: this session ran with heavy concurrent automation
against one shared dev server/browser/database — agents repeatedly reported sessions silently swapping
between test accounts, tabs being navigated out from under them, and transient errors that turned out to be
session-contention artifacts rather than real bugs (e.g. one agent's "report export returns 403 for
everyone including Super Admin" finding was independently re-verified via an isolated curl session and
found to be a false positive — the agent's own session had been logged out mid-test, confirmed by its error
being "Sign in required," not a permission denial). Every finding below was independently re-verified live
before being treated as real.

**Infrastructure issue found and fixed immediately, before the fix pass began**: the dev database was
missing the `goods_receipts.idempotency_key` column despite migration `20260825181642_add_goods_receipt_
idempotency_key` existing in the repo — `npx prisma migrate status` confirmed it had genuinely never been
applied (not the previously-documented `resolve --applied`-without-running-the-SQL gotcha this time, just a
plain pending migration). Fixed via `npx prisma migrate deploy`, which was blocking Purchase Order detail
pages for multiple agents mid-run.

### Bugs found and fixed

**P0 — 1 found, 1 fixed:**
- **Job Order status overload blocked forward/QC on ordinary, non-final-stage completion.**
  `applyJobOrderQuantityDelta()`/`applyQcDispositionInTx()` persisted `computeJobOrderStatus()`'s result
  (which returns `"COMPLETED"` the moment `completed+rejected+damaged` reaches `planned`, with zero
  awareness of whether the stage is final) directly to the job order's raw `status` column —
  `forwardJobOrder()`/`recordQcInspection()` both guard on `status === "COMPLETED"` believing that value is
  exclusively set by `completeAtFinalStageInTx` (the Phase 5C P0 fix's own guard). Fully completing an
  ordinary, non-final stage via normal progress logging before ever calling Forward permanently blocked
  that job order from being forwarded or QC'd — no in-app recovery path — confirmed live on both fresh test
  data and pre-existing production data. Fixed by adding `computeWritableJobOrderStatus()`, which caps a
  computed `"COMPLETED"` down to `"IN_PROGRESS"` for these two write paths, so `"COMPLETED"` stays
  exclusively `completeAtFinalStageInTx`'s to grant — matches the intent the original guard's own comment
  already claimed but the code didn't enforce. 2 regression tests added; the original P0 fix's own
  regression tests re-verified passing (double-forward/double-QC on a genuinely final-stage-completed job
  order is still correctly blocked — this fix narrows the guard's trigger condition, doesn't remove it).

**P1 — 4 found, 4 fixed:**
- **MANAGEMENT could never invoke the Sales Order sample-approval override.** The confirm route
  unconditionally asserted `sales_orders.edit` before ever reaching `confirmSalesOrder()`'s real
  `approve`-gated override logic. No non-SUPER_ADMIN role holds both `edit` and `approve` on `sales_orders`
  (MERCHANDISER has `edit` only, MANAGEMENT has `approve` only) — so the documented, previously-"verified
  live" Management-override workflow was in fact only ever exercised as SUPER_ADMIN, and was completely
  unusable by any real human role in production. Fixed by accepting either `edit` or `approve` at the
  route's door, letting the internal self-approval-guarded check do the real gating. Verified live: a
  MANAGEMENT test user (approve, no edit) can now confirm an order (200), where it previously 403'd.
- **Report date-range filters silently dropped most of the selected end date's data**, for any report
  filtering a genuine `DateTime` column (not `@db.Date`) — `new Date(dateTo)` parses to the START of that
  day, so the previous `lte: dateTo` excluded almost the entire day. Confirmed live: filtering Rework
  Report/QC Inspection Register for the one day their only real test data was dated returned 0 and 2 rows
  instead of the real 2 and 5. Affected ~15 report files, each with an independently copy-pasted
  `parseDateRange()`. Fixed by centralizing into one shared `parseReportDateRange()`
  (`src/modules/reports/report-date-range.ts`) returning an **exclusive** `dateToExclusive` (`dateTo + 1
  day`) — `lt: dateToExclusive` is correct for both column types, removing the need for any per-report
  column-type judgment call. General Ledger's own `@db.Date`-backed call was deliberately left on the plain
  inclusive form, since it's already correct for that column type. Also fixed in passing: a pre-existing
  stray literal NUL byte in `packing-dispatch.reports.ts` (used as a map-key delimiter — harmless to
  behavior, but the reason git/grep had been flagging that file as binary).
- **Client-side "This Month/Quarter/Year" date presets landed one day early on IST.** `toIsoDate()` in 3
  separate files (CRM Dashboard, Marketing Channel Performance, Sampling Filters) built period-start
  boundaries with local `Date` components then serialized via `.toISOString()`, which converts through UTC
  — on IST (UTC+5:30), local midnight of the 1st is 18:30 UTC on the *previous* day. Confirmed live: "This
  Month" on 2026-08-26 returned 2026-07-31 on all three pages. Fixed by reading local calendar components
  directly instead of ever converting through UTC, matching the same reasoning already applied server-side
  in `dashboard.reports.ts`'s own `startOfMonth`/`startOfYear` helpers (which don't have this bug — this is
  a *new* instance of a previously-fixed bug class, found in different files).
- **Excel export crashed with a raw 500** for any report whose title contains an Excel-illegal
  worksheet-name character (`* ? : \ / [ ]`) — "Slow-Moving / Dead Stock" and both "Customer/Supplier
  Outstanding / AR/AP Aging" report titles all hit this. `buildReportXlsxBuffer()` truncated the title to
  Excel's 31-char sheet-name limit but never stripped the forbidden characters. Fixed with a
  `sanitizeWorksheetName()` helper; CSV/PDF exports for the same reports were unaffected (format-specific
  bug). 2 new tests added (`src/core/reports/excel.test.ts`, the first coverage for that file).

**P2 — 10 found, 10 fixed:**
- **Systemic floating-point noise across currency totals** — the single largest fix in this pass, reported
  independently by 4 different QA agents in different reports (confirming it's a genuinely systemic
  pattern, not 4 unrelated bugs). Summing many `Decimal`-derived JS numbers via `.reduce()` with no rounding
  left IEEE-754 drift in results — sometimes a harmless-looking `.05` rounding error, sometimes genuine
  scientific notation for a value that should be exactly 0 (General Ledger's running balance showed
  `1.0658141036401503e-14` for a fully-settled account, both in the JSON API and the CSV export). Two
  earlier point-fixes existed (Customer Ledger's running balance, Balance Sheet's summary row, both from the
  Phase 9 QA sweep) but were never generalized, so the identical bug kept recurring everywhere else the same
  reduce-without-rounding pattern appeared. Fixed by adding one shared `round2()` (`src/lib/money.ts`, also
  normalizes `-0` to `0`) and applying it at the root — `getTrialBalance()`/`getAccountLedger()` in the
  accounts module, which every Trial Balance/General Ledger/Day Book/Journal Register/Balance Sheet report
  either wraps or queries directly — then at every other currency accumulation found: Sales/Purchase Order
  Register, Customer/Supplier Outstanding (both category variants), Sales Invoice Register, Outstanding
  Invoice, Purchase Monthly/Supplier-wise Summary, Stock Valuation, Warehouse Stock Summary, Top
  Customers/Styles by Revenue, Monthly Sales Trend. Order/Style Profitability was checked and confirmed
  already safe (formats every value through `.toFixed(2)` before it reaches a row, which incidentally
  already rounds correctly). Verified live end-to-end: Trial Balance's AR row is now a clean `42.6` (a QA
  run had shown `netBalance: 49.600000000000364`); General Ledger's full 16-row statement for the same
  account has zero drift anywhere, including the previously-`1.06e-14` row.
- **Sales Invoice Register and Purchase Order Register totals included CANCELLED documents**, disagreeing
  with their own sibling reports (Sales Register; Supplier-wise Purchase/Purchase Monthly Summary — both
  already exclude cancelled) by exactly the cancelled documents' amount. Rows still show every status
  (unchanged — both registers are documented as the full audit trail), but totals now exclude CANCELLED.
  Verified live: Purchase Order Register (12 rows, 4 cancelled) now totals ₹356,600, exactly matching
  Supplier-wise Purchase.
- **Customer-wise Dispatch counted DRAFT/PACKED dispatches** (never actually shipped, zero stock impact)
  toward "Total Dispatched Quantity", disagreeing with Pending Dispatch's own DRAFT/PACKED scope for what's
  NOT yet dispatched. Now scoped to DISPATCHED/DELIVERED only, matching the FG-stock-decrementing definition
  used everywhere else in this app.
- **Sample Conversion Report's metric materially overstated the real conversion rate** — its
  `convertedSamples` count included any Approved sample with a linked Style, including ones created
  directly against a pre-existing style that never touched Convert-to-Style (nothing in the schema
  distinguishes the two paths). A real schema migration (a `convertedToStyleAt` timestamp) would fix this
  properly but was judged too large a change for a single report metric in this pass — relabeled instead
  (`linkedToStyleSamples`/"Linked to a Style") to accurately claim what the data can actually measure,
  rather than fabricating a precision it doesn't support. Deferred: adding the real timestamp column as a
  follow-up.
- **Invalid `status` filter values caused a raw 500** instead of a clean 400, on 7 reports (Journal
  Register, Leave Register, Sales Invoice Register, Dispatch Register, Production Schedule, Order Register,
  Sample Register) — `status: filters.status as never` went straight into a Prisma `where` clause with no
  validation. Fixed with a shared `validateStatusFilter()` (`src/modules/reports/report-filters.ts`)
  checking against the real Prisma-generated runtime enum object before querying. Verified live: an invalid
  status now returns a clean 400 naming every valid value.
- **QC Defect quantities had no validation against their own inspection's totals** — a real DB row was
  found with a defect quantity of 500 attached to an inspection that was a clean PASS (inspected=200,
  accepted=200, rejected=0, damaged=0), corrupting Defect-wise Analysis reporting. Added two Zod
  refinements: defects can't be attached to a PASS result at all, and total defect quantity can't exceed
  rejected + damaged. Verified live: the exact real-world scenario now returns a clean 400.
- **RBAC: client-rendered list pages had no server-side permission gate of their own** — a user with zero
  permission on a module still got 200 and saw the full page shell (title, description, a live "New X"
  button linking to a reachable create form); only the underlying data fetch 403'd client-side, so no real
  data leaked and no mutation succeeded, but module existence and a dead-end form were exposed. The same gap
  class the 2026-08-24 P1 pass fixed for 8 Server-Component detail/edit pages, never swept across client
  list pages. Confirmed via search: ~50 of this app's 119 dashboard pages share this pattern — too large a
  blast radius to fix blindly in one pass with per-file verification. Fixed the three highest-sensitivity
  pages the QA finding specifically named (Journals, Payments, Expenses — all financial data) as a
  demonstrated, individually-verified pattern (split each `page.tsx` into a Server Component permission-gate
  wrapper + a sibling `*ListClient.tsx`); verified live that an unauthorized role now gets a clean 404 on
  all three (was 200 with a visible page shell), and Super Admin's own access is unaffected. **The
  remaining ~47 pages are a known, scoped limitation** — see Known Limitations below.

**P3 — 4 found, 4 fixed:**
- BOM's "two applies-to-every-color lines" conflict was hitting the "all-colors + specific-color" error
  message even when no specific-color line was involved — the save was already correctly rejected, just for
  the wrong stated reason. Split into two distinct messages naming the actual conflict; regression test
  added.
- Supplier Outstanding (both the Suppliers-category and Payables-category variants) carried
  `purchaseInvoiceId` on every row but never wired a drill-down link, unlike every comparable
  outstanding/aging report — added `linkTo`/`linkBuilders` to both.
- Carton Summary / Color-Size Packing subtitles now explicitly note they include cartons from cancelled
  dispatches (packing genuinely happened), unlike Customer-wise Dispatch's shipped-only scope — the two
  totals disagreeing is by design, now stated rather than left for a reader to puzzle out.
- Operator-wise Production's subtitle now explains its totals are legitimately lower than Production
  Register/Achievement (a different source — logged progress entries only, missing quantity that arrived
  via Forward/QC-accept with no progress-entry row of its own).

### Confirmed NOT bugs (investigated, no fix needed)

- **Journal Register's per-journal totals summed live from `JournalLine` rows rather than reading
  `Journal.totalDebit`/`totalCredit`** — a QA agent flagged this as disagreeing with a never-posted
  CANCELLED journal's header (which stays 0/0, "written only at post time"). Investigated the code's own
  comment before touching anything: this is a **deliberate, correct design** — `Journal.totalDebit`/
  `totalCredit` are genuinely only frozen at post time, so a DRAFT journal's real, currently-entered amounts
  would show as a misleading 0/0 if this report trusted the header instead. The apparent "disagreement" the
  agent found was between this report and the *raw API* payload of a never-posted journal — but the actual
  Journal *detail page* (the real UI surface) was already fixed in an earlier pass to also sum from lines
  for display, so no user-visible inconsistency actually exists. Applying the agent's own suggested fix
  (read the header) would have reintroduced the exact bug this design already prevents. No code change.
- **Report export universally 403 for every role including Super Admin** — independently re-verified via an
  isolated curl session with a freshly-authenticated Super Admin cookie: export worked correctly (200, real
  CSV data). The reporting agent's own error was `"Sign in required"` (unauthenticated, not a permission
  denial), consistent with this session's pervasive shared-browser session contention. False positive, no
  fix needed.
- A transient, non-reproduced Super Admin 403 on `sales_orders.edit` (one agent, self-healed on retry, never
  recurred) — flagged as likely the same session-contention class, not pursued without a reproduction.

### New tests

18 new tests across `job-order.service.test.ts` (+2), `production.schema.test.ts` (+3), `bom.service.test.ts`
(+1), `excel.test.ts` (new file, +2), `money.test.ts` (new file, +4). Full suite: 508 → 519 tests, 45 → 47
files.

### Permission changes

- Sales Order confirm route now accepts `sales_orders.edit` OR `sales_orders.approve` (was `edit`-only) —
  intentional widening to make the existing Management-override design actually reachable by the role it
  was built for; the real approval gating is unchanged (still self-approval-guarded, still only triggers
  when an unapproved sample is actually linked).
- Journals/Payments/Expenses list pages gained a real server-side `PermissionService.assert(...,
  "view").catch(() => notFound())` gate (previously relied on the API 403ing alone) — a narrowing, not a
  widening: no role gained access to anything it didn't already effectively have via the API.

### Performance / database integrity

No N+1 queries, missing indexes, or database integrity issues (orphaned FKs, invalid references, negative
stock) were found by any of the 9 QA agents this pass — the inventory-focused agent specifically hand-summed
the stock ledger against Stock Balance for 8 product/warehouse combinations, before and after 14 new test
transactions, with zero drift found anywhere; Negative Stock Report stayed empty throughout. No performance
or integrity fixes were needed this pass.

### Known limitations (explicitly scoped, not oversights)

- **~47 more client list pages share the same missing-server-side-permission-gate pattern** as the 3 fixed
  this pass (Journals/Payments/Expenses). Not a live security issue today (the underlying API/data stay
  protected either way) — a UI-polish/defense-in-depth gap. The fix pattern is now proven and ready to
  replicate; recommend a dedicated follow-up sweep rather than a rushed pass across 47 files with no
  per-file verification time.
- **Sample Conversion Report's "Linked to a Style" metric still can't distinguish** a genuine Convert-to-
  Style graduation from a sample created directly against a pre-existing style — the relabeling this pass
  made the report honest about what it measures, but a real `convertedToStyleAt` timestamp column (schema
  migration) would be needed to actually separate the two, if that distinction is ever needed.
- **`VIEWER` role sees every module's financials and the full user roster** (P&L, Balance Sheet, General
  Ledger, Trial Balance, `/api/v1/administration/users`) — confirmed this is the literal, deliberately-coded
  `rbac.ts` config (`Object.fromEntries(MODULES.map(...))`, `view` on everything), not an accidental bypass,
  and VIEWER never gets create/edit/delete/approve/export anywhere. Flagged, not changed — this is a
  business-policy question (is VIEWER a company-wide read-only auditor, or should it be restricted?), not a
  code bug, and this project's own constraints explicitly say not to change business rules without evidence
  from the existing implementation.
- Two dead-code-only artifacts from Phase 10 test-account creation (2 real Payments left POSTED against a
  real invoice by the RBAC-testing agent, raising its `paidAmount` by ₹7 — no reversal path exists for a
  POSTED payment by design; 12 `qa-*@test.local` test users, all SUSPENDED, no delete-user endpoint exists
  to remove them) — flagged for awareness, not auto-reversed, since both are legitimately-processed
  transactions/records, not bugs.

### Final verification

`npx tsc --noEmit` clean · `npm run lint` clean · `npm test` 519/519 (47 files) · `npx next build` clean
(same route count as baseline, no new build warnings) — all re-confirmed after every commit in this pass, not
just once at the end. 10 commits, each scoped to one logical fix with its own regression test where
applicable.

## Custom Invoice module (standalone, order-independent) + Expense-module gap-fill (2026-08-27)

User posted screenshots of a reference project's ("EQ Business OS", `D:\office-data\claude-projects\hrms`)
Invoice Management and Accountant Dashboard/Expense screens and asked for a gap comparison, then to build
what was missing. Two separate builds landed this session, both under `Accounts`, both reusing this
project's established journal/RBAC/CF-5-idempotency patterns rather than inventing new ones.

**Custom Invoice** (`src/modules/accounts/custom-invoice*.ts`, `/accounts/custom-invoices`) — a standalone
invoice type independent of a Sales Order (unlike the existing order-linked Sales Invoice), for ad hoc
billing. Ships with its own numbering series (`InvoiceSeries` master, `/accounts/finance-config` → "Invoice
Series" tab), Payments (`CustomInvoicePayment` — receipt against an invoice's balance, capped at
`grandTotal - creditedAmount - paidAmount`), and Credit Notes (`CustomInvoiceCreditNote`, 3 types: overall
discount, product-wise, product-return — new `DocumentType.CUSTOM_INVOICE_CREDIT_NOTE` prefix `CN`), plus a
per-customer running-balance Client Ledger (`/accounts/custom-invoices/client-ledger`). **Edit guard closes a
real gap**: `updateCustomInvoice()` blocks editing once *any* credit note exists against the invoice —
including a cancelled one, since a cancelled `CustomInvoiceCreditNoteItem` row still FK-references the
original invoice item and a full item-replace-on-edit would 500 on that constraint. 19 new tests
(`custom-invoice-payment.service.test.ts`, `custom-invoice-credit-note.service.test.ts`).

**Expense-module gap-fill** — after a 4-item gap analysis against the reference Accountant Dashboard, user
answered "and all" (build every item, not just the recommended two):
- **TDS on Expense** — `Expense.tdsPercentage`/`tdsAmount`, computed on the base `amount` (not the
  GST-inclusive total, matching the reference tool's own live calc). `postExpense()` resolves a new `TDS-PAY`
  control account and adds a `Cr TDS Payable` journal line when TDS applies, reducing the final `Cr
  Cash-or-Bank` line by the TDS amount instead of the full total.
- **Internal Transfer** (`src/modules/accounts/internal-transfer.*`, `/accounts/internal-transfers`) — moving
  money between the Cash and Bank control accounts (this Chart of Accounts has exactly one control account
  per `PaymentType.type`, not per physical account — so a transfer between two same-typed payment types is
  rejected as a no-op `Dr X / Cr X`). DRAFT → POSTED (self-approval-guarded via `accounts`/`post`, Dr
  toAccount / Cr fromAccount) → immutable; cancel only from DRAFT. New `DocumentType.INTERNAL_TRANSFER`
  (prefix `TRF`). 6 new tests.
- **Employee Advance + Settlement** (`src/modules/accounts/employee-advance.*`, `/accounts/employee-advances`)
  — an advance issued to an employee (DRAFT → ISSUED, Dr new `EMP-ADV` control account / Cr Cash-or-Bank),
  settled via one or more `EmployeeAdvanceSettlement` child rows against a real expense account (Dr expense
  [+ Dr GST-ITC] / Cr `EMP-ADV`), each guarded to never exceed what's still unsettled
  (`amount - settledAmount`, `AMOUNT_EPSILON` tolerance matching every other remaining-balance cap in this
  project). The parent advance's status is recomputed (never hand-set) to `PARTIALLY_SETTLED`/`SETTLED` after
  every settlement post via a guarded accumulator increment on `settledAmount`. New `DocumentType`s
  `EMPLOYEE_ADVANCE` (prefix `ADV`)/`EMPLOYEE_ADVANCE_SETTLEMENT` (prefix `ADVS`). Both `EMP-ADV` and
  `TDS-PAY` were added as new `isSystemAccount: true` Chart of Accounts control rows. 15 new tests.
- **On Account Payment** (extends the existing `Payment`/`PaymentAllocation` model, no new table) — a
  Receipt/Payment can now be recorded with zero allocations at creation (`allocations` schema field relaxed
  from `.min(1)` to `.default([])`) and posted for its full amount against Cash/Bank ⇄ AR/AP, exactly as
  before. A new `allocatePayment()` applies an already-POSTED payment's *unallocated remainder* against real
  outstanding invoices later, as bills arrive — capped at what's actually unallocated on the payment (not
  just what the target invoice can still absorb), and **deliberately creates no new Journal**: the cash
  movement already happened in full at the original post time: applying an allocation later is bookkeeping
  reassignment, not a new financial transaction. UI: `PaymentForm.tsx` gained an "On Account" checkbox;
  `PaymentWorkflowPanel.tsx` shows an amber "Unallocated: ₹X" banner with an Allocate action once a payment
  has a real unallocated remainder. 8 new/changed tests (including a dedicated regression proving no
  Journal is created on allocation).

**Environment gap found and fixed while verifying live, unrelated to the feature code**: this dev database
was missing the entire `expenses` module's `Permission` catalog (0 rows) — every role including SUPER_ADMIN
got `403 PERMISSION_DENIED` on any Expense/Employee-Advance action — and 4 of the standard seeded Chart of
Accounts rows (`RETAINED-EARN`, `EXP-RENT`, `EXP-SALARY`, `EXP-UTIL`). Matches the exact "dev DB missing a
module's permission catalog rows" gap already hit and fixed twice before for `marketing`/`hrms_*` and
`expenses`/`dispatch` (see the Phase-10 QA section above) — backfilled both via the same idempotent,
additive-only one-off-script pattern (`createMany`+`skipDuplicates`/`upsert`, re-running exactly `seed.ts`'s
own permission-catalog and Chart-of-Accounts literals), then a full dev-server restart to clear
`PermissionService`'s in-process cache. Not a defect in the new code — a pre-existing gap in this particular
dev DB's seed history that this session's live verification happened to be the first to exercise those
specific code paths against.

**Verified live end-to-end** through direct `fetch()` calls against the real dev DB (browser
`form_input`-on-`<select>` reliability issues from earlier sessions made this the established fallback):
Internal Transfer created→posted (`TRF-2026-00001`, confirmed Dr BANK/Cr CASH ₹5000) →
cancel-blocked-once-posted (`409`); Employee Advance created→issued (`ADV-2026-00001`, confirmed Dr
EMP-ADV/Cr CASH ₹8000) → two settlements (`ADVS-2026-00001`/`00002`) posted, confirmed each journal's exact
lines and the parent advance's status correctly recomputing `DRAFT`→`PARTIALLY_SETTLED`→`SETTLED`, confirmed
a further settlement attempt and a cancel attempt on the now-`SETTLED` advance both correctly `409`; On
Account Payment created with zero allocations (`PAY-2026-00003`, ₹10,000) → posted, confirmed a single Dr
CASH/Cr AR journal for the full amount with zero allocation rows → created and posted a real Sales Invoice
(`INV-2026-00002`, ₹3,750) against a separate confirmed order → allocated ₹3,750 of the on-account payment
against it, confirmed the invoice flipped to `PAID` and the total journal count was unchanged (no new
Journal created) → confirmed a further allocation attempt against the now-fully-paid invoice correctly
rejected. `npx tsc --noEmit`, `npm run lint`, `npm test` (735/735, 66 new), and `npm run build` all clean
throughout.

## Purchase Invoice — direct/party bills with no Purchase Order (2026-08-27)

User asked how to record an expense/bill for a "party" (supplier) — the existing Purchase Invoice always
required a linked Purchase Order, so a genuine vendor bill with no goods behind it (freight, consulting,
rent, any service bill from a supplier) had no home that created a real Accounts Payable liability. Expense
(with its optional `supplierId` tag) covers the "pay it immediately, no real payable" case; this closes the
other half — a bill that should sit as a real, trackable payable and be settled later via Payment, exactly
like a PO-backed Purchase Invoice already is.

**Design: extend Purchase Invoice, don't build a parallel document** — evaluated against a standalone
"Vendor Bill" module (mirroring Custom Invoice's own standalone-AR pattern) and rejected: a parallel model
would need its own three-way `PaymentAllocation` FK (breaking the clean two-nullable-FK CHECK constraint
`(sales_invoice_id IS NOT NULL) != (purchase_invoice_id IS NOT NULL)` the moment a NULL FK stops being
sufficient) and its own Supplier Outstanding/Aging reporting. Extending Purchase Invoice instead means every
one of those already gets a standalone bill for free, with zero new code.

**Schema**: `PurchaseInvoice.purchaseOrderId` is now nullable (null = no backing PO at all — `supplierId`
becomes a real, directly-supplied input in that case rather than derived from the order).
`PurchaseInvoiceItem.purchaseOrderItemId`/`productId` are now nullable, and two new nullable columns —
`description` (what a direct line is for) and `expenseAccountId` (which GL account to debit for it) — are
added. **Every line is discriminated per-line, not per-header** — an invoice can mix a PO-linked line with a
direct one on the same document (e.g. goods received against a PO plus an ad hoc freight charge), enforced
by a hand-added CHECK constraint (`purchase_invoice_items_exactly_one_source_check`), the same
two-nullable-field-XOR shape already proven by `payment_allocations_exactly_one_invoice_check`.

**Reused, not duplicated**: `assertValidExpenseAccount()` (the COGS-exclusion + active-check logic) had been
copy-pasted verbatim into both `expense.service.ts` and `employee-advance.service.ts` earlier this session —
extracted into a single exported function in `chart-of-account.service.ts` before this third copy was
needed, and both existing call sites switched to import it. `findOutstandingBySupplier()` (Payment's own
allocation-picker query, keyed only on `companyId`/`supplierId`/`status`) needed zero changes to pick up a
standalone bill — confirmed live, not just by inspection.

**Posting logic**: `postPurchaseInvoice()` now builds one Dr line per distinct debit target — a single
`Dr COGS` line for the sum of all PO-linked lines (derived as `invoice.subtotalAmount − directLinesTotal`,
not re-summed from raw quantity×price, matching this function's original "trust the stored, already-rounded
total" precedent and avoiding a second source of rounding drift), plus one `Dr <account>` line per distinct
`expenseAccountId` among the direct lines — then the usual `Dr GST-ITC` (if any tax) and `Cr AP` for the
total. The over-invoice guard (`guardedIncrementInvoiced`) only ever runs for PO-linked lines; direct lines
have no such cap. A direct line's chosen account is re-validated active at post time (mirroring Expense's
own re-check), since it could have been deactivated between drafting and posting.

**UI**: `PurchaseInvoiceForm.tsx` gained an "Against Purchase Order" / "Direct Bill (No PO)" toggle — PO mode
keeps the existing order-items table and now also shows an "Additional Direct Lines" section underneath for
mixed use; Direct mode swaps the PO picker for a Supplier picker and relabels the section "Bill Lines".
`PurchaseInvoiceWorkflowPanel.tsx` renders the Purchase Order field as "Direct Bill (no PO)" when absent, and
the items table's "Style" column generalized to "Item", showing either the linked product or
`description (code — account name)` per line.

**A real, unrelated bug found and fixed while live-verifying this feature**: paying off the new standalone
bill via `PAYMENT_OUT` + an allocation at Payment-creation time 500'd with a raw Prisma
`PrismaClientValidationError`. Root cause, entirely pre-existing in this session's earlier "On Account
Payment" work (not caused by this feature): `ValidatedAllocation` carries an `invoiceTotalAmount` field used
only by `applyAllocationInTx()`'s own in-memory over-payment guard — not a real `PaymentAllocation` column —
and `createPayment()` was passing the full `ValidatedAllocation[]` straight into
`PaymentRepository.createWithAllocations()` instead of whitelisting it down first, the way `allocatePayment()`
already correctly did inline. `postPayment()`'s own allocation loop was never affected (it re-derives
`invoiceTotalAmount` fresh from the fetched invoice relation, never trusting a stored value). This is exactly
the kind of bug TypeScript's structural typing can't catch — passing a variable with *extra* properties
where a narrower type is expected skips the excess-property check that only applies to object literals — so
it passed `tsc --noEmit` clean and was only ever going to surface via a real Prisma call. It had gone
undetected because every existing `createPayment` allocation test asserted with `toMatchObject` (which
tolerates extra keys) rather than `toEqual`; a new regression test using `toEqual` was added specifically to
close that gap, plus the one-line fix in `createPayment()` itself.

**Verified live end-to-end** through direct `fetch()` calls: created a standalone direct bill
(`PINV-2026-00001`, XYZ Textile, "Freight for August shipment" against `EXP-UTIL`, ₹4,500, due date correctly
+30 days from the supplier's own `paymentTermsDays`) → posted, confirmed `Dr EXP-UTIL 4500 / Cr AP 4500` →
confirmed it appeared automatically in Payment's own outstanding-invoices picker with zero code changes
needed there → paid it off via a real `PAYMENT_OUT` Payment with an allocation at creation time (the exact
path that surfaced the bug above), confirmed `POSTED`/`PAID`; separately created a mixed invoice
(`PINV-2026-00002`, PO `PO-2026-00002`'s Cotton Fabric line ₹1,000 + a direct Freight line ₹250) → posted,
confirmed `Dr COGS 1000 / Dr EXP-UTIL 250 / Cr AP 1250` in one journal and that only the PO-linked line
incremented `PurchaseOrderItem.invoicedQuantity` (to exactly 10, matching what was received); confirmed the
UI toggle correctly swaps between PO/Supplier pickers and relabels the lines section. `npx tsc --noEmit`,
`npm run lint`, `npm test` (741/741, 6 new), and `npm run build` all clean throughout.

## Expense Approval Workflow — Admin approves, Accountant pays; Imprest gets bill attachments (2026-08-27)

User described a specific Expense workflow (in their own words) and pointed at a reference project
(`D:\office-data\claude-projects\hrms`) as having the same logic already working: whoever has expense-create
rights creates an expense with an optional bill upload → it shows up for an Admin to approve/reject → an
Accountant separately pays it (with its own optional bill upload) → in some cases the bill comes in only
after payment → and separately, an "Imprest" wallet-style flow where a user draws money and freely uploads
small bills against it over time. Investigated the reference project in depth via a dedicated Explore agent
before building anything (see the session transcript for the full 7-section findings — exact file/line
citations for `ExpenseTransaction`'s status machine, `ExpenseReceipt`'s dual-purpose linked/freestanding
shape, and the `User.walletBalance` float-column "wallet").

**Key finding that shaped the design**: the reference app's "wallet" isn't a real ledger at all — it's a
plain `Float` column on `User`, incremented/decremented by ad-hoc code scattered across the controller, with
no debit/credit pairing anywhere. Given three AskUserQuestion confirmations with the user (two-step
Approve→Pay replaces the old one-click flow; a Rejected expense is terminal, not reversible by Admin — a
deliberate deviation from the reference; and Employee Advance + Settlement, already built earlier this
session, IS the Imprest concept and just needed bill-attachment support added), the actual gap to close
turned out to be much smaller than a full reference port — and the one thing NOT to copy was the reference's
non-ledger wallet-balance mutation, which would have contradicted this project's own foundational "always a
real journal entry, never ad-hoc balance arithmetic" discipline.

**Schema**: `Expense.status` moved from the shared 3-state `ExpenseStatus` (DRAFT/POSTED/CANCELLED — still
used as-is by `EmployeeAdvanceSettlement`, deliberately NOT repurposed) to a new, Expense-only
`ExpenseApprovalStatus`: `PENDING_APPROVAL` (created, editable) → `APPROVED`/`REJECTED` (Admin decision, no
cash movement) → from `APPROVED` only, `PAID` (Accountant pays — the exact same Dr Expense[+GST-ITC]/Cr
TDS-Payable/Cr Cash-Bank journal this model already built, just now reachable only post-approval). New
`approvedAt`/`approvedByUserId`/`rejectedAt`/`rejectedByUserId`/`rejectionReason` columns.
`postedAt`/`postedByUserId`/`journalId` were kept as-is (still accurate — "posted" now specifically means
"paid"), not renamed, to minimize schema churn. Existing dev-DB rows would map `DRAFT→PENDING_APPROVAL`,
`POSTED→PAID` via a `USING` cast in the migration (none existed live in this pass, but the mapping is real
and defensive for any environment that does have data). New `RelatedModule.EMPLOYEE_ADVANCE_SETTLEMENT`
value — the first real consumer, giving Employee Advance Settlement its own bill-attachment capability via
the existing, unchanged `AttachmentService`.

**RBAC — two verbs cleanly split, zero new modules/actions needed**: `approve`/`reject` (Admin's decision,
no cash movement) and `post` (Accountant's pay step) were both already valid catalog actions, just not both
granted on `expenses` yet. `MANAGEMENT` gained `reject` (already had `approve`) — Management does the
Admin decision, never pays. `ACCOUNTS_MANAGER` gained `reject` and `post` (already had `approve`) — a senior
Accounts Manager can act as either Admin or Accountant. `ACCOUNTS_EXECUTIVE` unchanged
(`view/create/edit` only — junior role, can't approve or pay, matches every other module's identical
scoping). Both new actions are independently self-approval-guarded (`approve` and `post` are both in
`SELF_APPROVAL_GUARDED_ACTIONS`) — a creator can't approve their own expense, and separately can't pay it
either, unless SUPER_ADMIN. `rejectExpense()` is deliberately NOT self-guarded, matching Sampling's own
decision-route precedent (only the Approve branch carries that guard).

**Reporting fix, found and fixed while auditing for the schema change's blast radius, not a pre-existing
bug report**: `dashboard.reports.ts`'s "Expenses This Month"/"Expenses Today" and
`receivables-payables-expenses.reports.ts`'s "Expense Register" totals both filtered `status: { not:
CANCELLED }` — correct under the old 2-real-state model, but now would silently inflate "total expense cost"
with PENDING_APPROVAL/APPROVED/REJECTED amounts that were never actually paid. Fixed to `status: "PAID"` for
the dashboard aggregates; the Register's own rows still show every non-cancelled status (the established
"full audit trail" convention already used by Sales Invoice Register/PO Register), but its totals footer
now sums PAID rows only — the identical "rows show everything, totals exclude the non-realized ones" fix
already applied to those two registers during the Phase 10 QA pass.

**UI**: `ExpenseWorkflowPanel.tsx` rebuilt for 5 states — Approve/Reject buttons (Reject opens a `Modal`
requiring a reason) while `PENDING_APPROVAL`, a single Pay button while `APPROVED`, Cancel available from
either pre-payment state, a red rejection-reason banner once `REJECTED`, and separate "Approved By"/"Paid
By" fields. Attachments section unchanged (already status-agnostic — a bill can attach at creation, after
approval, or after payment, satisfying the user's "kisi case me create ke time pr, kisi case me pay hone ke
baad" requirement with zero code changes needed there). `EmployeeAdvanceWorkflowPanel.tsx` gained a compact
per-settlement "Bill" button opening a small attachments modal (upload/list/preview/delete), reusing
`FilePreviewModal` — the one real gap the reference comparison found in the already-built Imprest equivalent.

**Verified live end-to-end** via direct `fetch()` calls against the real dev DB: created `EXP-2026-00001` →
confirmed `PENDING_APPROVAL` → Approved (confirmed `journalId: null`, no cash movement) → Paid (confirmed
`Dr EXP-RENT 5000 / Cr CASH 5000`, journal `JRN-2026-00012`); separately created `EXP-2026-00002`, confirmed
Reject without a reason `400`s, Reject with a reason succeeds and stores it, a second reject attempt on the
now-terminal record correctly `409`s; created and Approved `EXP-2026-00003`, confirmed Cancel succeeds from
`APPROVED`, then confirmed cancelling the already-`PAID` `EXP-2026-00001` correctly `409`s; confirmed the
Executive Dashboard's "Expenses This Month" correctly shows exactly ₹5,000 (only the Paid one, excluding the
₹1,000 Rejected and ₹750 Cancelled), and the Expense Register lists both non-cancelled rows but totals only
the Paid one; on the Imprest/Employee-Advance side, issued a ₹3,000 advance, added a ₹150 settlement,
uploaded a real PDF bill against it (confirmed byte-for-byte download), posted the settlement, and confirmed
the parent advance correctly recomputed to `PARTIALLY_SETTLED` (₹150/₹3,000) — the exact "user 10000 liya or
bil 100, 200 ka bill upload karte jao" loop the user described. `npx tsc --noEmit`, `npm run lint`, `npm
test` (748/748, 7 new), and `npm run build` all clean throughout.

## Masters navigation gap + department-wise Designation (2026-08-27)

Two small, related master-data fixes on branch `fix_master_issue`.

**Departments master had no navigation entry**: `/masters/departments` was a fully-working page (real
`departments` table, complete CRUD service with duplicate-code check and audit logging, already wired as a
real FK dropdown in both `EmployeeForm.tsx` and `MaterialRequestForm.tsx`) — but the `Masters` index page's
`MASTER_SECTIONS` card list never linked to it, so there was no way to navigate there from the UI at all.
Confirmed by comparing every directory under `src/app/(dashboard)/masters/` against the index list — this
was the only one missing. Added the missing card.

**Designation is now department-wise**: `Designation` previously had no relationship to `Department` at
all — a single flat, company-wide list. Added a nullable `Designation.departmentId` FK (nullable, not
required — a designation can belong to one department, e.g. "Cutting Master" under Cutting, or none at all,
e.g. "General Manager", usable across every department). `HR Configuration → Designations` tab gained a
Department `select` field (reusing `SimpleLookupManager`'s existing `optionsUrl` mechanism — the exact same
pattern already proven by Machine's Production Line dropdown, zero new UI infrastructure needed).
`EmployeeForm.tsx`'s own Designation dropdown now filters to the selected Department's own designations plus
every department-agnostic one; changing Department clears an out-of-scope Designation selection rather than
silently keeping a stale cross-department pick (the same fix already applied once to Sales Order's own
Style-scoped Sample picker). Verified live via direct API + a `nativeInputValueSetter`-based script (the
sandboxed browser's native `<select>` interaction is unreliable for both `form_input` and OS-level dropdown
clicks — confirmed this doesn't reflect a real bug: with no department picked, only department-agnostic
designations show; selecting "Cutting" correctly reveals a Cutting-only test designation while a
Sewing-only one stays hidden) — caught and fixed a genuinely misleading hint-text label in the same pass
(it claimed "showing every department" when the actual, correct behavior only shows department-agnostic
ones until a department is picked).

**Found and fixed in passing, not part of the original ask**: `hr-config.schema.ts`'s `isActive` field had
`.default(true)` on all 4 entities (Designation, Employee Category, Shift, Holiday) — the exact same P3-class
bug already fixed once this project for Color/Size/UnitOfMeasure: `SimpleLookupManager`'s ordinary "Edit"
form never sends `isActive` (only the dedicated toggle does), so every routine edit was silently reactivating
an already-deactivated record. Fixed identically across all 4: `isActive` is now `.optional()` with no
default; create defaults to `true` when omitted; update preserves the existing value when omitted, applies
an explicit value when supplied (the toggle's own flow). New `hr-config.service.test.ts` (13 tests) covers
both the department-FK validation and the isActive-preserve regression for all 4 entities — this module had
no test coverage before.

Migration `20260827130000_add_designation_department` (non-destructive, nullable FK). `npx tsc --noEmit`,
`npm run lint`, `npm test` (761/761, 13 new), and `npm run build` all clean throughout.

## Platform admin company switcher + per-role Production Stage access (2026-08-27/29)

Two related access-control features, both prompted by direct user questions about who can see what.

**Platform admin company switcher (2026-08-27)** — closes the gap flagged right after multi-company
creation landed (see the FIX_MASTER_TESTING merge above): a platform admin could provision new companies
but had no way to actually get into one they didn't sign up under.
- New `CompanySwitcher` in the Sidebar (platform-admin only) — a `<select>` of every company, switching via
  NextAuth's session `update()` trigger, which re-scopes `token.companyId` (kept distinct from a new,
  immutable `token.homeCompanyId`, stamped once at sign-in). Every service/route already derives
  `actor.companyId` from `session.user.companyId`, so this alone changes which company's data is visible
  everywhere in the app — zero changes needed to any of the ~285 existing routes.
- `PermissionService.can()` grants a platform admin full access (including the self-approval bypass) to
  whichever company is currently active, re-verified live from the DB on every call (`loadLiveUserState`
  is deliberately uncached) — never trusted from the JWT alone, same discipline `status`/`passwordChangedAt`
  already use. Company-scoping itself is still enforced entirely at the service/repository layer, never by
  this class — this bypass is exactly what makes "switch active company" grant real access rather than just
  relabeling the sidebar.
- "Back to my own company" shortcut appears whenever `companyId !== homeCompanyId`.
- Verified live end-to-end: created a second real tenant ("Zenith Textiles Co.") through the actual
  `/platform/companies/new` form, switched into it from the sidebar with **zero** `UserBranchRole` grant in
  that company, confirmed full read+write access there (created and deleted a real Customer via the API),
  confirmed the customer list correctly showed Zenith's own empty data (not the home company's real
  customers), then switched back and confirmed real data returned and the "back to my own company" link
  correctly disappeared.

**Per-role Production Stage access (2026-08-29)** — user asked whether different floor roles (Cutting
Master, Stitching Master, Supervisor, Admin) each see only their own work, so one role's team can't see or
touch another's. Investigated `src/config/rbac.ts` first rather than assuming: found exactly one generic
`PRODUCTION_SUPERVISOR` role for the entire floor — RBAC in this app is module-level (can you touch
`production` at all), with zero concept of restricting a role to specific `ProductionStage`(s). Separately
confirmed (and had to explain) that custom Role creation + full module/action permission assignment
**already existed** (`/admin/roles`, built by another contributor, not something this pass added) — so
"Cutting Supervisor" as a distinct role was already possible; what was missing was restricting any role
(new or seeded) to only the stage(s) it should act on.
- **New `RoleProductionStageAccess` join table** (`roleId` × `productionStageId`, migration
  `20260829090000_add_role_production_stage_access`) — a Role with **zero rows is unrestricted** (sees
  every stage), the default for every pre-existing role including the seeded `PRODUCTION_SUPERVISOR`/
  `PRODUCTION_MANAGER` — no backfill needed, matches this project's own `SampleVersion.isCostingLocked`-style
  "additive, opt-in restriction" precedent.
- **`PermissionService.getAllowedProductionStageIds(userId)`** — returns `null` (unrestricted) or a `Set` of
  allowed stage ids. A platform admin always gets `null`. A user's roles are **unioned with "unrestricted
  wins"** semantics: if ANY held role has zero restriction rows, that role's unrestricted status wins
  outright — holding one additional narrow role (e.g. a single-stage QC checkpoint) must never silently
  shrink what an otherwise-unrestricted Production Manager can already see. Only when *every* held role is
  individually restricted does the result become the union of their allowed stages. A user holding no role
  at all gets an empty `Set` (sees nothing), matching that they'd already fail every ordinary permission
  check too.
- **Write-side enforcement**: a new `assertStageAccess(actor, productionStageId)` guard in
  `job-order.service.ts` (exported for reuse), called at the top of `startLot`, `assignWorker`,
  `recordProgressEntry`, `recordAdjustmentEntry`, `forwardJobOrder`, `revertJobOrder`, `recordQcInspection`,
  and `job-work-order.service.ts`'s `createJobWorkOrder` — every action that mutates a specific stage's Job
  Order. `forwardJobOrder`/`revertJobOrder` are guarded on the **source** stage only — a supervisor moving
  completed work along to the next stage doesn't need access to that next stage themselves, matching how a
  real factory floor hands off work. New `BusinessRuleError` code `PRODUCTION_STAGE_ACCESS_DENIED` (403).
  Lot split/merge were deliberately left unguarded — already gated behind the higher-privilege
  `production.approve` action, and stage-restricting a lot-level restructure action wasn't part of the
  concrete ask (Assign/Log Progress/Forward/Revert/QC/Job-Work).
- **Read-side filtering**: `getLotById()` (now takes a `userId` third param) drops any `jobOrder` sitting at
  a stage outside the viewer's allowed set from the response entirely — a restricted "Cutting Supervisor"
  role doesn't see Stitching's job orders/action buttons on a lot's own detail page any more than they can
  act on them. The Lot record itself always renders (a lot spans every stage over its life; hiding the whole
  record would hide the viewer's own stage's work too whenever another stage also has an open job order).
- **RBAC UI**: new `RoleProductionStageAccessPanel` on `/admin/roles/[id]`, alongside the existing
  permission-matrix editor — a plain checkbox list of the company's active stages, explicit copy stating
  "select nothing to leave this role unrestricted." **Deliberately allowed on system roles too** (unlike
  `updateRolePermissions`, which blocks editing a seeded role's module/action grants) — stage restriction is
  a purely additive/narrowing dimension that can never widen what a role can do, only which stage(s) it can
  do it on; blocking it on the seeded `PRODUCTION_SUPERVISOR` would force every company wanting a
  stage-scoped "Cutting Supervisor" to first clone a brand-new custom role for no safety benefit. New
  `GET`/`PUT /api/v1/administration/roles/[id]/production-stages`.
- **Verified live end-to-end** against the real dev DB: created a real "Cutting Supervisor" role (granted
  `production.view/create/edit`), restricted it to the Cutting stage only via the real API, created a real
  test user holding that role, logged in as them — confirmed `GET /api/v1/lots/:id` on a lot with both a
  Cutting and a Stitching job order returned **only** the Cutting one (both via the raw API and the actual
  rendered Lot detail page, zero console/server errors beyond the expected 403s from this narrowly-scoped
  role's other missing permissions); confirmed a direct `POST` to assign a worker on the hidden Stitching job
  order correctly `403 PRODUCTION_STAGE_ACCESS_DENIED`; confirmed the identical call against the Cutting job
  order passed the stage guard (failed on the next, unrelated validation instead — proving the guard is
  stage-specific, not a blanket block); switched back to the unrestricted Super Admin and confirmed both job
  orders render again, unaffected. Test user suspended afterward (no delete-user endpoint exists, matching
  this project's own established precedent); the "Cutting Supervisor" role itself was kept as a real,
  working demonstration.
- 14 new tests (`PermissionService.test.ts` +5, `role-admin.service.test.ts`, new file, +7, plus mock updates
  to `job-order.service.test.ts`/`job-work-order.service.test.ts`). 790/790 project-wide, `npx tsc --noEmit`
  and `npx eslint` clean throughout.
- **Not built this pass** (explicitly out of scope per the concrete ask): stage-restricting Lot split/merge,
  per-line/station kiosk login (a different, larger idea from this file's own original Domain Reference
  section — still just a "consider" note, not built), and any UI surfacing of a *rejected* stage-access
  attempt beyond the raw 403 (e.g. hiding the Assign/Forward/QC buttons client-side when a stage is
  disallowed — today they're absent because the job order itself is filtered out of the list, which already
  covers the real UI surfaces; a future pass could add a friendlier inline message if a stale client ever
  tries anyway).

## Sidebar navigation now reflects real per-role permissions; Reset Password modal ignores backdrop clicks (2026-08-29)

Two small, unrelated UX fixes from direct user reports, both live-verified with the same "Cutting Supervisor"
test role/user built for the Production Stage access pass above.

**Sidebar permission gating** — user reported that after logging in as a restricted role, the app "wasn't
behaving per its permissions — only what it has permission for should show." Investigated and confirmed: the
Sidebar rendered every nav section/link to every logged-in user unconditionally — only the "Platform" section
was ever gated (by `isPlatformAdmin`). A role holding only `dashboard`+`production` still saw CRM, Masters,
Accounts, Administration, everything — clicking through any of them either 403'd or showed a broken/empty
page, since the underlying API routes were correctly protected the whole time; only the *nav itself* was
unfiltered.
- `src/components/layout/navigation.ts`'s `NavSection`/`NavLeaf` now each declare a real `modules: Module[]`
  — the RBAC module(s) that gate that link's visibility (shown if the viewer holds `view` on ANY one of
  them). A parent section survives if it's directly visible OR at least one child is (e.g. "Manufacturing"
  still shows for a `production`-only role, just with the `bom_mrp`-gated "BOM / MRP" leaf hidden).
- New `PermissionService.getViewableModules(userId): Promise<Set<Module> | "all">` — `"all"` for a platform
  admin (mirrors `can()`'s own bypass), otherwise the real Set of modules the user holds `view` on, computed
  from the same cached permission-key lookup `can()` already uses (one query, not one per module).
- Computed server-side in `DashboardLayout` (a Server Component, alongside the pre-existing `isPlatformAdmin`
  resolution) and passed to `Sidebar` as a plain `Module[] | "all"` — deliberately not a `Set`, to sidestep
  any question about Set-serialization across the RSC boundary (this codebase already has one documented
  Decimal/Date serialization gotcha; a plain array avoids adding a second class of the same risk). `Sidebar`
  passes it straight into the new `filterNavSections()` helper, which builds the `Set` internally.
- **Verified live end-to-end**: logged in as the real "Cutting Supervisor Test" user (only `dashboard`+
  `production` granted) — sidebar showed exactly "Dashboard" and "Manufacturing," with "BOM / MRP" correctly
  absent from Manufacturing's own children, zero console errors (a real improvement over the Production
  Stage access pass's own verification, which still saw expected-but-noisy 403s from the previously-unfiltered
  nav). Logged back in as Super Admin and confirmed the full, unfiltered nav still renders — no regression
  for unrestricted roles. 9 new tests (`navigation.test.ts`, new file; `PermissionService.test.ts` +4).
- **Gotcha hit during this verification, not a defect**: the test login kept failing with a genuine
  `CredentialsSignin` error despite using the exact password set at user-creation time earlier in the
  Production Stage access pass — `bcrypt.compare()` confirmed via a direct script that the stored hash
  genuinely didn't match that string (root cause not chased further, since a dev-only test account). Fixed
  by using the existing admin `reset-password` endpoint to set a fresh password, which worked immediately —
  worth remembering that a `CredentialsSignin` error on an account created earlier in the same long session
  is worth a direct bcrypt-compare sanity check before assuming the surrounding feature code is at fault.

**Reset Password modal — backdrop click no longer closes it** — separate user report: clicking outside the
Reset Password modal (`/admin` → Users → Reset Password) closed it, discarding a freshly-typed password. The
shared `Modal` component's ✕ button, Escape key, and backdrop click all call the same `onClose` — correct
for every other modal in the app, but backdrop-click-to-close is a real footgun specifically for a modal
whose entire content is one just-typed, not-yet-submitted value. Added an optional `closeOnBackdropClick`
prop (default `true`, unchanged for every other modal in the app) and set it `false` only on the Reset
Password modal — ✕ and Escape still close it, only the accidental-outside-click shortcut is disabled.
Verified live: backdrop click no longer closes the dialog; the ✕ button still does.

802/802 tests (9 new), `npx tsc --noEmit` and `npx eslint` clean throughout both fixes.

## Dashboard is now role-aware — Platform Overview / My Team / Company views (2026-08-29)

User asked for `/dashboard` to differ by who's logged in: an Admin sees their own company, a platform-level
Super Admin sees an overall/cross-company view, and a Supervisor sees data scoped to their own employees —
today it was one flat, identical set of 5 company-wide counts for every role. Investigated first: confirmed
`page.tsx` had zero role branching at all, and that `Employee.reportsToId` (a self-referencing manager→
direct-reports FK, existing since Phase 3) was the one ready-made mechanism a "my team" view could be built
on — nothing else needed inventing.

**New `src/modules/dashboard/dashboard.service.ts`** — a single `getDashboardViewForUser({ userId,
companyId, isPlatformAdmin })` entry point returns a tagged union (`{ kind: "platform" | "team" | "company",
... }`), decided by real signals, not a hardcoded role-name check:
1. **`isPlatformAdmin`** → the new `getPlatformDashboard()` — the one deliberate place in this app that
   queries with **no** `companyId` filter: sums Companies/Customers/Suppliers/Employees/Users across every
   active company, plus a per-company breakdown table. Scoped intentionally small (a provisioning/oversight
   tool, not a second reporting suite — that already exists per-company under `/reports`).
2. **Else, does this user's own linked Employee (`User.employeeId`) have ≥1 direct report** (`Employee`
   rows where `reportsToId` equals theirs)? → `getTeamDashboard()` — Team Size, Present Today (via
   `AttendanceRecord`), Active Job Orders (via `JobOrderAssignment.employeeId`, one level deep — direct
   reports only, not their reports' reports, matching what a line manager actually means by "my team"),
   Pending Leave Requests (via `LeaveRequest`) — all filtered to just the direct-report employee ids.
3. **Else** → the pre-existing 5-tile company-wide view, unchanged — covers Company Admin, MANAGEMENT, and
   any individual contributor with no reports of their own.
- Reused this project's own hard-won UTC-day-boundary lesson (`utcDayBoundaries()`, `Date.UTC(...)`, never
  `new Date(y,m,d)`) for "Present Today," the exact bug class already found and fixed twice before
  (Executive Dashboard, Daily Attendance) — avoided a third recurrence by design, not by luck.
- `page.tsx` is now a thin presentational switch over the three `DashboardView` shapes, sharing one
  `StatTiles` tile-grid component across all three.
- **Verified live against real data, not fixtures**: Super Admin (also `isPlatformAdmin`) correctly saw
  "Platform Overview" — 2 companies, summed totals, and an accurate per-company table (15/11/10/4 for
  Indradhar, 0/0/0/1 for the still-empty Zenith Textiles Co. demo tenant from the platform-admin pass
  above). Set a real Employee ("Suresh Patil") to report to another ("Ramesh Kumar") via the actual
  `PATCH /api/v1/employees/:id` endpoint, linked a fresh test User to Ramesh Kumar's Employee record, logged
  in as them — dashboard correctly showed "My Team" (Team Size: 1, the other three stats correctly 0 with
  no real attendance/job-order/leave data yet for that employee). Confirmed a company-scoped user with no
  direct reports still gets the ordinary company view. Test employee relationship and test user reverted/
  suspended afterward.
- 9 new tests (`dashboard.service.test.ts`, new file) covering all three branches plus the platform-aggregate
  summing logic and the zero-reports early-out. 811/811 project-wide, `npx tsc --noEmit` and `npx eslint`
  clean throughout.
- **Not built this pass**: a configurable/deeper team hierarchy (e.g. "my team + their teams" — deliberately
  one level, matching a line manager's literal direct reports), and any drill-down from the Platform Overview
  table into a given company's own dashboard (the existing Company Switcher already covers "go look at that
  company directly").

## Supplier ↔ Material catalog — which suppliers can supply which raw materials (2026-08-31)

User asked how "one supplier sells many different raw materials" is modeled — investigated first: confirmed
`Product.defaultSupplierId` already lets many materials share one default supplier, but there was no way to
see or edit the *reverse* view (which materials a given Supplier supplies) from the Supplier's own page, and
no way for a material to have more than one eligible supplier at all. Built a real many-to-many catalog on
top of, not instead of, the existing single-FK field, confirmed via AskUserQuestion before implementation.

- **New `SupplierMaterial` join table** (migration `20260829110000_add_supplier_materials`) — deliberately
  separate from `Product.defaultSupplierId`: the default-supplier field stays exactly what it was (a single
  pointer used only to auto-suggest a supplier when generating a PO from a Material Request shortfall);
  this table represents the fuller real-world fact that a material routinely has several genuine eligible
  suppliers (three different suppliers all selling the same Cotton Fabric is the ordinary case). Neither
  table writes to the other.
- **New `src/modules/suppliers/supplier-material.{repository,service}.ts`** — `listSuppliedMaterials`,
  `addSuppliedMaterial`/`removeSuppliedMaterial` (single), and `addSuppliedMaterials` (bulk, see below).
  Every mutation re-validates the Supplier and each Material genuinely belong to `actor.companyId` and that
  the Material is a real `RAW_MATERIAL` — the same `findMaterialById` tenant-scoping check every other
  material cross-reference in this codebase (BOM, PO, Material Request) already uses.
- **UX pivot mid-build**: the first version reused the existing single-select `MaterialPicker` (search →
  pick one → click Add), matching how every other "pick a material" field in this app works. Live user
  feedback ("aaise add karna bahut complicated hai") correctly flagged that repeating a single-pick cycle
  once per material is genuinely tedious for a supplier that legitimately supplies dozens of materials —
  rebuilt as a **multi-select checklist** (search-filtered, category-grouped, matching `MaterialPicker`'s own
  grouping logic) with one "Add Selected (N)" button. New `POST .../materials/bulk` endpoint
  (`addSuppliedMaterials`) takes `materialIds: string[]`, deduplicates them, validates the whole batch
  belongs to the company before writing anything, and inserts via `createMany({ skipDuplicates: true })` —
  forgiving by design, since a user re-checking an already-linked material from the list shouldn't block the
  rest of their selection. One audit-log entry for the whole batch, not one per material (matches this
  project's "one row per logical action" convention for bulk operations elsewhere, e.g. Purchase Request's
  `approveAllLines`).
- **UI**: new `SuppliedMaterialsSection.tsx` on the Supplier edit page (`/masters/suppliers/[id]`) — a linked-
  materials list with an inline "Remove" per row, plus the search/checklist/Add-Selected control underneath.
  Added as a second keyed sibling next to `SupplierForm` on that page, so both correctly needed distinguishing
  `key={`form-${id}`}`/`key={`materials-${id}`}` prefixes — the exact multi-keyed-sibling rule this project
  already documented once (Phase 4, Sampling) for the identical "second sibling needing `key={id}` on the
  same page" shape.
- **Verified live end-to-end** through the real UI and API together: added 2 materials one at a time via the
  original single-picker version (confirmed the category label and "Remove" both render correctly, confirmed
  a direct duplicate-add attempt correctly `409`s); removed one via Remove; then, after the UX rebuild,
  multi-selected 3 materials across 3 different categories (Fabric/Zips/Packaging) and added them all with
  one "Add Selected (3)" click — confirmed all 3 appeared, correctly dropped out of the "available to add"
  checklist, and the checklist/selection state reset; removed all 3 to leave the demo supplier clean. 826/826
  tests (14 new), `npx tsc --noEmit` and `npx eslint` clean throughout both the initial build and the
  mid-build UX revision.

**Extension, same day — broad category-level linkage** (`SupplierMaterialCategory`, migration
`20260831070000_add_supplier_material_categories`): a direct follow-up request — "if a supplier deals in
Fabric and Trims generally, I shouldn't have to keep picking specific materials one by one every time a new
one is added, since the Supplier record is only created once." A coarser sibling table, not a replacement:
ticking a category (e.g. Fabric) treats the supplier as eligible for *every* material in it, including ones
added to the catalog later, with zero further edits to that Supplier record ever needed for that category
again. Uses the same 7-value `MATERIAL_CATEGORIES` list `Product.materialCategory` itself is validated
against (not the fuller 9-value `MaterialCategory` Prisma enum used by `Supplier.category`) — `SERVICES`/
`MACHINERY` are Supplier-only concepts with no corresponding Product category to ever match against, so
including them here would be meaningless; a unit test asserts the returned list is exactly those 7, no more.
Full-replace-on-save semantics (mirrors `RoleProductionStageAccess`'s own contract exactly, including its
"empty array is a real state, not a no-op" rule) rather than incremental add/remove, since there are only 7
possible values and this is inherently a single small settings block, not a growing list. New `SuppliedCategoriesSection.tsx`
(a third keyed sibling on the Supplier edit page — `key={`categories-${id}`}`), rendered above the specific
"Materials Supplied" list with explicit copy distinguishing the two ("use this when a supplier genuinely
deals across a whole category; use Materials Supplied below for a supplier that only handles a few specific
items"). Verified live end-to-end: ticked Fabric+Trims through the real checkbox UI, confirmed via a direct API GET the exact
`{FABRIC: true, TRIMS: true, everything else: false}` shape, reloaded the page and confirmed both boxes
stayed checked (real persistence, not client-only state), then cleared back to empty and confirmed via API.
8 new tests. **Gotcha hit again, same root cause as every prior instance**: after this migration, the
already-running dev server's stale Prisma client threw the exact `Cannot read properties of undefined
(reading 'findMany')` error on the new `supplierMaterialCategory` delegate until fully restarted — the
n-th recurrence of this project's own most-repeated gotcha, immediately recognized and fixed. Separately,
`npx tsc --noEmit` transiently failed against `.next/dev/types/validator.ts` and then `layout.tsx`'s
generated `LayoutProps` while the dev server was live/mid-restart — resolved definitively by running a full
`npx next build` (which regenerates all Next.js types deterministically in one pass, no concurrent rewrite
race) and confirming it completed with zero errors, rather than continuing to fight the live dev server's
own type-generation timing. 834/834 tests total, `npx tsc --noEmit`/`npx eslint`/`npx next build` all clean.

## Categories consolidated into one Masters page (2026-08-31)

User asked "kitne type ke category hai" (how many category-type masters exist), then explicitly asked for
Garment Category, Supplier Category, and Employee Category — previously scattered across
`/masters/garment-attributes` (as two of its tabs) and `/masters/hr-config` (as one of its tabs) — to live
together in one dedicated "Categories" module instead.

**Pure UI move, zero schema/service/API changes** — every one of the three `SimpleLookupManager` tabs on
the new page reuses its exact existing `fetchUrl` (`/api/v1/categories`, `/api/v1/supplier-categories`,
`/api/v1/employee-categories`) and `fields` shape verbatim, so `Product.categoryId`, `Supplier.categoryId`,
and every other existing FK/consumer of these three masters is completely unaffected.

- New `src/app/(dashboard)/masters/categories/page.tsx` — a 3-tab page (Garment/Supplier/Employee Category)
  matching the established tabbed-`SimpleLookupManager` pattern (`garment-attributes`, `hr-config`,
  `fabric-config`, etc.).
- `src/app/(dashboard)/masters/garment-attributes/page.tsx` — dropped its "Categories" and "Supplier
  Categories" tabs (down to 7: Brands, Seasons, Fittings, Product Types, Designs, Design Patterns,
  Patterns), updated its description to link to the new page.
- `src/app/(dashboard)/masters/hr-config/page.tsx` — dropped its "Employee Categories" tab (down to 3:
  Designations, Shifts, Holidays), same description update.
- `src/app/(dashboard)/masters/page.tsx` — added a "Categories" card to `MASTER_SECTIONS`, trimmed the
  "Garment Attributes"/"HR Configuration" card descriptions to no longer mention category.
- Verified live in the browser: all 3 tabs on the new Categories page render their real existing data
  (9 Garment Categories, 9 Supplier Categories, 6 Employee Categories); the two trimmed pages show exactly
  their remaining tabs with zero dead code (the now-unreachable `{tab === "Employee Categories" && ...}`
  render block was deleted from `hr-config/page.tsx`, since `Tab`'s narrowed union would otherwise make that
  comparison a TypeScript error); the Masters index shows the new card and the two adjusted descriptions;
  zero console errors throughout. `npx tsc --noEmit`, `npx eslint`, and `npx vitest run` (834/834) all clean.

## Supplier's broad-category grant made dynamic; both catalog actions moved into an Actions bar (2026-08-31)

Two follow-up fixes on the Supplier↔Material catalog feature (built earlier the same day, see above), from
direct user feedback on the live UI.

**"Categories Supplied (broad)" is now sourced from the real Supplier Category master, not a fixed enum
list.** `SupplierMaterialCategory` originally stored a `MaterialCategory` enum value (copy-pasted from
`Product.materialCategory`'s own 7-value list) — but `Supplier.categoryId` had *already* been cut over to a
real, dynamic, per-company `SupplierCategory` master table earlier (2026-08-27, see that model's own schema
comment), and the user correctly pointed out the broad-category checklist should track that same master —
growing/shrinking with it — rather than a second, disconnected fixed list.
- Migration `20260831130000_supplier_material_category_dynamic`: `SupplierMaterialCategory.materialCategory`
  (enum) → `supplierCategoryId` (real FK to `SupplierCategory.id`). Hand-authored (not the naive
  `migrate diff` output, which would have dropped the column and added a `NOT NULL` FK with no backfill) to
  preserve the one real row that existed (a `FABRIC` grant on a live demo supplier) by matching the old
  enum's string value against the master's own `code` column — confirmed live via direct SQL that the row
  survived the migration with its `supplier_category_id` correctly pointing at the `FABRIC` master row, no
  data loss.
- `listSuppliedCategories()`/`updateSuppliedCategories()` (`supplier-material.service.ts`) now read/write
  through `GarmentAttributeRepository.supplierCategory` (the master) instead of the `MATERIAL_CATEGORIES`
  Zod list. An already-granted category stays visible even if later deactivated (so it can still be seen/
  removed); only *new* grants are limited to currently-active master rows. Unknown/cross-company category
  ids are rejected with `NOT_FOUND`, matching `addSuppliedMaterials`' own precedent for the identical shape
  of check, rather than the old `VALIDATION_ERROR` (which fit a fixed enum-membership check better than a
  real-row-existence check).
- API body field renamed `categories` → `supplierCategoryIds` (now real UUIDs, not enum strings) on
  `PUT /api/v1/suppliers/:id/material-categories`.
- `SuppliedMaterialsSection.tsx`'s own material-category **grouping** (unrelated — that's each raw
  material's own `Product.materialCategory`, used only to organize the "Add Material" checklist) was
  deliberately left untouched; only the Supplier's own broad-grant list changed.

**Both catalog actions moved twice in the same session, settling on the Suppliers list page's own row
actions.** First moved from the always-visible edit page into an "Actions" bar in that same edit page's
header — user then corrected this directly: they wanted these between the existing per-row **Edit** link
and the **Active/Inactive toggle** on the Suppliers **list** page (`/masters/suppliers`), not on the edit
page at all.
- `DataTable.tsx` (the shared list component used by ~12 masters) gained a new optional
  `rowActions?: (row: T) => ReactNode` prop, rendered between the built-in Edit link and the toggle, wrapped
  in a `div` with its own `onClick={(e) => e.stopPropagation()}` so a click inside it never triggers the
  row's own click-to-navigate handler — the same guard the Edit link already had individually. Generic and
  opt-in: every other module's list using `DataTable` is completely unaffected (prop simply absent).
- `SuppliedCategoriesSection.tsx`/`SuppliedMaterialsSection.tsx` were rewritten to **self-fetch on open**
  instead of taking `initialCategories`/`initialMaterials` props — a list row has no per-row detail fetch to
  piggyback on the way the edit page's Server Component did, and eagerly fetching this for every visible row
  up front would be an unnecessary N+1 read for rows the user never opens. Trigger buttons shrank to compact
  table-row sizing and dropped their `(N)` count badges (no longer free to compute without a fetch, and not
  worth one extra read just to show it) — plain "Categories" / "Materials" labels instead.
- `[id]/page.tsx` (the edit page) reverted to exactly its pre-feature form — no Actions bar, no supplied-
  materials/categories fetch at all; that data now belongs solely to the list page's row actions.
- `src/app/(dashboard)/masters/suppliers/page.tsx` passes `rowActions={(row) => <>...</>}` rendering both
  components per row with `supplierId={row.id}`.
- Verified live end-to-end: reloaded `/masters/suppliers` and confirmed every row shows
  "Edit · Categories · Materials · [toggle]" in that exact order; clicked "Categories" on XYZ Textile's row
  — modal opened without navigating the row, self-fetched, and showed Fabric correctly pre-checked; clicked
  "Materials" on the same row — modal opened, showed "Loading…" then "No materials linked yet" with the
  grouped Add-Material checklist; clicked elsewhere on the row afterward and confirmed normal row-click
  navigation to the Edit page still works, now rendering a clean form with no Actions bar at all; zero
  console errors throughout. `npx tsc --noEmit`, `npx eslint`, and `npx vitest run` (836/836, 2 new) all
  clean throughout both placement passes.

**Categories Supplied's UI rewritten a third time to match Materials Supplied's own search+list shape.**
User's explicit ask: give Categories the same linked-list/search/checklist UX Materials already had, instead
of the earlier flat "toggle any pill, then a single Save Categories button" design. `SuppliedCategoriesSection.tsx`
now mirrors `SuppliedMaterialsSection.tsx` structurally: a linked-categories list (each row with its own
immediate "Remove"), then a bordered search box + scrollable checklist of not-yet-granted categories, with
an "Add Selected (N)" footer button. **No new backend endpoint** — both Add and Remove submit through the
same existing full-replace `PUT /material-categories` route, just computing the new full set locally first
(`[...currently-granted ids, ...newly-checked ids]` for Add; `currently-granted ids minus the removed one`
for Remove) — the separate "Save Categories" step is gone entirely, every action is now immediate, same as
Materials. Verified live: searched "zip" (correctly narrowed to just "Zips"), added it (appeared instantly
in the linked list alongside the pre-existing "Fabric," disappeared from the available checklist), removed
it again (back to just "Fabric," the original demo state) — zero console errors. `npx tsc --noEmit`,
`npx eslint`, and `npx vitest run` (836/836) all clean.

## Warehouse Locations moved inline into Create/Edit (reversing the separate-modal pattern) (2026-09-02)

Direct user reversal of part of the just-shipped Warehouse List→Actions→Modal standard: instead of a
separate "Locations" action opening its own modal, Location management now lives directly inside the same
Create/Edit modal as the Warehouse's own fields — confirmed via AskUserQuestion ("Save warehouse first, same
modal then shows Locations").

- **`ChildrenList.tsx`** (new) — extracted from `ManageChildrenModal.tsx`'s own list/add/edit/deactivate
  content, with no outer `<Modal>` of its own, so it can be embedded directly inside another already-open
  modal. `ManageChildrenModal.tsx` is now a thin wrapper (`Modal` + `ChildrenList`) — kept available for any
  future module that still wants the "separate action opens its own modal" shape; Warehouse itself no longer
  uses it.
- **Create is a two-phase single modal**: Phase 1 is just `WarehouseForm`; on save, the same modal switches
  to a "`<name>` created — add its storage locations" view showing `ChildrenList` for Locations, closed via
  Done. Create has no id to scope a locations list to until the warehouse is actually saved, so this
  two-phase shape (rather than a second, separate modal) was the explicit, reviewed answer to that.
- **Edit shows both together**: `WarehouseForm` fields stacked above a "Storage Locations" `ChildrenList`
  divider, in the same already-open modal. Saving the fields deliberately does **not** close the modal (a
  "Saved." message shows instead) — Locations are right below, so a field save shouldn't kick the user out
  before they're done managing those too; closing is explicit, via Cancel/Done or the Modal's own
  X/Escape/outside-click.
- **New gotcha variant found during verification, not a code defect**: a brand-new 4-level-deep nested
  dynamic route (`warehouses/[id]/locations/[locationId]/status/route.ts`) 404'd with Next's own HTML 404
  page (not a JSON business-logic 404) even after a full dev-server restart — the fix that has resolved
  every prior instance of this project's stale-Turbopack-cache gotcha family. Confirmed the route file
  itself was correct (right exports, no typos in the folder names) and that the exact same nesting depth
  works elsewhere (`goods-receipts/[id]/items/[itemId]/reverse`) — so this wasn't a Next.js routing
  limitation either. Resolved only by fully deleting `.next` (not just restarting the server) before
  restarting — worth remembering as a step up from the usual fix: **a brand-new deeply-nested dynamic route
  may need a full `.next` wipe, not just a dev-server restart, before Turbopack's route discovery picks it
  up.**
- Verified live end-to-end through the real UI (not just direct API calls, once the routing gotcha above was
  resolved): New Warehouse → fill fields → Save → same modal switched to the Locations view → Add Location
  (Code/Zone/Rack/Bin/Material Category) → appeared in the list → Done → list refreshed showing the new
  warehouse row; Edit → fields + Locations rendered together → edited the Name and Saved (modal stayed open,
  "Saved." shown, DB confirmed updated) → edited the location's Rack (confirmed persisted) → toggled it
  Inactive via the real switch (ConfirmModal → Deactivate → toggle flipped, DB confirmed `isActive: false`)
  → Done closed the modal. Test warehouse deactivated afterward (soft, matching this project's own
  soft-delete convention — no hard delete exists for Warehouse). `npx tsc --noEmit`, `npx eslint`, `npx
  vitest run` (850/850), and `npx next build` all clean throughout.

## Warehouse Create now stages Storage Locations inline; Type becomes multi-select (2026-09-02)

Two more direct follow-ups on the same day: Create's own "add Storage Locations here" ask turned out to
mean simultaneous, not two-phase — matching Edit's layout exactly, not gated behind an initial save — and a
real schema change: a warehouse can now be tagged with more than one `WarehouseType` (a physical warehouse
routinely stores more than one material kind in different rooms/sections, the same real gap the per-Location
`materialCategory` tagging above was a partial answer to — this makes the warehouse-level signal multi-value
too, not a replacement for that Location-level tagging).

- **Schema**: `Warehouse.type` — `WarehouseType` (single) → `WarehouseType[]` (migration
  `20260902130000_warehouse_type_multi_select`, hand-authored add-column/backfill/drop/rename/drop-default
  since Prisma's own migrate tooling can't run non-interactively in this shell). Every existing row's
  original value was preserved as a one-element array, verified via a direct query, not trusted from
  `migrate resolve --applied` alone. `updateWarehouse()` needed `data.type = { set: input.type }` — Prisma's
  scalar-list replace-in-full shape — not a bare array assignment.
- **Create is now single-phase, matching Edit exactly**: the two-phase "save fields, then the same modal
  reveals Locations" design from the same day's earlier entry is gone — Create shows `WarehouseForm` fields
  and a "Storage Locations" list together from the very start, submitted as one request. Since a Location
  needs a real `warehouseId` FK that doesn't exist until the warehouse is saved, Locations are staged
  client-side (new `LocalChildrenList.tsx` — `ChildrenList`'s sibling for a parent with no id yet: same
  table/Add/Edit shape, Remove instead of a deactivate-with-confirm since undoing a staged, unsaved row is
  trivial) and submitted together with the warehouse's own fields via a new `WarehouseForm` `extraFields`
  prop merged into the POST body. `createWarehouse()` creates both in one nested Prisma write
  (`locations: { createMany: { data } }` inside the same `warehouse.create()` call — atomic by construction,
  no manual `$transaction` needed), rejects duplicate codes within the staged batch before writing anything,
  and — after the nested create — refetches the created locations to write one audit-log `CREATE` entry per
  location, matching `createWarehouseLocation()`'s own granular audit trail exactly rather than leaving the
  batch path under-logged. `ChildFormModal.tsx` gained an optional `onSubmitLocal` callback (skips the
  network call entirely, hands the built payload straight to the caller) so `LocalChildrenList` could reuse
  it as-is instead of forking a second Add/Edit form implementation.
- **Type is a checkbox multi-select**, not a native `<select multiple>` — `WarehouseForm.tsx`'s own
  established visual language, same as the Supplier broad-category checklist elsewhere in this app. Zod:
  `z.array(z.enum(WAREHOUSE_TYPES)).min(1)`; the Save button is also disabled client-side at zero selections
  as a cheap UX nicety on top of the real server-side check.
- Both Warehouse reports (`warehouse.reports.ts` — Stock Summary, Register) and the Warehouses master list
  updated to render the array as a formatted joined string (`"RAW MATERIAL, FABRIC, TRIMS"`), matching the
  exact label-formatting convention already used for the single-value case.
- New `warehouse.service.test.ts` (5 tests, first coverage for this module) — justified same as every other
  test added this project only when real branching/calculation logic exists, not for simple CRUD: the
  duplicate-code-in-batch rejection, the nested-create shape, the per-location audit-log count, and the
  `type: { set: [...] }` update shape.
- **Same `.next`-cache gotcha as the same day's earlier entry, hit again mid-session**: a plain dev-server
  restart wasn't enough after this schema/route work either — a full `.next` wipe before restarting was
  needed before the new behavior was reliably picked up.
- Verified live end-to-end through the real UI: created `WH-MULTI-01` with 3 types checked (Raw Material +
  Fabric + Trims) and 2 staged locations (ROOM-FABRIC, ROOM-TRIMS) added via the same modal before ever
  saving — one Save produced exactly one warehouse row, both location rows, and 3 audit-log `CREATE` entries
  (1 warehouse + 2 locations) at the same instant, confirmed via a direct DB query; the master list rendered
  `"RAW MATERIAL, FABRIC, TRIMS"` correctly; the Edit modal opened on the same warehouse and pre-checked
  exactly those 3 type checkboxes with both locations already listed; both Warehouse reports rendered the
  same joined-type formatting correctly. Test warehouse deactivated afterward (soft, matching this project's
  convention — no hard delete exists for Warehouse). `npx tsc --noEmit`, `npx eslint`, `npx vitest run`
  (855/855, 5 new), and `npx next build` all clean throughout.

## Submodule Visibility — Super Admin can hide unused Fabric Configuration sub-masters (2026-09-03, branch `fix-03-sep-2026`)

User asked whether a Super Admin could hide/show any Masters module, submodule, or field per company, then gave
a concrete example: only GSM and Composition are needed under Masters → Fabric Configuration — Dye, Weave
Type, and Width should hide, and once a submodule already has real data its visibility must lock permanently.
Confirmed via AskUserQuestion: hiding must apply everywhere the field is used (not just the masters tab), and
the mechanism should be generic so other tabbed masters (Garment Attributes' 8 tabs, HR Config's 4) can be
onboarded later. Designed via 3 parallel Explore agents (fabric-config/admin page structure; the 3 consumer
forms' exact field wiring; BusinessRuleError/Company/migration/RBAC conventions) + a Plan-agent critique before
implementation.

- **Schema**: new `SubmoduleVisibility` (`companyId`, `submoduleKey`, `isVisible`, `@@unique([companyId,
  submoduleKey])`) — a missing row means "visible" (the default), so no backfill is needed and no schema
  change is needed when a future submodule key is registered.
- **Locking is derived at read time, never stored, and "locked" always wins** — the critique caught a real
  TOCTOU race in a naive "check row-count, then upsert" write path (two unrelated tables, no shared
  constraint: a concurrent "first real GSM row created" + "admin hides GSM" pair could both succeed). Fixed
  by making `getSubmoduleVisibilityMap()`'s read-side derivation force `isVisible = true` whenever the
  submodule is locked, regardless of what's stored — self-healing against the race, not just relying on
  `setSubmoduleVisibility()`'s own pre-check (kept anyway, for a clean `SUBMODULE_LOCKED` (409) message).
  "Has data" is a generic per-key existence-check registry (`submodule-data-checks.ts`, `findFirst` not
  `count()`) — the one place a future submodule needs a one-line addition. An 8s in-memory per-company cache
  avoids re-running N existence checks on every page load across a growing registry and 4+ consumer forms,
  invalidated immediately on write — this is a cached *display* preference, not persisted business state, so
  it doesn't conflict with this project's "never trust a stored derived flag" discipline (Sampling Hold/
  Resume, Purchasing cancel-from-ON_HOLD).
- **Client-safe config registry** (`src/config/submodule-registry.ts`, zero Prisma imports) lists `{label,
  group}` per key — onboarding a future tabbed-masters group means adding entries here plus one existence-
  check function, nothing else in the mechanism changes.
- **API**: `GET /api/v1/submodule-visibility` (no module gate, matches `/api/v1/branches`'s "cross-cutting
  lookup" convention — every user filling Goods Receipt/Sampling/Material Request needs this regardless of
  their `administration` grant) and `PATCH /api/v1/submodule-visibility/[key]` gated
  `administration`/`"create"` — deliberately `"create"`, not `"edit"`, since `admin/page.tsx`'s existing
  `canManage` boolean (passed to every admin panel) is itself computed via `"create"`; using the same tuple
  keeps the UI's enabled/disabled toggle state and the API's real gate from silently drifting apart if these
  two actions are ever split for different roles later.
- **Admin UI**: new "Module Visibility" tab in `AdminTabs.tsx` → `AdminModuleVisibilityPanel.tsx`, grouped by
  `SUBMODULE_REGISTRY[key].group`, each row a `ToggleSwitch` + amber "Locked — has existing data" caption,
  wrapped in the existing `ConfirmModal` — matching the app-wide "every toggle confirms" precedent
  (`SimpleLookupManager`/`DataTable`'s own Active/Inactive toggles) rather than silently deviating from it.
- **Consumer hook** (`src/lib/use-submodule-visibility.ts`) fails open by design (unknown key or a still-
  loading/failed fetch defaults to visible) — a stated, deliberate decision: visibility here is a UI
  decluttering feature, not a server-enforced rule, since none of the 3 write endpoints (Goods Receipt/
  Sampling/Material Request) validate against it; the FK columns are already nullable.
- **Wiring, with a guardrail — wrap only the editable input, never a read-only display**:
  `FabricConfigClient.tsx` filters its 5 tabs (derived via `manualTab && visibleTabs.includes(manualTab) ?
  manualTab : visibleTabs[0]`, no effect needed); `GoodsReceiptForm.tsx`'s "Add Roll" sub-form conditionally
  renders each of its 5 `<select>`s (the Width select's shared flex-div with the ✕ remove-roll button stays
  unconditional); `SampleWorkflowPanel.tsx`'s and `MaterialRequestForm.tsx`'s "Add Material"/"Add Line" Dye
  `<FormField>` are each conditional — their own separate read-only Dye-column displays are untouched, so an
  already-recorded value keeps showing even if Dye is later hidden for new entries.
- **Verified live**: on the main tenant (all 5 submodules already have real data from years of prior
  sessions' testing), the API and the real Admin UI both correctly show all 5 as Locked with disabled
  toggles, and a direct hide attempt on Dye correctly `409 SUBMODULE_LOCKED`s; switched into the empty
  "Zenith Textiles Co." demo tenant via the existing Company Switcher, hid Dye/Weave Type/Width through the
  real Admin UI (toggle → `ConfirmModal` → confirm), confirmed Masters → Fabric Configuration correctly
  dropped to exactly `[GSM, Composition]` tabs, then re-showed Dye through the same real UI flow and
  confirmed it reappeared in the tab bar live — proving the full hide/lock/show lifecycle end-to-end, not
  just via direct API calls. Restored Zenith back to fully visible afterward (its original, clean state).
  `npx tsc --noEmit`, `npx eslint`, `npx vitest run` (863/863, 8 new), and `npx next build` all clean.
- **Not built this pass**: onboarding Garment Attributes/HR Config's own tabs onto the registry (the
  mechanism is ready, no consumer added yet), and field-level (as opposed to submodule-level) visibility —
  explicitly discussed and deferred as too risky (fields carry real validation/FK weight) when this was
  first scoped.

## Live search added to every SimpleLookupManager-based master (2026-09-03)

User pointed out that most small lookup masters (Payment Types, Bank Accounts, Colors, Sizes, Fabric
Configuration's 6 tabs, Garment Attributes' 7 tabs, HR Config, Production Config, Cost Master — everything
built on the shared `SimpleLookupManager` component, ~24 entities total) had no search/filter at all, unlike
the `DataTable`-based "rich" masters (Customers/Suppliers/Warehouses/Products), which already have one.

- **`SimpleLookupManager.tsx`** gained a `search` input above the table, filtering the already-fetched
  in-memory `rows` (these lists are capped at `pageSize=200` and fully loaded up front, so this is plain
  client-side filtering on every keystroke — no debounce, no server round-trip needed) against **every
  visible column's on-screen text**, not just Name/Code.
- **Search matches the resolved label for `select`-type fields, not the raw stored id** — extracted the
  existing inline select-label-resolution logic (previously only used by the table body) into a shared
  `displayValueFor(row, columnKey)` helper, reused by both the table cells and the search filter, so
  searching e.g. "Centimeters" on the Width tab correctly matches its resolved Unit label, not the
  underlying UUID. This also closed a small pre-existing inconsistency in passing: the old inline logic only
  fell back to "—" for an empty *select* field, leaving other empty optional fields (e.g. Dye's Pantone)
  blank; the unified helper now applies "—" uniformly, matching this app's established empty-value
  convention elsewhere (`ChildrenList.tsx`'s own `row.zone ?? "—"` pattern).
- Empty state is now two distinct messages — "No records found." (the table is genuinely empty) vs. "No
  records match your search." (rows exist, the current search term just doesn't match any) — so a search
  typo doesn't look identical to a truly empty master.
- **Verified live** on two different masters sharing the one component: Payment Types (search "card" →
  narrowed to exactly the Card row; search "cash" → matched both the real Cash Payment Type and a
  differently-named row purely via its Type value "Cash"; a non-matching term correctly showed "No records
  match your search."; clearing restored all 6 rows) and Fabric Configuration's Width tab (search
  "centimeter" correctly matched via the resolved Unit label, not the raw `unitId`). `npx tsc --noEmit`,
  `npx eslint`, `npx vitest run` (864/864), and `npx next build` all clean.
- **Not touched**: `DataTable`-based masters already have their own server-side search (`searchPlaceholder`
  prop, unrelated component) — this pass was scoped exactly to the `SimpleLookupManager` gap the user
  pointed out, not a broader search-everywhere pass.

## Full-project search/filter audit, then fix the 5 genuine gaps (2026-09-04)

User then asked for filter/search "in every module across the whole project." Rather than guess at scope, 3
parallel Explore agents audited every list page app-wide (Masters/Sales/Sampling/BOM-MRP;
Production/Inventory/Purchasing/Dispatch; Accounts/CRM/Marketing/HRMS/Admin/Reports) before any code was
touched. Result: the app was already well-covered — ~12 `DataTable`-based masters have server-side search,
~24 `SimpleLookupManager` masters just got search (above), Sampling has an elaborate best-in-class filter
panel, and all 9 Accounts lists, CRM, Marketing, HRMS, and the generic Report viewer already have working
search/filter. Confirmed with the user (AskUserQuestion) to fix exactly the 5 **genuinely uncovered** pages
found, not also widen the narrower order-number-only search on 6-7 `DataTable`-based transactional lists
(Purchase Orders, Goods Receipts, Material Requests, Stock Movements, Production Orders, Dispatch) — that
search exists, just doesn't match supplier/customer/status names, and was explicitly left out of scope.

All 5 fixes are pure, local, client-side filtering (`useState` + `.filter()` before `.map()`) — every one of
these lists is small and already fully loaded up front, so no new API params or debouncing were needed:

- **`src/lib/category-tree.ts`** gained `filterCategoryTree()`, a pure recursive helper — keeps a node if
  its own name/code matches OR any descendant matches, so a matched leaf's ancestor path stays visible for
  context rather than being pruned with everything else.
- **`masters/categories/CategoryTreeManager.tsx`** (the "Garment Category" tab — the one masters sub-page
  that wasn't `DataTable` or `SimpleLookupManager`, confirmed via the audit as the only real gap in Masters)
  — added the search input, wired to `filterCategoryTree`; while searching, every node force-expands
  regardless of its own collapsed state, so a match can never hide behind a collapsed ancestor.
- **`admin/AdminUsersPanel.tsx`** — filters by name, email, status, branch name, and every assigned role
  name joined together (matches e.g. "Cutting Supervisor" whether it's in the user's own name or their
  role).
- **`admin/AdminRolesPanel.tsx`** — filters by name and description.
- **`production/approvals/ApprovalsClient.tsx`** (Pending Approvals) — filters by employee name/code, job
  number, stage name, lot number, and remarks; the search box only renders once real entries exist, matching
  the page's own existing empty-state convention.
- **`production/my-work/MyWorkClient.tsx`** (My Work) — one shared search box filtering both of the page's
  sections independently: the "Assigned to Me" cards (job number/stage/lot) and the "My Submitted Entries"
  table (job number/stage/approval-status label).
- Every one of the 5 shows a distinct "no records match your search" message (vs. the page's existing
  "genuinely empty" message), matching the exact convention just established for `SimpleLookupManager`.
- **Verified live** on 3 of the 5 with real data: Categories → Garment Category (searched "skinny" —
  correctly showed only the "Denim → Skinny Fit" branch, correctly pruning the unrelated "Casual Wear" root
  that has no matching descendants; verified via a direct API check that Denim and Casual Wear are in fact
  sibling roots, not parent/child, confirming the pruning logic is exactly right rather than coincidentally
  looking right; also verified code-only search via "cat-fr" → "Formal Wear"), Admin → Users (searched
  "super" — matched 3 users through two different fields, own name and assigned role name), Admin → Roles
  (searched "cutting" — matched via both name and description). Pending Approvals and My Work had no real
  data in this session to exercise live (no pending progress entries; the test account has no linked
  Employee record) — verified by code review instead, reusing the identical, now 3-times-proven filter
  pattern; `npx tsc --noEmit` and `npx eslint` both clean gave high confidence given the strongly-typed row
  interfaces would have caught a field-name mismatch at compile time.
- `npx tsc --noEmit`, `npx eslint`, `npx vitest run` (864/864), and `npx next build` all clean throughout.

## Cost Master gains a Percentage type (2026-09-04)

User asked how to add a percentage-based rate to Cost Master — investigated first: `CostMasterType` only had
`HOURLY`/`MONTHLY`/`PER_UNIT`/`FIXED`, no percentage option existed at all. Confirmed `CostMaster` has no
consumer anywhere else in the codebase (a standalone lookup, matching this file's own earlier note that it
"has zero FK from any transactional table") — so this was purely a matter of adding the option, not wiring
up any calculation.

- Added `PERCENTAGE` to the `CostMasterType` enum (migration `20260904090000_add_cost_master_percentage_type`,
  a plain `ALTER TYPE ... ADD VALUE`) — represents "N% of order value" (e.g. a rate of `5` means 5%), reusing
  the existing `rate` Decimal column as-is; no new column, since the percentage meaning comes entirely from
  the type tag.
- `cost-master.schema.ts`'s Zod enum and `CostMasterClient.tsx`'s Type `<select>` options both updated to
  include "Percentage"; the Rate field's placeholder now hints `"e.g. 5 for 5% if Type is Percentage"` (a
  single shared field across all 4 types, per `SimpleLookupManager`'s static-field-config design — not worth
  extending that shared component for one type-conditional label).
- **Verified live**: created a real "Commission Overhead" cost rate (Type: Percentage, Rate: 5) via a direct
  API call (the sandboxed browser's own `SimpleLookupManager` form submission proved unreliable this
  session, matching this project's own documented tooling-flakiness pattern — verified via the API +
  reloaded UI instead), confirmed it renders correctly as "Commission Overhead / Percentage / 5" in the real
  list, and confirmed the live search box (added earlier this session) correctly matches "percentage" as a
  search term too. Deactivated the test row afterward (soft, matching Cost Master's own no-hard-delete
  convention). `npx tsc --noEmit`, `npx eslint`, and `npx vitest run` (864/864) all clean.

## AI Garment Flow — foundation (2026-09-06)

A new, separate initiative (not one of the 11 phases above): "AI Garment Flow" is a product-development
workflow — reference/fabric upload → AI-assisted design directions → costing → sampling — requested as a new
module inside this same app. The brief was written assuming a Supabase-based stack; a 3-agent audit first
(hard evidence, zero ambiguity: `grep -ri supabase` across the whole repo returns zero hits) confirmed this
codebase has no Supabase anywhere — the real stack (Next.js 16 + Prisma 7/`@prisma/adapter-pg` + plain
PostgreSQL + NextAuth v5 JWT/Credentials + local-disk file storage) was used instead, per the brief's own
"reuse existing architecture" instruction.

**The central architectural decision**: the existing `Product` model (`itemType: STYLE`, wired to
`Brand`/`Category`/`Season`/`ProductFitting`/`ProductType`, with `ProductVariant` color×size) remains the one
true Style Master — **not duplicated**. A new `AiGarmentProject` header is a pre-Style
development/ideation record that starts before any real Style exists and later, deliberately and manually,
**graduates** into a real `Product` via `convertProjectToStyle()` — the exact same shape already proven
twice in this codebase (`BuyerEnquiryLine` → `SampleRequest`, `SampleRequest` → `Product`). Per an explicit
user decision (AskUserQuestion), BOM and Costing steps require this graduation and then deep-link into the
**existing** BOM/MRP module and Sampling's existing costing engine — no parallel BOM/costing schema exists
in this module.

- **Schema** (migration `20260906120000_add_ai_garment_flow`, applied via `prisma migrate deploy` after
  `prisma migrate dev` hit unrelated pre-existing migration-history drift — never ran `migrate reset`, which
  would have dropped all data; every new table/column independently re-verified via a direct Prisma query
  against the live dev DB, not trusted from the migration output alone): `AiGarmentProject`
  (`ai_garment_projects` — `projectNumber` via the existing `generateDocumentNumber()`/`document_sequences`
  engine, prefix `AGF`; `customerId`/`buyerId`/`brandId`/`seasonId`/`categoryId` all reuse existing masters;
  `targetMarket`/`targetCustomerProfile` are deliberately free text — no "Market" master exists anywhere in
  this ERP and inventing one now would be premature; `currentStepKey`/`completedStepKeys` drive wizard
  resumability; `productId`/`sampleRequestId` are both nullable-then-set-once `@unique` FKs, guarded against
  concurrent double-conversion exactly like `BuyerEnquiryLine.sampleRequestId`; `salesOrderId` is a reserved,
  unused-this-phase FK, same "documented reserved value" precedent as `ProductionOrderStatus
  .MATERIAL_ALLOCATED`), `AiGarmentFabricDetail` (1:1 child, reuses the existing `FabricGsm`/`FabricDye`/
  `FabricWeaveType`/`FabricWidth`/`FabricComposition` masters — the exact same masters already wired into
  Purchasing's `FabricRoll` — instead of free-text/Decimal fields), `AiGarmentDesignOption` (design
  candidates for "Generate Variations"/"Select Design", `isSelected` flipped exclusively within one
  transaction, `aiMetadata Json?` unused placeholder for a future real AI response). One new
  `RelatedModule.AI_GARMENT_PROJECT` value — every file upload (reference images, fabric swatches, generated
  designs, technical flats, etc.) attaches at the **project header level**, matching Sampling's own
  established "attachments live on the header, not per-child-row" precedent, disambiguated by `Attachment
  .contextLabel` reused as an asset-type tag rather than its usual workflow-stage-snapshot meaning. One new
  `DocumentType.AI_GARMENT_PROJECT` value (prefix `AGF`).
- **Module** (`src/modules/ai-garment-flow/`) follows the exact file convention already established by
  `src/modules/buyer-enquiries/` (the closest existing precedent — an optional, resumable, later-converting
  workflow header): `schema.ts`/`repository.ts`/`service.ts`/`service.test.ts`. The status enum
  (`AiGarmentProjectStatus`: `IDEA…COMPLETED/REJECTED/ON_HOLD/CANCELLED`) is a coarse milestone tracker
  derived from the workflow step being saved (`nextStatusForStep()`, ordered via `STATUS_ORDER`, never
  regresses when an earlier step is revisited) — decoupled from, not a duplicate of, the real state machines
  Product/SampleRequest/BOM already have. Reuses the proven `statusBeforeHold` Hold/Resume idiom.
  `convertProjectToStyle()` mirrors `convertSampleToStyle()` line-for-line (same style-code uniqueness check,
  same `advanceMasterCodeSequence()` call, same single-shot guarded FK write).
  `createSampleRequestFromProject()` mirrors `convertEnquiryLineToSampleRequest()` — calls the *existing,
  unchanged* `createSampleRequest()` from Sampling, gated on the project already having graduated to a real
  Style and having a real linked Customer.
- **RBAC/nav**: one new `ai_garment_flow` module added to `src/config/rbac.ts`'s `MODULES` (view/create/
  edit/delete/cancel/export/print granted to `MERCHANDISER`, matching its existing full ownership of
  `sampling`/`buyer_enquiries`; view-only to `MANAGEMENT`; `SUPER_ADMIN`/`VIEWER` get it automatically via
  the existing `MODULES.map(...)` mechanism). Since `prisma db seed` isn't safe to re-run against this dev
  DB (documented project-wide gotcha), the new module's `Permission`/`role_permissions` rows were backfilled
  via the same idempotent one-off-script pattern already used for Expenses/Dispatch/marketing/hrms_*. One
  new top-level `NavSection` ("AI Garment Flow") added to `src/components/layout/navigation.ts` — deliberately
  does **not** add new nav entries for Buyers/Orders/Purchase/Production/Inventory/Quality/Dispatch, which
  already have their own sections; the project detail page instead links out to them once the relevant
  linkage exists (e.g. "View Style" once `productId` is set).
- **AI service placeholder**: `src/core/ai/AIService.ts` — a provider-agnostic interface
  (`analyseReference`/`analyseFabric`/`createDevelopmentBrief`/`generateDesigns`/`compareDesigns`/
  `applyFabric`/`createTechnicalFlat`/`generateDraftBOM`/`analyseCost`) plus a `NullAIProvider` default whose
  every method returns `{available: false, message: "AI integration not connected."}` — zero network calls,
  zero fabricated results, per explicit instruction. Kept in `src/core/` (not inside the module) since it's
  framed as reusable across any future AI-driven area, matching this codebase's "cross-cutting concern →
  `src/core/*`" convention.
- **UI** (`src/app/(dashboard)/ai-garment-flow/`): a dashboard (two "Start From Reference"/"Start From
  Fabric" action cards + a Recent Projects table), a full project list, a New Project (Step 1) form, and a
  project detail page (Server Component + one big Client `AiGarmentProjectWorkflowPanel`, the established
  "Server Component page + Client workflow panel" split already used by Sampling/Buyer Enquiry/Sales Orders)
  rendering a progress stepper across all 11 (Reference) / 12 (Fabric) steps driven by `currentStepKey`/
  `completedStepKeys`. AI-driven steps (Reference/Fabric Analysis, Development Brief, Generate Designs,
  Compare Designs, Apply Fabric's AI assist, Create Technical Flat, Generate Draft BOM, Analyse Cost) each
  render their real non-AI parts (forms, file upload, design-option add/select) alongside one inert button
  that shows the literal text "AI integration not connected." on click — no fake AI output is ever generated.
  Technical Development/BOM/Costing show a "Convert to Style" gate until `productId` is set, then deep-link
  into the real `/bom-mrp/[productId]` editor and a "Create Sample Request" action that deep-links into that
  Sample Request's own existing detail page (with Sampling's full costing engine already built there).
- **Two `react-hooks/set-state-in-effect` lint errors hit and fixed**, same rule this project has hit many
  times before: the Buyer-list-reset-on-Customer-clear moved into the `<select>`'s own `onChange` instead of
  an effect branch, and the attachment list's mount-effect was rewritten to inline its own fetch+`.then()`
  chain instead of calling a named `async load()` function from the effect body — both match this project's
  own established fix pattern exactly.
- **Verification**: `npx tsc --noEmit`, `npx eslint .` (both project-wide), and `npx vitest run` (971/971,
  22 new in `ai-garment-project.service.test.ts` covering the Hold/Resume state machine, the
  `convertProjectToStyle()` graduation guard including the lost-race case, and `createSampleRequestFromProject()`'s
  guards) all clean. Every new table/enum/column independently re-verified via a direct query against the
  live dev DB. **Live in-browser verification was not completed this pass** — this session's own dev server
  could not start: another chat session on this same machine already had its own `next dev` running against
  this exact working directory, and Next.js's own single-instance-per-directory lock file blocks a second
  `next dev` regardless of port (confirmed live — a different port was tried first, per the user's own
  choice, and still hit the same lock). Recommended next step: run the existing `erp-tester`/`erp-qa-uat`
  agent-based browser walkthrough once no other session holds the dev server, per the manual test plan
  already laid out in this feature's own plan file.
- **Not built this phase** (explicitly out of scope per the brief's own "build only the foundation... stop
  before Process 1" instruction): any real AI provider integration, real BOM/costing computation inside this
  module (deliberately deferred to the existing BOM/MRP and Sampling-costing modules once a project
  graduates), a dedicated "Designer" role (no role needs one yet; the existing custom-role admin UI can add
  one later with zero schema changes), and a "Market" master table (kept as free text, documented above).

## AI Garment Flow — Process 1: Reference Garment Analysis (2026-09-06)

First real AI process built on the foundation above, inside the existing Start From Reference workflow's
UPLOAD_REFERENCE and REFERENCE_ANALYSIS steps (Process 2, Development Brief, followed directly after — see
its own dated section below). The brief again assumed Supabase; per the same "reuse the existing stack"
instruction as the foundation phase, this uses the real stack (Prisma/Postgres, the existing local-disk `Attachment`/`AttachmentService`,
NextAuth-based company-scoping in place of RLS) — flagged clearly, not silently substituted.

**Real Anthropic integration, not a placeholder**: `@anthropic-ai/sdk` added (pinned to an exact version,
matching this project's own `next-auth`-pinning precedent — a routine `npm ci` should never silently pull an
unreviewed SDK update into a security/business-critical integration). Model names are read from
`ANTHROPIC_DEFAULT_MODEL`/`ANTHROPIC_VISION_MODEL` env vars (`AI_PROVIDER=anthropic` selects the provider) —
confirmed directly against the installed SDK's own `Model` type union that `claude-sonnet-5`/`claude-opus-5`
(the current Claude 5 family) are genuinely valid model identifiers, not guessed from stale training data.

- **`src/core/ai/providers/anthropic.ts`** — the only file that imports `@anthropic-ai/sdk` directly.
  `requestStructuredVisionOutput()` forces a single structured tool call via Anthropic's `tool_choice` +
  `strict: true` (server-side schema enforcement, confirmed from the SDK's own type definitions) rather than
  asking for free-text JSON — far more reliable, and still independently re-validated against the caller's
  own Zod schema before anything is trusted. Retries exactly once with a corrective follow-up on a validation
  failure; never returns a fabricated/partial result on failure, always throws `AiServiceError` (mapped from
  the real SDK error classes — `APIConnectionTimeoutError`/`AuthenticationError`/`RateLimitError`/`APIError`)
  or `AiInvalidResponseError`.
- **`src/core/ai/reference-analysis/`** — `feature-registry.ts` (the 36 individually-tracked observation
  slots — 24 top-level + sleeve's 4 + fabricObservations' 6 + printPattern's 5 sub-keys — each mapped to a
  display label/section/dotted-path, zero Prisma imports so both server and client import the same file, no
  label ever duplicated), `schema.ts` (the Zod schema matching the brief's recommended JSON structure
  exactly, plus `flattenToObservations()` walking the registry to turn one validated response into 36 DB
  rows), `prompt.ts` (the hidden business/system prompt, verbatim from the brief, never shown to end users;
  `PROMPT_VERSION = "reference-analysis-v1"`; `buildToolInputSchema()` built once from the same
  confidence/complexity enum constants the Zod schema uses, so the two can't drift apart), `analyze.ts` (the
  one real entry point — zero database access, "image + context in, validated structured analysis out or a
  thrown error").
- **Schema** (migration `20260906140000_add_ai_garment_reference_analysis`): `AiGarmentProject` gains
  `referenceImageAttachmentId` (soft ref, mirrors `AiGarmentDesignOption.imageAttachmentId`'s existing
  convention) — a single **current** reference image with Replace/Delete semantics, not the foundation
  phase's generic multi-file gallery (that generic upload flow is kept, unchanged, for the Fabric workflow's
  own swatch step). `AiGarmentReferenceAnalysis` (header, 1:1 per project, fully replaced — not versioned/
  append-only like `SampleVersion` — by each successful re-analysis; keeps the complete raw AI JSON for
  audit, but per explicit instruction is never the only usable data structure). `AiGarmentReferenceObservation`
  (36 rows per analysis — `aiObservation`/`aiConfidence`/`aiManufacturingRelevance` never overwritten;
  `approvedObservation` starts equal to `aiObservation` and is the only field a later process ever reads,
  making "bypass the approved analysis and use the uncorrected AI output" structurally impossible, not just
  disallowed by convention). `AiGarmentReferenceAnalysisRun` (append-only audit log of every attempt,
  success or failure — a failed attempt can never overwrite a previously-successful analysis, since it's a
  wholly separate table). New enums `AiGarmentAnalysisConfidence`/`AiGarmentConstructionComplexity`/
  `AiGarmentReferenceAnalysisStatus` (`DRAFT/AI_ANALYSED/UNDER_REVIEW/APPROVED/STALE`)/
  `AiGarmentAnalysisRunStatus`. Two new `BusinessRuleError` codes, `AI_SERVICE_ERROR`/`AI_INVALID_RESPONSE`
  (both 502).
- **STALE status closes a real gap the brief explicitly flagged**: replacing or deleting the reference image
  flips any existing analysis to `STALE` (kept for audit, but every further edit/approve action is blocked
  until a fresh analysis replaces it) — the same "derive real state, never trust a stored label that can
  silently drift" discipline this project has already learned the hard way more than once (Sampling's
  Hold/Resume bug, Purchasing's cancel-from-`ON_HOLD` bug).
- **Approval requiring reapproval on edit**: per the brief's own "if a previously approved analysis is
  edited later, handle the status logically," editing or resetting **any** observation on an `APPROVED`
  analysis pushes it back to `UNDER_REVIEW` — applied uniformly to every field rather than trying to classify
  which edits are "material" (a distinction the brief didn't concretely specify, and easy to get wrong in the
  unsafe direction). `approveReferenceAnalysis()` bulk-stamps both the header and every observation row with
  the same `approvedByUserId`/`approvedAt` in one transaction.
- **Duplicate-request guard, real and server-side, not just a disabled button**: `runReferenceAnalysis()`
  writes an `IN_PROGRESS` run row *before* ever calling the AI, and rejects a new request while one is
  already in progress — a stuck row older than 3 minutes (safely past the provider's own 90s timeout plus one
  retry) is treated as abandoned (e.g. a crashed request) rather than a permanent lock, since this feature has
  no background-job queue to reap it otherwise.
- **API routes** under `/api/v1/ai-garment-projects/`: `[id]/reference-image` (GET/POST/DELETE — the
  brief's own narrower JPG/PNG/WEBP allowlist, layered on top of `FileStorage`'s broader shared allowlist,
  so a PDF is rejected here even though the shared layer would accept it for other modules),
  `[id]/reference-analysis` (GET), `[id]/reference-analysis/run` (POST), `[id]/reference-analysis/approve`
  (POST), `reference-analysis/observations/[observationId]` (PATCH) and `.../reset` (POST).
  `AttachmentService` gained `getAttachmentMetadata()` — a metadata-only read (no file buffer) for the
  uploader's own display needs, alongside the existing `getAttachmentForDownload()`.
- **UI**: `ReferenceImageUploader.tsx` (Screen 2 — single current image, Upload/Preview/Replace/Delete, the
  brief's exact disclaimer text, client-side format/size checks as a fast-feedback courtesy on top of the
  server's own real gate), `ReferenceAnalysisPanel.tsx` (Screen 3 — the "ANALYSE REFERENCE WITH AI" button
  disabled with no image, the "Analysing garment structure and design details…" loading state, every section
  the brief specified — Garment Overview/Design Details/Fabric Observations/Construction/Manufacturing
  Considerations/Design DNA/Missing Information — plus the bottom sortable Feature/Observation/Confidence/
  Manufacturing-Relevance table with inline edit-and-reset-to-AI per observation and the
  "APPROVE ANALYSIS & CONTINUE" control), `ConfidenceBadge.tsx` (symbol + text label together, never relying
  on color alone). `AiGarmentProjectForm.tsx` extended to dual create/edit mode (Screen 1's own "Save / Edit
  / Continue" requirement — previously creation-only) and gained the missing Currency field.
- **Verification**: `npx tsc --noEmit`, `npx eslint .` (both project-wide), and `npx vitest run` (990/990, 40
  new — 18 mocked unit tests for the service layer's guards/error-mapping, plus the existing 22 from the
  foundation phase) all clean. A 22-check script exercised every real (non-mocked) code path against the
  live dev DB and real local file storage — project creation, Screen 1 save, all four upload-rejection cases
  (corrupt/mislabeled, unsupported format, oversized, then a genuinely valid PNG), the missing-credentials
  failure path (the one failure mode fully exercisable for real without a live API key — confirmed the exact
  user-facing message, confirmed the failed attempt is logged as its own audit run row, confirmed a second
  attempt isn't wrongly blocked as "already in progress," confirmed nothing invalid was ever saved as an
  analysis), then a simulated-successful-analysis seed (the exact same 36-row shape a real AI response
  produces) to verify edit/reset/approve/replace-marks-STALE end-to-end against real Postgres. One real bug
  caught and fixed via this script: a transient failure deleting a replaced image's old attachment was being
  fully silently swallowed, orphaning a stored file with zero visibility — now logged via the existing
  structured logger (`src/core/logging/logger.ts`) instead of disappearing without a trace; the replace
  action itself still never blocks on this, by design.
- **Live in-browser verification was not completed, again** — the same shared-dev-server constraint as the
  foundation phase (another chat session's `next dev` holds the only usable port and Next.js's own
  single-instance-per-directory lock in this exact working directory), tried again with a different port per
  the user's own choice and hit the identical lock. **No real Anthropic API key exists in this environment**
  (`ANTHROPIC_API_KEY` is empty in `.env`), so the actual external API call itself — steps like "confirm
  structured JSON is returned," "confirm the Anthropic request works" — could not be executed for real and
  are honestly reported as NOT TESTED, not claimed as passing.
- **Not built this phase**: any garment image generation (explicitly out of scope for Process 1), a
  background job queue for the analysis run (the in-progress guard's 3-minute staleness window is the
  accepted, documented trade-off in its absence). Development Brief (Process 2) followed directly after —
  see its own dated section below.

## AI Garment Flow — Process 2: Commercial Design Development Brief (2026-09-06)

Builds directly on Process 1 above — starts only once the Reference Garment Analysis is `APPROVED`. Found
already fully implemented (schema, migration, AI prompt module, service/repository, routes, UI, unit tests)
when this session picked the task up — this section documents what was verified, the two real bugs found
and fixed, and brings the two stale "not built" claims from the sections above back in line with reality.

**AI layer** (`src/core/ai/development-brief/{schema,prompt,generate}.ts`) follows Process 1's exact 3-file
hidden-prompt pattern (`schema.ts`/`prompt.ts` own zero Prisma/SDK imports; `generate.ts` is the one entry
point, zero DB access). `PROMPT_VERSION = "development-brief-v1"`. The hidden system prompt
(`buildSystemPrompt()`) is verbatim per spec: senior product-development-director framing, "the objective is
NOT to reproduce the reference garment," the full 24-field-per-direction list, `Do not create images` /
`Do not invent exact garment consumption` / `Do not invent exact manufacturing costs`, and the 6-category
0-10 scoring + 0-100 overall score. Forced via Anthropic's `tool_choice`+`strict: true` (never free-text
JSON), with exactly one corrective retry on a validation failure and never a fabricated/partial result on
final failure — same `requestStructuredTextOutput()` machinery Process 1's vision call already proved.
`AiGarmentDevelopmentBriefRun` is the append-only attempt log (mirrors `AiGarmentReferenceAnalysisRun`); a
run stuck `IN_PROGRESS` past 5 minutes (longer than Process 1's 3 — a 9-direction batch takes longer) is
treated as abandoned, not a permanent lock.

**Schema**: `AiGarmentDesignDirection` — one row per direction, mutated in place (not append-only), 25
content columns + 6 category scores + `overallScore` + `isRecommendedForVisualisation`. Recommendation is
**always derived, never hand-set**: `recomputeRecommendations()` (`development-brief.repository.ts`) runs in
one transaction, flags the top ~30% (min 1) by `overallScore` among every non-REJECTED direction, and is
re-run after every create/edit/decide/regenerate — a REJECTED direction can never stay flagged recommended,
and approving/rejecting one changes what "top 30%" means for the rest.

**Two real bugs found via live testing against the real Anthropic API + real Postgres (not just unit tests),
both fixed**:
1. **Workflow-step gate bypass** (`ai-garment-project.service.ts`'s `saveWorkflowStep`) — both Process 2
   gates ("Development Brief needs an approved analysis," "leaving Development Brief needs ≥1 approved
   direction") were keyed on an exact `stepKey` match (`=== "DEVELOPMENT_BRIEF"`, or
   `currentStepKey === "DEVELOPMENT_BRIEF" && stepKey === "GENERATE_VARIATIONS"`). The stepper lets a user
   click any step directly, not just the immediate next one — jumping straight from `REFERENCE_ANALYSIS` to
   e.g. `SELECT_DESIGN` skipped both gates entirely, since neither exact match ever fired. Fixed by keying
   both gates on the **target step's position** in `stepsForSourceType()`'s sequence instead
   (`targetIndex >= developmentBriefIndex` for the analysis-approved gate, `targetIndex >
   developmentBriefIndex` for the approved-direction gate) — closes the bypass regardless of the current
   step or how many steps are skipped at once. 5 new regression tests in `ai-garment-project.service.test.ts`
   (the two mocked repositories this fix newly depends on, `AiGarmentReferenceAnalysisRepository`/
   `AiGarmentDesignDirectionRepository`, had no mocks in this test file at all before — added them).
2. **Stale `isRecommendedForVisualisation` in the return value of `editDesignDirection`/
   `decideDesignDirection`/`regenerateDesignDirection`** — all three call `AiGarmentDesignDirectionRepository
   .update()` then separately `recomputeRecommendations()`, but were returning `update()`'s own result
   directly — which reflects the row's state **before** the recompute, not after. Caught live, not by a unit
   test: rejecting a direction that had been flagged recommended returned an object still claiming
   `isRecommendedForVisualisation: true`, even though the database itself was correctly updated moments
   later by the recompute. The real UI is unaffected (`DesignDirectionCard.tsx` discards the POST response
   body and always does a full reload via `onChanged()`), but the service-level bug is real for any other
   caller and is exactly the "never trust a value computed before a subsequent side effect" class of bug this
   project has hit and fixed several times before (Sampling's Hold/Resume, Purchasing's cancel-from-`ON_HOLD`).
   Fixed by adding `AiGarmentDesignDirectionRepository.findById()` and re-fetching through it after every
   recompute in all three functions, returning the genuinely-current row. 3 regression tests updated in
   `development-brief.service.test.ts` to assert the returned value reflects the post-recompute state, not
   the stale pre-recompute one.

**Verified live end-to-end against the real Anthropic API and real Postgres**, exactly per the requested test
plan: created a project, confirmed both gates block with no approved analysis, seeded a realistic APPROVED
Reference Analysis, confirmed both gates now block on zero approved directions (including the bypass paths
above), called `createDevelopmentBrief` for 6 directions/`BALANCED` — the real model returned 6 genuinely
differentiated directions with a real classification spread (2 `SAFE_COMMERCIAL`/2 `BALANCED`/2
`FASHION_FORWARD` on one run), correct `LOW`/`MEDIUM`/`HIGH` complexity ratings, every required field
populated with real non-placeholder content, and the top-scored direction correctly flagged recommended —
edited one direction's silhouette (confirmed `userEdited`/status-reset to `GENERATED`, confirmed the
AI-original value is preserved untouched in `aiRawJson` for audit), rejected one (confirmed it lost the
recommended flag), approved three, reloaded via a fresh `listDesignDirections` call and confirmed every
edit/decision survived the round-trip, then confirmed the `GENERATE_VARIATIONS` gate now passes. Re-ran the
same scenario a second time after the two fixes above to reconfirm both are actually closed (13/13 checks
passed on the second run, including the specific rejected-direction-recommendation-flag check that failed
before the fix). `npx tsc --noEmit` (clean apart from the documented, pre-existing `.next/dev/types` stale-
cache artifact from another session's concurrently-running dev server — not this module's code), `npx
eslint` (clean on every touched file), and `npx vitest run` (1005/1005, no regressions) all clean.

**Not built this phase** (explicitly out of scope per the spec): image generation for any design direction
(the spec's own "Do not generate images yet. Stop after Process 2 works." instruction) — that's Process 3,
"Generate Variations," the very next step this workflow already points at.

## AI Garment Flow — Process 1 bugfix: real 502 on reference analysis, root-caused and fixed (2026-09-06)

A user reported a live `502` calling `POST .../reference-analysis/run` against a real project via curl — the
first genuine live exercise of Process 1's actual Anthropic vision call against a real uploaded image (the
verification note in that section above had correctly flagged the external call itself as NOT TESTED at the
time). Root-caused via a standalone diagnostic script (`AI_DEBUG=1` env flag added to
`requestStructuredToolCall()`, logging the raw SDK error and both attempts' raw tool input on a validation
failure) run directly against the real project, not guessed from the stack trace.

- **Root cause**: the original `referenceAnalysisResponseSchema`/`buildToolInputSchema()` grouped 15 of the
  36 observation fields under 4 nested sub-objects (`sleeve.*`, `fabricObservations.*`, `printPattern.*`,
  `constructionComplexity.*`). Anthropic's `strict: true` tool mode rejected the resulting tool schema
  outright with `400 "The compiled grammar is too large... Simplify your tool schemas or reduce the number
  of strict tools."` — a real, confirmed-live size/complexity limit on the constrained-decoding grammar
  compiler, not a bug in this codebase's request-building.
- **First fix attempt, confirmed live to make things worse**: flattening the 4 nested groups into flat
  top-level keys (`schema.ts`/`feature-registry.ts`/`prompt.ts`/`reference-analysis.service.ts`) did NOT
  remove the 400 — confirmed by re-running the same diagnostic after flattening and getting the identical
  "compiled grammar is too large" rejection. The limit scales with the schema's total node count (36
  observation objects × their fields), not nesting depth, so flattening alone was never going to fix it.
  Disabling `strict` on the *original nested* schema was tried even earlier and made things worse in a
  different way: without the server-side shape guarantee, the model routinely returned a plain string where
  a nested object was required (confirmed live: `"sleeve: Invalid input: expected object, received string"`).
- **Actual fix**: `requestStructuredVisionOutput()` (`src/core/ai/providers/anthropic.ts`) now calls with
  `strict: false` — the only viable option for this schema's real size — combined with the flattened schema
  from the first attempt, which is still kept and still worth it: it removes the specific nested-object
  wrong-shape failure mode above, so `strict: false`'s only remaining safety net (the existing Zod
  `validate()` + one-shot corrective retry already built into `requestStructuredToolCall()`) has less to
  catch. Also bumped `VISION_MAX_OUTPUT_TOKENS` 8000 → 16000 (confirmed live: a real 36-field vision analysis
  with rich per-field prose was genuinely truncated mid-schema at 8000, a second, independent contributor to
  the original failure — matches Process 2's own already-proven-safe bound for a comparably large structured
  response).
- **Verified live end-to-end against the real project** (`4b0e71c4-9676-459d-b4b2-0a9bd7587bda`) after the
  fix: the first attempt still occasionally returns a partial tool call (confirmed live: one real run
  returned only `garmentCategory` before stopping) — the existing one-shot corrective retry recovered it on
  the very next attempt, producing a `SUCCESS` run with all 36 observations populated and a real, coherent
  `designDnaSummary`. Confirmed via a direct DB query — analysis status `AI_ANALYSED`, `observations.length
  === 36` — not just a 200 status code.
- Fixed a stale unit-test mock in `reference-analysis.service.test.ts` that still used the old nested
  response shape (`sleeve: {...}`, `fabricObservations: {...}`, etc.) — updated to the flat shape the schema
  now actually produces; this was the one thing the flattening change (done before this bug report, already
  in the working tree) had left unreconciled with its own test.
- `npx tsc --noEmit`, `npx eslint .`, and `npx vitest run` (1019/1019) all clean.

## AI Garment Flow — Process 3: Garment Design Visual Generation (2026-09-06)

Builds on Process 2 — starts once at least one `AiGarmentDesignDirection` is `APPROVED`. Per the spec, uses
only APPROVED design directions and builds a modular, provider-agnostic image-generation service — no
provider's SDK is imported anywhere except one file under `providers/`, so a second provider (e.g. "The New
Black AI") can be added later with zero caller changes.

- **`src/core/ai/image-generation/`**: `types.ts` (the `ImageGenerationProvider` interface,
  `ImageGenerationServiceError` + 9-category `ImageGenErrorCategory` covering every error class the spec
  named — API unavailable, credits exhausted, generation failed, unsafe/unsupported input, timeout, invalid
  image response — plus `MISSING_CONFIG`/`RATE_LIMIT`/`UNSUPPORTED_OPERATION`), `config.ts`
  (`getOpenAiImageConfig()`), `providers/openai.ts` (the sole `openai` npm package importer, pinned to an
  exact version `7.10.0` matching this project's own `next-auth`-pinning precedent), `factory.ts`
  (`getImageGenerationProvider()`), `prompt.ts` (`buildImageGenerationPrompt()`/`buildVariationPrompt()` — the
  exact, verbatim hidden template with placeholders for category/silhouette/fit/length/neckline/collar/
  sleeve/shoulder/front/back/closure/pocket/waist/hem/feature/fabric/customer/market/season/
  commercial_position, built from the approved design direction's own structured fields — never shown to end
  users, never free-typed).
- **OpenAI Images API specifics, confirmed against the installed SDK**: `gpt-image-1` always returns
  `b64_json` (never a URL) — chosen specifically to avoid a "URL expired before we saved it" failure mode,
  since every generated image is immediately persisted through the existing `AttachmentService`/
  `FileStorage`, never kept as an external URL. Error classes (`APIError`/`APIConnectionError`/
  `APIConnectionTimeoutError`/`AuthenticationError`/`PermissionDeniedError`/`RateLimitError`/
  `BadRequestError`) are top-level named exports from `"openai"`, not static members of the `OpenAI` class
  (a real distinction from `@anthropic-ai/sdk`'s own convention). The real exhausted-credits shape, confirmed
  live against a real zero-balance account: `RateLimitError`, `status: 429`, `err.type ===
  "insufficient_quota"`, `err.code === "credit_balance_exhausted"` — `mapSdkError()` checks both fields.
- **Schema** (migration `20260906160000_add_ai_garment_visual_generation`): `AiGarmentImageGenerationRun`
  (the run/audit-log row — created BEFORE the provider is even resolved, matching Process 1/2's own run-log
  discipline exactly, so a `MISSING_CONFIG` failure from a missing API key gets logged as a `FAILED` run like
  any other provider error, not silently skipped) and `AiGarmentGeneratedImage` (Generation ID/Prompt
  version/Provider/Date/Image attachment/Parent Design Direction/decision/user notes, `decision` enum
  `PENDING/SELECTED/REJECTED`). Every "Regenerate"/"Create Variation" inserts brand-new rows — nothing is
  ever overwritten except `decision`/`userNotes` via explicit Select/Reject actions, giving full version
  history for free. Style Master association is derived at read time (`image → project →
  project.productId`), never a stored FK, since a project may not have graduated to a real Style yet at
  generation time — the same "derive, don't duplicate" discipline used throughout this codebase.
- **`visual-generation.service.ts`**: `generateVisuals()` (1/3/4 images per request, per the spec),
  `createVariation()` (image-to-image off one existing generated image), `decideImage()` (Select requires an
  explicit `confirmed: true` flag validated server-side, matching the spec's "require confirmation" —
  Reject does not, matching this project's established Approve/Reject asymmetry), `listGeneratedImages()`.
  `runGeneration()` is the shared helper both `generateVisuals()`/`createVariation()` use — creates the run
  row using env-derived provider/model string constants *before* resolving the actual provider instance, so
  a `MISSING_CONFIG` throw from `getImageGenerationProvider()` still gets logged; the real provider call and
  every image-row insert happen inside the same try/catch that calls `markFailed()` on any error.
- **UI**: `VisualGenerationPanel.tsx` — per approved design direction, shows Name/Commercial Score/Brief
  Summary + a "GENERATE VISUAL" button with a 1/3/4-image count selector; each generated image shows
  Select/Reject/Regenerate/Create Variation actions and a Compare view; Select opens a confirmation dialog
  before committing (never a silent single click). Wired into `AiGarmentProjectWorkflowPanel.tsx`'s
  `GENERATE_VARIATIONS` step (split apart from the placeholder `GENERATE_DESIGNS` branch it previously
  shared).
- **13 new unit tests** (`visual-generation.service.test.ts`) covering the error-mapping table, the
  run-created-before-provider-resolved ordering, the confirmed-Select requirement, and never-overwrite
  version history. 1019/1019 tests project-wide, `npx tsc --noEmit` and `npx eslint .` clean.
- **Live end-to-end verification blocked, not a code defect**: the real OpenAI account configured in this
  environment returned `credit_balance_exhausted` on every attempted generation — confirmed via
  `mapSdkError()`'s own `CREDITS_EXHAUSTED` path returning the correct user-facing message, and via a run row
  correctly logged `FAILED`/`CREDITS_EXHAUSTED` in the real dev DB. The explicit test requirement (generate
  for at least two design directions, select one, confirm it's attached correctly to the Style Master) could
  not be completed for real as a result — this needs the user to add billing credits at
  `https://platform.openai.com/settings/organization/billing/` before it can be exercised live. All code-side
  verification (unit tests, schema, error mapping, run-log discipline) is complete and correct; only the real
  external API call and the resulting live walkthrough remain unverified.
- **Not built this phase**: any second image-generation provider (the architecture supports adding one with
  zero caller changes, none was requested this phase), controlled feature changes past visual generation —
  per the spec's own explicit "Do not yet implement controlled feature changes. Stop." instruction.

## AI Garment Flow — Process 4: Controlled Design Variation (2026-09-07)

Builds on Process 3 — starts from one existing `AiGarmentGeneratedImage` (never edited or deleted by this
process — "the original"). Adds a "MODIFY DESIGN" button opening a form (Feature to Change / Current
Feature / New Requirement / Additional Instructions) that image-to-image regenerates just the named
feature, per the spec's own hidden prompt template.

- **Deliberately one level deep, not a chain** — every `AiGarmentDesignVariation.parentGeneratedImageId`
  always points at the SAME original image, never at a prior variation; `variationNumber` increments per
  parent image starting at 1. "Create Another Variation" means "try a different feature/requirement against
  the same original," not "iterate on the variation I just made" — a simpler, easier-to-reason-about scope
  than open-ended chaining, matching this project's own repeated "explicit MVP simplification, documented
  not silently dropped" precedent. Revisit only if real usage shows chaining is actually needed.
- **Schema** (migration `20260907090000_add_ai_garment_design_variations`): a fixed `AiGarmentDesignFeature`
  enum (`NECKLINE/COLLAR/SLEEVE/SLEEVE_LENGTH/CUFF/GARMENT_LENGTH/FIT/SILHOUETTE/POCKET/CLOSURE/WAIST/HEM/
  OTHER`, exactly the spec's own picklist), `AiGarmentDesignVariationRun` (the run/audit-log row, mirrors
  `AiGarmentImageGenerationRun` exactly — created BEFORE the provider is even resolved so a `MISSING_CONFIG`
  failure is still logged), and `AiGarmentDesignVariation` (version control per the spec: Parent Image ID/
  Variation Number/Changed Feature/Previous Value/New Value/Created Date — `decision` enum `PENDING/
  SELECTED/KEPT_ORIGINAL`, never edited/deleted, only ever inserted). "Never delete the original" holds
  structurally: nothing in this module ever writes to `AiGarmentGeneratedImage` at all.
- **`src/core/ai/design-variation/`**: `feature-registry.ts` (the client-safe feature label map, same
  zero-Prisma-imports convention as `reference-analysis/feature-registry.ts`), `prompt.ts`
  (`buildFeatureChangePrompt()` — the exact, verbatim hidden template: "Keep the selected garment design as
  unchanged as possible... Change ONLY: Feature/Current/New Requirement... Preserve: overall silhouette
  unless silhouette is the selected change, fabric appearance, colour, print scale, garment category,
  remaining construction, model, pose, background... Do not independently redesign other garment
  features..." — never shown to end users, never free-typed by a user; "Additional instructions from the
  user" is appended only when the optional field is actually supplied).
- **`design-variation.service.ts`**: `createDesignVariation()` mirrors `visual-generation.service.ts`'s own
  `runGeneration()` shape (run row created first, provider resolved and called inside the same try/catch,
  `markFailed()` on any error including `UNSUPPORTED_OPERATION` for a provider with no `generateVariation`
  capability) — reusing the parent image's real bytes via the existing `getAttachmentForDownload()` and
  `provider.generateVariation()` (the same image-to-image capability Process 3's own "Create Variation"
  already proved), never a fresh text-only `generate()` call, since the whole point is regenerating *from*
  the original image. `decideDesignVariation()`: `SELECT` requires `confirmed: true` (a `ConfirmModal` on
  the client), `KEEP_ORIGINAL` is a lighter one-click action — the same Approve/Reject asymmetry precedent
  already used throughout this project (Sampling, Development Brief, Process 3's own Select/Reject).
- **UI** (`VisualGenerationPanel.tsx`, extended in place — no new page): each generated-image thumbnail
  gained a "MODIFY DESIGN" button opening the feature-change form in a `Modal`, and a "Show/Hide design
  variations (N)" toggle (self-fetches on first open, matching this project's established
  self-fetch-on-open convention) revealing every variation as a card: Original | Variation images
  side-by-side, the changed feature/previous→new values, created date, and three actions — **Select
  Variation** (behind a `ConfirmModal`), **Keep Original**, **Create Another Variation** (reopens the same
  Modify Design form against the same parent image).
- **13 new unit tests** (`design-variation.service.test.ts`) covering the error-mapping table, the
  run-created-before-provider-resolved ordering, the confirmed-Select requirement, the prompt actually
  containing the submitted feature/current/new values and the optional additional-instructions paragraph,
  and version-number incrementing off `countByParentImageId`. 1032/1032 tests project-wide, `npx tsc
  --noEmit` and `npx eslint` clean.
- **Live verification, real Postgres + the real (still credit-exhausted) OpenAI account**: the explicit test
  requirement (change Sleeve, Neckline, Length; confirm other major features stay consistent) could not be
  completed for real — a fresh probe confirmed the configured OpenAI account is still `CREDITS_EXHAUSTED`,
  the same blocker Process 3 hit. What WAS verified live, end-to-end, not just mocked: built a full real
  fixture chain (Reference Analysis → Development Brief Run → Design Direction → Image Generation Run →
  Generated Image, all in the real dev DB) and ran `createDesignVariation()` for real against all three
  spec-named features (Sleeve/Neckline/Garment Length) — confirmed each attempt genuinely reached the real
  OpenAI API and was correctly rejected with the real `CREDITS_EXHAUSTED` category, confirmed exactly 3 run
  rows were created and marked `FAILED` (one per attempt, with the real submitted feature/current/new values
  recorded on each), confirmed zero `AiGarmentDesignVariation` rows were created for any failed attempt, and
  confirmed the original generated image itself was never modified. All 9 of these checks passed. Once
  credits are added, only the success path (an actual regenerated image + the side-by-side visual
  comparison) remains to be exercised — the unit tests already cover that code path's correctness with a
  mocked provider.
- **Not built this phase**: chaining a variation into a further variation (see the scope note above), any
  second image-generation provider, controlled feature changes beyond this process — per the spec's own
  "Stop after Process 4" instruction.

## AI Garment Flow — Process 5: Commercial Design Evaluation (2026-09-07)

Builds on Process 2 — compares 2-8 of a project's own APPROVED `AiGarmentDesignDirection` rows (the real
named "designs," not a raw image or variation — those are visual renderings OF a design, not the design
itself) on the spec's own 12-criterion commercial rubric, using a real Anthropic text call. Unlike Process 3/4
(OpenAI image generation, blocked by the account's exhausted credits), this call uses `ANTHROPIC_API_KEY`
— present and working — so it was **fully live-verified end-to-end**, not just unit-tested.

- **Schema** (migration `20260907130000_add_ai_garment_commercial_evaluation`): `AiGarmentCommercialEvaluationRun`
  (the run/audit-log row, mirrors every other AI Garment Flow run-log table — created before the provider is
  resolved), `AiGarmentCommercialEvaluation` (header, append-only — a re-run always creates a new evaluation,
  never overwrites a prior one, same "full history stays inspectable" precedent as `AiGarmentDesignDirection`
  itself), `AiGarmentCommercialEvaluationItem` (one row per compared design — the 12 raw 1-10 scores, the
  server-computed `commercialDevelopmentScore` /100, Strengths/Weaknesses/Manufacturing Risks/Potential Cost
  Risks/Suggested Improvement, `aiRank`, and a nullable `userRank` override). `AiGarmentProject` gained
  `selectedDesignDirectionId`/`selectedDesignAt`/`selectedDesignByUserId` — "SELECTED DESIGN" is recorded on
  the project itself (not a real `Product`/Style Master row, which may not exist yet at this stage of the
  workflow — graduation via `convertProjectToStyle()` is a later, still-manual step required only once BOM/
  Costing begin) and is deliberately **not** a guarded "set once" write like `productId`/`sampleRequestId` —
  a merchandiser revisiting this step to pick a different design later is a legitimate correction, not a
  graduation to protect.
- **`commercialDevelopmentScore` is always computed server-side**, never trusted from the AI's own
  arithmetic (the same "never trust a computed total from the client/model" discipline used everywhere else
  — Sales Order/Journal/MRP totals, etc.): `computeCommercialDevelopmentScore()` in
  `src/core/ai/commercial-evaluation/schema.ts` applies the spec's exact weights (Commercial Appeal/Buyer
  Fit/Target Price Compatibility each 15%, Manufacturing Simplicity/Fabric Suitability/Consumption
  Efficiency/Scalability/Design Freshness each 10%). The spec names 12 criteria but only gives explicit
  weights for 8 — the remaining 4 (Target Customer Fit, Pattern Making Complexity, Sewing Complexity, Trim
  Complexity) are read as together comprising the spec's own "Other Technical Factors 5%" bucket: their
  average is weighted 5%, giving a max score of exactly 100. Every criterion, including the three
  "complexity" ones, is instructed (in the hidden prompt's own technical addendum) to use the same
  higher-is-better scale — a 10 on a complexity criterion means LOW complexity — so one weighted sum is
  meaningful across all twelve without inverting any of them.
- **The AI's response is positional, never id-keyed** — `src/core/ai/commercial-evaluation/prompt.ts` numbers
  each design "DESIGN 1", "DESIGN 2", etc. in the exact order requested, the model returns exactly that many
  items in that same order (enforced by `buildCommercialEvaluationResponseSchema(designCount)`'s `.length()`
  check, `strict: true`'s array-length keywords being silently stripped per the same confirmed-live Anthropic
  limitation Process 2 already documented), and the service zips the response back to the real design ids by
  array position — the model is never given a real database id it could hallucinate or misreport.
  `buildCommercialEvaluationResponseSchema()`'s own `superRefine` also enforces exactly one FIRST_CHOICE
  always, one SECOND_CHOICE whenever ≥2 designs are compared, and one THIRD_CHOICE whenever ≥3 are — this is
  the actual safety net for that constraint, not just prompt wording.
- **Auto-pulled context** (Buyer/Market/Customer/Season/Target Price/Fabric if known/Order Quantity if
  known/Factory Capability) reuses `AiGarmentProjectRepository.findByIdWithDetails()`'s existing eager-loaded
  relations exactly as Development Brief's own `buildContext()` does — Customer's name is included this time
  (Process 2 never bothered pulling it in), and "Fabric if known" is a readable string built from
  `AiGarmentFabricDetail`'s own GSM/composition/weave/width/dye/color names when that record already exists
  for the project (commonly absent at this stage, since Apply Fabric hasn't necessarily happened yet — the
  field is simply omitted). "Factory Capability" has no schema field anywhere in this ERP (confirmed by
  grep) — it's a free-text runtime input, never persisted on the project, the same non-persisted-override
  convention Development Brief's own `factoryCapabilities` field already established.
- **"Allow user to override AI ranking"**: `overrideCommercialRank()` needs no confirmation at all (it
  commits nothing — a display-only re-ranking), gated by
  `AiGarmentCommercialEvaluationItemRepository.setUserRankExclusive()`, which clears any sibling item in the
  same evaluation currently holding that same rank before setting the new one, in one transaction — two
  items can never both show FIRST_CHOICE. **"Final choice must always be user-approved"**:
  `selectDesignForDevelopment()` is a wholly separate action from ranking, always requires `confirmed: true`
  (the client shows a `ConfirmModal` first), and the design being selected does not have to match either
  ranking shown — a user can select their own 3rd-ranked design and the system does not object.
- **"Move workflow to Apply Fabric" read literally per source type, not assumed universal**: the REFERENCE
  workflow has a real `APPLY_FABRIC` step right after `SELECT_DESIGN`; the FABRIC workflow has none (fabric
  is already known for that path — confirmed by reading `AI_GARMENT_FABRIC_STEPS`), so the natural next step
  there is `TECHNICAL_DEVELOPMENT` instead. `selectDesignForDevelopment()` reuses the existing, unchanged
  `saveWorkflowStep()` twice — once for `SELECT_DESIGN` itself (so it's recorded as a completed step), then
  once more for whichever step genuinely follows it in `stepsForSourceType(project.sourceType)` — rather than
  duplicating any step-advance logic or hardcoding "APPLY_FABRIC" unconditionally.
- **UI**: `CommercialEvaluationPanel.tsx` replaces the `COMMERCIAL_EVALUATION` step's old `AiPlaceholderButton`
  stub — a design picker (2-8 checkboxes + optional Factory Capability text field) and a "COMPARE
  COMMERCIALLY" button; once an evaluation exists, a comparison table (one row per design, all 12 scores +
  the computed total + effective rank badge) plus one detail card per design (Strengths/Weaknesses/Risks/
  Improvement, a rank-override dropdown, and its own "SELECT DESIGN FOR DEVELOPMENT" button behind a
  `ConfirmModal`). Only the most recent evaluation is shown — older ones stay in the database (append-only)
  for audit, not yet surfaced in this view; a documented, deliberate MVP scope choice.
- **20 new unit tests** (`commercial-evaluation.service.test.ts`) covering the eligibility filter (APPROVED
  only), the active-run guard, the not-found/not-approved validation on both the compare and select actions,
  the error-mapping table, the positional zip-back-to-real-ids behavior, an exact hand-verified
  `commercialDevelopmentScore` calculation (79 from a known set of inputs), the rank-override exclusivity,
  and both source-type branches of the post-selection workflow advance. 1052/1052 tests project-wide, `npx
  tsc --noEmit` and `npx eslint .` clean.
- **Live end-to-end verification, real Postgres + the real Anthropic API — 21/21 checks passed**, genuinely
  end-to-end this time (unlike Process 3/4's OpenAI-credits blocker): seeded 3 real APPROVED design
  directions (a classic tee, an oversized streetwear tee, a ringer tee) with real project-level commercial
  context (target market/price/order quantity + a Factory Capability override), then called
  `createCommercialEvaluation()` for real. The model returned exactly 3 items, one FIRST/SECOND/THIRD_CHOICE
  each, every one of the 12 scores a real integer 1-10, real non-placeholder Strengths/Weaknesses/Risks/
  Improvement text, and a genuine comparative rationale — confirmed the server-computed
  `commercialDevelopmentScore` lands in the valid 0-100 range for all three (the oversized streetwear design
  scored lowest and was ranked THIRD_CHOICE, consistent with its own higher manufacturing/consumption
  complexity). Then exercised `overrideCommercialRank()` (confirmed no duplicate FIRST_CHOICE across
  siblings), confirmed `selectDesignForDevelopment()` correctly rejects an unconfirmed call, then confirmed a
  confirmed call records `selectedDesignDirectionId` on the real project row AND correctly advances
  `currentStepKey` to `APPLY_FABRIC` with both `SELECT_DESIGN` and `APPLY_FABRIC` recorded in
  `completedStepKeys`. All fixture data (directions, brief run, evaluation, attachment, and the project's own
  mutated fields) was cleaned up afterward, restoring the real pre-existing Reference Analysis's own status
  exactly as found.
- **Not built this phase**: surfacing prior (non-latest) evaluations in the UI, any UI treatment for the
  eligibility gate beyond a plain "approve at least two directions first" message — per the spec's own "Stop"
  instruction after Process 5.

## AI Garment Flow — Process 6: Apply Actual Fabric to Selected Garment (2026-09-07)

Builds on Process 5 — starts from the project's own SELECTED DESIGN and applies a real, user-uploaded fabric
swatch onto its currently SELECTED garment visual via a genuine two-image OpenAI edit call (the base garment
image AND the swatch, both sent as real image inputs — never just described in the text prompt). Same
credit-exhausted-account blocker as Process 3/4 for the live success path; every other guard was verified
live end-to-end.

- **Resolving "the selected garment"**: `resolveSelectedGarmentImage()` in `fabric-application.service.ts`
  requires `AiGarmentProject.selectedDesignDirectionId` to be set (Process 5's own output), then checks
  every `AiGarmentGeneratedImage` AND every `AiGarmentDesignVariation` across that design direction for
  whichever was most recently marked `SELECTED` — a variation can supersede its own parent image as "the
  chosen visual," so both pools are checked rather than assuming one always wins, and the most recently
  updated match is used. A clean `VALIDATION_ERROR` names exactly what's missing (no design selected yet, or
  no visual selected yet) rather than guessing.
- **A genuine two-image capability, not a re-purposed single-image one**: `ImageGenerationProvider` gained
  a new optional `applyFabric()` method (alongside the existing `generate`/`generateVariation`) taking both
  `baseImage` and `swatchImage` — confirmed from the installed OpenAI SDK's own type definitions that
  `images.edit()` accepts an array of up to 16 input images for `gpt-image-1`, not just one. A provider
  without this capability is a clean, logged `UNSUPPORTED_OPERATION` failure, same discipline as
  `generateVariation`'s own optional-capability check.
- **Every field may be marked Unknown, and the app never guesses on the user's behalf**: all 12 textile
  fields (Fabric Code, Composition, Width, GSM, Woven/Knit, Stretch, Drape, Transparency, Surface Character,
  Print/Pattern, Directionality, Special Placement, plus the two purely-commercial fields Available Quantity/
  Cost Per Metre) are optional. A field left blank is substituted in the hidden prompt with an explicit
  instruction to infer conservatively from the swatch image itself rather than invent an exact value — never
  silently rendered as an empty line the model might read as "this attribute doesn't exist."
- **The hidden prompt is verbatim per the spec's own 9-placeholder "Known textile information" template**
  (Composition/Width/GSM/Stretch/Drape/Transparency/Surface/Pattern/Special Placement) — Woven/Knit and
  Directionality are collected on the form too but aren't part of that fixed template; both are genuinely
  visually load-bearing (construction type drives drape/stretch behaviour; directionality drives stripe/
  check alignment, which the template's own "preserve stripe direction, check direction" instruction
  directly depends on), so they're appended as a short additional paragraph after the verbatim block — the
  same "fixed template + an appended optional paragraph" shape Process 4 already established for its own
  `additionalInstructions` field. Available Quantity/Cost Per Metre are purely commercial (BOM/costing) data
  and are never fed into the image prompt at all.
- **Schema** (migration `20260907150000_add_ai_garment_fabric_application`): `AiGarmentFabricApplicationRun`
  (the run/audit-log row, mirrors every other AI Garment Flow run-log table), `AiGarmentFabricApplication`
  (version control mirroring `AiGarmentDesignVariation`'s own shape — never edited/deleted, "Approve" only
  changes `decision`; `baseImageAttachmentId` is "Before," `resultImageAttachmentId` is "After," both kept;
  `swatchAttachmentId` stores the original swatch separately per the spec's own instruction). `AiGarmentProject`
  gained `approvedFabricApplicationId`/`approvedFabricApplicationAt`/`approvedFabricApplicationByUserId` —
  "APPROVE DESIGN & FABRIC"'s outcome, recorded on the project itself (not a real Style Master row, which may
  not exist yet — same reasoning as Process 5's `selectedDesignDirectionId`) and deliberately mutable, not a
  guarded set-once write.
- **"Do not overwrite the selected garment design" holds structurally**: this whole process never writes to
  `AiGarmentGeneratedImage` or `AiGarmentDesignVariation` at all. Regenerate/Change Fabric (a new swatch
  upload)/Adjust Print Scale/Adjust Placement are deliberately **not** four separate backend actions — all
  four are the same `createFabricApplication()` call with different submitted fields, so the UI is one
  reusable form (edit the fields or swap the swatch, then click APPLY FABRIC again) rather than four
  near-identical buttons that would each need their own code path for no real behavioural difference.
- **Two separate approval tiers, not one**: `decideFabricApplication()` ("Approve" per attempt) is a lighter
  maker/checker step, exclusive per design direction (approving one clears any sibling's `APPROVED` flag —
  the same exclusivity idiom already proven by `AiGarmentDesignOptionRepository.selectExclusive` and Process
  5's own rank-override exclusivity). `approveDesignAndFabric()` ("APPROVE DESIGN & FABRIC," the final
  button) is a wholly separate, always-confirmed commitment requiring the chosen application to already be
  `APPROVED` — matching "Final choice must always be user-approved" from Process 5 carried through here too.
- **"Move to Technical Development" reuses the existing, unchanged `saveWorkflowStep()` twice** — once for
  `APPLY_FABRIC` itself, then once more for whichever step genuinely follows it via `stepsForSourceType()` —
  the exact same pattern Process 5 established for its own workflow advance. `APPLY_FABRIC` only exists in
  the REFERENCE-sourced workflow's own step list (a FABRIC-sourced project already has real fabric from its
  earlier steps), so this whole process is only ever reachable there; the first `saveWorkflowStep` call's
  own step-key validation already rejects the action outright for a FABRIC-sourced project, with no separate
  source-type guard needed in this module.
- **UI**: `FabricApplicationPanel.tsx` replaces the `APPLY_FABRIC` step's old `AiPlaceholderButton`, sitting
  alongside the pre-existing `FabricDetailForm` (which remains unchanged — it manages the unrelated BOM-
  oriented dropdown fields from the existing fabric-config masters, a genuinely separate concern from this
  process's free-text swatch-application fields). A swatch file input + the 12 text fields + Available
  Quantity/Cost Per Metre, an "APPLY FABRIC" button, and a Before/After card per attempt with Approve (behind
  a `ConfirmModal`) and, once approved, its own "APPROVE DESIGN & FABRIC" button (behind a second
  `ConfirmModal`).
- **19 new unit tests** (`fabric-application.service.test.ts`) covering the design-not-selected and
  no-image-selected guards, the image-vs-variation resolution picking whichever was more recently selected,
  the swatch mime-type check, the error-mapping table, the prompt actually containing the submitted fields
  plus the appended Woven/Knit line, and both approval tiers including the final workflow advance.
  1071/1071 tests project-wide, `npx tsc --noEmit` and `npx eslint .` clean.
- **Live end-to-end verification, real Postgres + the real OpenAI account — 7/7 checks passed**: confirmed
  `createFabricApplication()` correctly rejects with no design selected, correctly rejects with no visual
  selected, correctly rejects a non-image swatch — then made the real live `applyFabric` call against the
  real account, which failed cleanly with the exact same `CREDITS_EXHAUSTED` category already documented for
  Process 3/4 (confirmed via a direct DB query: exactly one run row, `FAILED`/`CREDITS_EXHAUSTED`, and zero
  `AiGarmentFabricApplication` rows created for the failed attempt). The Approve/Approve-Design-and-Fabric
  success path could not be exercised live as a result — it's covered by the mocked unit tests instead, same
  documented gap as Process 3/4's own success path.
- **Not built this phase**: any second image-generation provider capable of `applyFabric` (the architecture
  supports adding one with zero caller changes), the technical flat itself — per the spec's own explicit "Do
  not build technical flat yet. Stop." instruction.

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
