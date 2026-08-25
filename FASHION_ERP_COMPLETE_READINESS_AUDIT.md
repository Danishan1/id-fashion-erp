# Fashion ERP — Complete Multi-Company Fashion Manufacturing ERP Readiness Audit

**Audit date:** 2026-08-24
**Scope:** Full codebase, schema, migrations, tests, and documentation as of commit `64e64ed` (branch `main`), with the not-yet-merged `outside_erp_feature` branch's Job Work/Product Filtering/Excel Export work also inspected.
**Method:** This is a code-and-schema audit, not a live-browser UAT pass. Findings are backed by direct inspection of `prisma/schema.prisma` (117 models, 61 enums, 4,201 lines), 43 migrations, ~46 service files, 280+ API route files, 116 page components, and 31 test files, cross-checked against every project doc that exists. Where a claim in `CLAUDE.md` or another doc was found to be stale or wrong, that is called out explicitly — this audit does not take documentation at face value.
**Rule followed throughout:** a module is only called "complete" here if its Database + Business Logic + API + UI + Permissions + Validation + Audit + Reporting + Tests + Integration are all sufficiently covered. Existence of a module folder is not evidence of completeness.

---

## 1. Project context reviewed

Read in full or in relevant part: `CLAUDE.md` (the authoritative living roadmap, ~1,800 lines), `GARMENT_ERP_REFERENCE_ANALYSIS.md`, `COMMON_FEATURES.md`, `ARCHITECTURE_REVIEW.md`, `ENTERPRISE_READINESS_ROADMAP.md`, `PRODUCTION_MODULE_DESIGN.md`, `MASTER_PRODUCT_FK_MAPPING.md`, `CRM_SALES_MARKETING_HRMS_MIGRATION_REPORT.md`, `CRM_MARKETING_ENHANCEMENT_AUDIT_AND_PLAN.md`, `README.md`, the full `prisma/schema.prisma`, all 43 migration files, `.github/workflows/ci.yml`, `.env.example`, `next.config.ts`, and `src/config/rbac.ts`.

`PROJECT_CONTEXT.md`, `PROJECT_STATUS.md`, and `AI_RULES.md` **do not exist** in this repository — audit proceeded with the files that do exist, per instructions. Git state: `main` is at `64e64ed` (a merge of `outside_erp_feature`, which added External Job Work / Product Catalog Filtering / Excel Export on top of Phase 8 Dispatch). `npx prisma migrate status` shows the live dev database is one migration behind the checked-in schema (`20260824114456_add_dispatch` not yet applied in this sandbox) — an environment-state fact, not a code defect.

---

## 2. Audit constraints observed

This was conducted read-only. No schema changes, migrations, API changes, UI changes, business-logic changes, refactors, deletions, package installs, or configuration changes were made. The only artifact produced is this file. Nothing was committed.

---

## 3. Answer to the main question (summary — full reasoning in §28)

**Classification: C — Feature Complete but Business Gaps Remain.**

The transactional plumbing across Sampling → Sales Order → BOM/MRP → Purchasing → Production → Dispatch → Invoicing → Payment genuinely exists, end to end, with unusually rigorous engineering in several places (atomic guarded accumulators, a real double-entry journal engine, consistent multi-tenant scoping, a real audit trail, a mature RBAC model). That rules out D. But several **core manufacturing/ERP capabilities a real garment factory needs to run its business are not just "unpolished" — they are structurally absent**: production costing, inventory valuation, real financial statements (P&L/Balance Sheet), a management reporting/MIS layer beyond two CRM-side dashboards, and safe concurrent stock arithmetic in several flows. These are business-workflow gaps, not merely hardening/security gaps, which is what separates this from a B. See §28 for the full weighing.

---

## 4. Multi-Company (Tenant) Isolation Audit

**Classification: Mostly Complete.**

**Schema-level `companyId` coverage** — every one of the 117 models was checked. Models without `companyId` are, without exception, either (a) genuinely global lookups (`Currency`, `UnitOfMeasure`, `Permission`) or (b) line/child tables scoped transitively through a parent that does have `companyId` (`SalesOrderItem`, `JournalLine`, `PurchaseOrderItem`, `CartonItem`, etc.). No model was found holding independent business data with no path back to a company.

**Prior, self-documented, and now-fixed vulnerabilities.** This project has twice shipped a real cross-tenant bug and caught it via its own audit discipline:
- `addSampleMaterial()` originally fetched a `SampleVersion` by bare id with no `companyId` check, letting any authenticated user of any company write into and read another tenant's sample materials (`CLAUDE.md` 2026-08-19). Independently re-verified fixed: `sample.service.ts` now calls `SampleVersionRepository.findWithRequestOwner()` and checks `companyId` equality before writing.
- A follow-up sweep found the identical missing-check pattern in **26 more `update*` functions** across 7 "simple lookup" modules (Brand, Category, FabricGsm, Designation, ProductionStage, CostMaster, PaymentType, Color, Size, etc.) — any user with edit rights on masters could `PATCH` another tenant's lookup row by id. Independently re-verified fixed: every one of these now does a `findFirst({id, companyId})` ownership check before updating.

No new instance of this bug class was found in this pass, across ~20 sampled service files spanning every business module (customers, sales-orders, purchase-orders, material-request, job-work-order, production, accounts, dispatch, sampling, bom-mrp, CRM, HRMS).

**API-route enforcement** — every route handler sampled (10+ across different modules) sources `companyId` exclusively from `session.user.companyId` (signed server-side JWT claim), never from client-supplied request data. No route was found that trusts a client-sent `companyId`. Export routes and attachment download/delete routes both correctly scope by `session.user.companyId` before returning data.

**One naming-convention correction to CLAUDE.md's own implied assumption**: `findAnyById` does **not** mean "cross-company" in this codebase — every `findAnyById` function found still takes and filters by `companyId`; "Any" means "any lifecycle status," not "any tenant." Worth fixing in project docs so a future contributor doesn't misread the convention.

**Genuinely open gaps (not exploitable today, but real):**
- `UserBranchRole` (user↔branch↔role) has no `companyId` column and no code anywhere cross-checks that the three IDs belong to the same company. This is currently harmless only because **no API route exists anywhere to create or edit a `UserBranchRole`** (role assignment today happens exclusively via the seed script or direct DB access). This is a landmine for whenever a role-management UI ships — flag as "must fix before that feature is built," exactly as the project's own `CLAUDE.md` already states.
- `PermissionService`'s in-process permission cache has an `invalidate()` method that is **never called from any production code path** (only from its own test file). Harmless today because no live permission-mutation API exists, but will cause stale-permission bugs the moment one does.
- One RBAC-completeness gap (not a tenant-isolation gap): `approveLeaveRequest()` in `hrms/leave.service.ts` has **no self-approval guard**, unlike the other 9 approve/post checkpoints in the codebase (Sales Order, Purchase Order, Dispatch, Expense, Journal, Payment, both Invoices, Sampling). A MANAGEMENT-role user could create and then approve their own leave request. Reproducible: as a MANAGEMENT user, `POST /leave-requests` for your own linked employee record, then `POST /leave-requests/{id}/approve` as yourself.

**Verdict for this section**: real, meaningful isolation exists and is consistently enforced at the layer that matters (API routes never trust client-supplied tenant identity); the open items above are correctly self-documented risk, not live holes.

---

## 5. Multi-Branch / Multi-Warehouse Audit

**Classification: Partial (by design, self-acknowledged).**

`Branch` correctly belongs to `Company` (`@@unique([companyId, code])`); `Warehouse` correctly belongs to both `Company` and `Branch` (a deliberate denormalization for cheap company-scoping). `WarehouseLocation` has no `companyId` of its own — its own schema comment explicitly warns any caller to join through `warehouse.companyId`, and this is followed everywhere it was checked.

**`branchId` is metadata, not an access boundary.** Grepped across `inventory.service.ts`, `material-request.service.ts`, `stock-movement.service.ts` and beyond: `branchId` is stored on every record that has it, but **is never used in a `where` filter to scope a read or restrict a write**. There is no service anywhere that enforces "this user's branch must match this record's branch." This is consistent, not accidental — `CLAUDE.md` itself lists multi-branch access control as an explicitly **Deferred** item. State this plainly: today, the company boundary is real; the branch boundary is not enforced at all, for any module.

**Stock can never cross a company boundary**, confirmed at the one true chokepoint: `recordInventoryTransaction()` (`inventory.service.ts`) independently re-validates that both the `productId` and `warehouseId` supplied belong to `actor.companyId` before writing anything, regardless of what the calling service already believed. Every module that touches the ledger (Purchasing, Material Request, Stock Movement, Production, Job Work, Dispatch) is forced through this one function — there is no bypass path found anywhere (see §10 for full verification).

Stock **can** cross a branch/warehouse boundary within one company via Stock Transfer (`StockMovementType.TRANSFER`) — this is the intended feature, correctly implemented with both ledger sides posted atomically in one transaction.

---

## 6. Fashion Product / Item Master Audit

**Classification: Sufficient for a real fashion manufacturer, with one real correctness gap.**

**Style vs. Material vs. Variant vs. SKU** — these four concepts are genuinely, correctly separated, not conflated:
- **Style vs. Material**: one `Product` table disambiguated by `itemType` (`STYLE` | `RAW_MATERIAL`), a deliberate single-namespace design (so BOM lines FK to one table type-agnostically) rather than two parallel tables. The split is **enforced at the service layer** — via `findMaterialById()`/`findStyleById()` filters — everywhere except one place (see below).
- **Variant**: `ProductVariant` (Color × Size) is a real, independently-keyed entity with its own `skuCode @unique` and optional `barcode` — a genuine SKU concept, not a convention-only styleCode+suffix.
- Every enforcement point checked (**BOM lines, Purchase Order lines, Material Request lines**) correctly restricts to `itemType: RAW_MATERIAL` via `findMaterialById()`.

**Real gap found**: **Sales Order lines are never type-checked against `itemType` at all.** `createSalesOrder()` accepts `input.items[].productId` and writes it straight into the nested create with zero lookup against `Product.itemType` — the only thing preventing a raw material from being sold as a finished-goods line item is that the *UI's* product picker happens to call an endpoint that filters to `itemType: STYLE`. A direct API call (or any future internal caller) with a `RAW_MATERIAL` product id as a Sales Order line item would succeed today. Every other document type in this codebase (BOM, PO, Material Request) enforces this server-side; Sales Order is the one exception. **This should be treated as a P1 data-integrity fix**, not a P3 nicety — it's a one-line guard missing from an otherwise-consistent pattern.

A second, smaller related gap: nothing cross-validates that a `SalesOrderItemBreakdown.productVariantId` actually belongs to its sibling `SalesOrderItem.productId` — the two FKs are independently writable and could legally diverge.

**Inventory is style-level, not variant-level — the most consequential product-master finding.** `StockBalance` is keyed `(companyId, productId, warehouseId)` — there is **no `productVariantId` column anywhere in the stock ledger**. `ProductVariant` is real and correctly wired into **commercial order-taking** (Sales Order breakdown) and **pack-list labeling** (`CartonItem.productVariantId`, whose own schema comment states plainly it is "informational only... never enforced against per-variant stock"), but it carries **zero weight** for inventory truth, MRP, Production, or Dispatch stock deduction — all of these operate on the parent `Product` (style) only. A business asking "how many Red/Large units of Style X do I have in stock" cannot get that answer from this system; only an aggregate style-level count exists. This is a real architectural limitation for apparel, where color/size is usually the actual sellable/stockable unit.

**Unwired garment-attribute masters, confirmed and nuanced.** `Design`, `DesignPattern`, `Pattern`, and the raw fabric sub-masters (`FabricGsm`, `FabricWeaveType`, `FabricWidth`, `FabricComposition`) have **no FK from `Product` at all** — confirmed by direct schema read, matching the project's own acknowledgment. Nuance the project's docs miss: these fabric sub-masters *are* genuinely wired — onto `FabricRoll` (the physical roll received at Goods Receipt time), not onto the raw-material `Product` master. They are not dead CRUD tables; they're wired one level lower than the docs imply. Separately, one doc claim (`CLAUDE.md`'s note that `ProductFitting`/`ProductType` are "not yet wired") is **stale** — both are real, live FKs on `Product` as of the current schema; `Brand`, `Category`, `Season` are also correctly wired.

**Overall assessment**: the Style/Material/Variant/SKU separation is conceptually correct and mostly enforced. The two real defects are (1) the missing Sales-Order-line itemType guard, and (2) inventory truth living only at style granularity despite the app clearly modeling variant-level commerce elsewhere — a structural mismatch that will surface as a real operational problem the first time two customers order different colors of the same style against genuinely limited stock.

---

## 7. Fashion Manufacturing Lifecycle Audit

Stage-by-stage assessment, evidence-based:

| Stage | Status | Evidence |
|---|---|---|
| Design/Sampling | **Fully implemented** | `sample.service.ts` (950 lines): full 12-state machine, append-only versioning, real costing engine, Hold/Resume with exact-state restoration, self-guarded approval. |
| Product Development (Sample→Style) | **Fully implemented, one honest gap** | `convertSampleToStyle()` creates a real `Product`; the sample's own material list is **never** auto-copied into a BOM — self-documented as manual, not a silent gap. |
| BOM | **Implemented, single-level only** | `Bom`/`BomItem`, per-color lines, wastage%, duplicate/overlap validation. **No multi-level/nested BOM** — a `BomItem.materialId` can never itself be an assembly with its own BOM. Confirmed absent, not partial. |
| Fabric/Material Planning (MRP) | **Fully implemented, narrowly scoped** | `mrp.service.ts` correctly explodes BOM × color breakdown, converts UOM, nets against real stock — but is scoped to exactly one Sales Order at a time; there is no company-wide/multi-order aggregate MRP view. |
| Purchase | **Fully implemented, high quality** | Real state machine, self-approval guard, currency-safety fix already applied, cancel blocked by real receipt/invoice counts (not status labels). |
| Material Receipt (GRN + Fabric Roll) | **Fully implemented, high quality** | Per-roll `FabricRoll` tracking with GSM/Dye/Weave/Width/Composition, atomic over-receipt guards, base-UOM conversion before every ledger write, proper capped/atomic reversal. |
| Cutting | **Implemented as a generic stage, not a bespoke module** | No dedicated `cutting_plans` table exists (an earlier design sketch was deliberately superseded) — Cutting is one configurable `ProductionStage` flowing through the generic `JobOrder`/`ProductionStageTransaction` ledger. This is architecturally sound (avoids the "stage_id_1..12 wide table" anti-pattern this project explicitly studied and rejected) but means there is no cutting-specific UI/report (e.g., a marker/lay-planning screen) — a real feature gap if cutting-floor efficiency reporting is ever wanted. |
| Internal Production (stage-to-stage) | **Fully implemented** | `job-order.service.ts` (766 lines): single append-only ledger drives forward/revert; the completed+rejected+damaged≤planned invariant is enforced twice (service-layer read-verify-write **and** a Postgres CHECK constraint, confirmed present in migration SQL). |
| External Job Work | **Fully implemented, genuinely integrated** | `job-work-order.service.ts` confirmed to reuse the exact same `applyJobOrderQuantityDelta()` function internal progress entries use — receiving job-work back correctly flips the parent Job Order and unlocks its existing Forward/QC actions with zero duplicated logic. **But**: raw-material issuance to a contractor has zero stock-availability check for non-roll-tracked materials (see §10 P1), and bypasses UOM conversion entirely (see §10 P1). |
| Finishing | **Implemented generically**, same caveat as Cutting — a configurable stage, not a bespoke module. |
| Quality Control | **Fully implemented, genuinely thorough** | Real per-defect-type breakdown (`QcDefect`/`DefectType`), rework routing to an earlier stage, a specifically-fixed bug distinguishing "not yet inspected" from "not yet forwarded" to prevent double-processing. Two real P0 bugs were found and fixed in this exact function during the project's own QA pass (documented in `CLAUDE.md`) — the fact that both were caught and fixed, with regression tests, is itself evidence of a healthy process, not a red flag. |
| Packing | **Fully implemented, real hierarchy** | `Carton`/`CartonItem` genuinely support multiple cartons per dispatch with exact-quantity reconciliation across all cartons — not a flat header total. |
| Dispatch | **Fully implemented, the most rigorously built module in this audit** | See §12. |

**Production costing — genuinely absent.** Grepped the entire `production/` and `accounts/` trees for cost/rate-related terms — zero matches. No field on `ProductionOrder`, `Lot`, `JobOrder`, or `JobWorkOrder` carries any cost/rate value. The only costing-shaped code in the whole app, `cost-master.service.ts`, is a bare CRUD lookup (code/name/type/rate) that is **never referenced** by Production, Sampling, or Accounts. This stands in direct, striking contrast to Sampling, which has a complete, working, tested costing engine. **A Fashion Manufacturing ERP with a fully-built costing feature for hypothetical samples but zero costing for real production is a genuine and significant business gap** — there is no way today to know what a lot actually cost to produce, no material+labor+overhead rollup, no per-unit actual cost, and therefore no way to compute real production profitability.

**Yield/wastage/rework on actual production** — `wastagePercentage` exists only as a *planning-time* BOM field; there is no wastage/yield field anywhere on `Lot`/`JobOrder` capturing what actually happened during production. Real yield must be manually inferred from `rejectedQuantity`/`damagedQuantity` vs. `plannedQuantity` — no computed or stored yield/wastage % exists.

**Fashion-specific gaps confirmed absent**: no "Collection" concept (no model, no grouping-by-collection anywhere); no multi-level BOM; no standard-vs-actual cost distinction (compounding the absent-costing finding above).

---

## 8. BOM / Costing / Product Development Audit

Covered substantially in §7. Summary of the costing-specific picture:

| Area | Present? | Evidence |
|---|---|---|
| BOM (single-level) | Yes | `bom.service.ts`, per-color lines, wastage%, overlap validation |
| Multi-level BOM | **No** | Confirmed absent — no self-referencing/recursive structure anywhere |
| Fabric consumption | Yes | Via BOM lines + MRP explosion, UOM-converted correctly |
| Trims/accessories | Yes | Same BOM mechanism, no special-casing needed |
| Process/labor cost | **No** | Zero fields anywhere on Production models |
| Overhead | **No** | `CostMaster` lookup exists but is never consumed |
| Wastage (planning) | Yes | `BomItem.wastagePercentage`, correctly applied in MRP |
| Wastage (actual) | **No** | Nothing captures real-world wastage/yield during production |
| Standard cost | **No** | Absent |
| Actual cost | **No** | Absent |
| Sampling cost | **Yes, fully implemented** | Complete formula engine: material cost (qty×rate×(1+GST%)) + other charges → margin% → commission% → freight → final total, server-computed, reversible-locked, tested |
| Production cost | **No** | Genuinely absent, as above |
| Cost variance | **No** | Nothing to compare against, since there is no standard/actual cost at all |

**Verdict**: Costing is a genuine strength at the Sampling stage and a genuine absence at the Production stage. For a company sizing real production runs off sample costing alone, this is workable as an approximation, but it means the system cannot answer "did we actually make money on this order" once real production, labor, and rework variance are in.

---

## 9. Procurement Audit

**Classification: Strong on the goods-flow side, with two real gaps on the financial-control side.**

The Purchase Order → Goods Receipt cycle is one of the best-engineered parts of this codebase:
- Over-receipt is capped via a genuine atomic `updateMany` with the cap expressed in the `WHERE` clause (safe under concurrency).
- Cancellation is blocked by directly querying for real active receipts/invoices, never by trusting a status label (the codebase has hit and fixed this exact bug class twice before — Sampling's Hold/Resume, and this one — so the current design is a deliberate, hardened response, not luck).
- Fabric roll tracking is genuinely per-physical-roll, with correct base-UOM conversion applied before anything reaches the ledger.
- `PurchaseRequest`/`PurchaseRequestItem` were built, then **deliberately and cleanly removed** the same day in favor of `MaterialRequest` after a re-analysis found it conflated Inventory's and Purchasing's responsibilities — confirmed the old models genuinely no longer exist in the schema (a real example of the project course-correcting itself rather than leaving a legacy half-feature in place).

**Real gaps:**
- **No supplier ledger / outstanding-balance query exists anywhere.** There is no "how much do we owe Supplier X across all invoices minus payments" report, function, or endpoint. A user must open every Purchase Invoice individually to see its own balance. This is a basic AP-operations capability missing outright.
- **The 3-way match (PO ↔ GRN ↔ Purchase Invoice) only checks quantity, not price.** Quantity is genuinely, atomically capped against received-but-not-yet-invoiced quantity (raw-SQL guard, correctly used because it needs a column-to-column comparison Prisma can't express). But **`buildInvoiceItems()` never compares the invoice's `unitPrice` against the PO's agreed `unitPrice`** — a Purchase Invoice can be posted at any price for a quantity-capped line, with no variance check or approval gate. This is a real, exploitable-by-mistake gap in financial control (accidental or fraudulent overbilling would sail through unchecked).
- Return-to-supplier is real but stock-only — no supplier credit note / AP reduction is created (explicitly scoped this way, deferred to Accounts, not a bug).

---

## 10. Inventory Audit

**Classification: Unsafe in specific, identifiable flows — the single most important finding of this audit.**

**What is genuinely solid**: `recordInventoryTransaction()` is a real, disciplined single choke point. Every one of the 12 real call sites found across the entire codebase (Goods Receipt ×3, Stock Movement ×4, Material Request issue, Production receipt/damage ×2, Job Work issue, Dispatch confirm) passes a `tx` parameter that is provably the same transaction as the surrounding write — there is no code path where the stock ledger and the `StockBalance` cache can observably disagree due to a split-transaction bug. A project-wide grep for any direct `stockBalance.update`/`upsert` call outside the one repository function that `recordInventoryTransaction` itself uses returns **zero matches** — nothing bypasses the ledger. This is exactly the architecture the project's own docs claim, and it holds up under direct inspection.

**What is genuinely broken — three P1 findings:**

1. **Negative stock is reachable under concurrency in three separate flows.** `StockBalanceRepository.upsertIncrement` has no floor guard at all — nothing stops `quantityOnHand` from going negative at the database level. The only defense in Material Request issue, Stock Movement (Transfer/Return/negative Adjustment), and Dispatch confirmation is an **availability check performed before the transaction opens** — not an atomic, in-transaction guard like every *other* accumulator in this codebase correctly uses (PO received/invoiced, MR issued-vs-requested, FabricRoll remaining all use a proper `updateMany`-with-cap-in-WHERE or raw-SQL column comparison). Two concurrent requests against the same product+warehouse — two Material Request issues, or an issue racing a Transfer-out — can both pass the pre-check and both post negative-going entries. The code's own comments concede this is a deliberate "low-frequency manual action" tradeoff — but it is still a live, unmitigated race in exactly the class of guard this project otherwise gets right everywhere else.
2. **External Job Work's raw-material issuance has *no* stock check whatsoever for non-fabric-roll materials.** A guard exists only when a `fabricRollId` is supplied; for a plain trim/button/non-roll material, `recordInventoryTransaction` is called unconditionally with a negative quantity — not a race, an outright missing check. This can drive stock arbitrarily negative with a single ordinary request, no concurrency required.
3. **Stock Movement and External Job Work both bypass UOM conversion entirely**, unlike every other module that writes to the ledger. `convertUomQuantity()` is correctly called by Purchase Order (validation), Goods Receipt (conversion), and Material Request (validation + conversion) — but never by Stock Movement or Job Work Order. If a user picks a non-base unit on either of these two document types, the raw as-entered number is posted straight into `StockBalance`/`InventoryTransaction`, silently corrupting the ledger against every other module's base-UOM assumption.

**Other confirmed gaps:**
- **No opening-stock entry point exists.** `OPENING_BALANCE` is a reserved enum value with zero real code path constructing it — a new company onboarding onto this system has no way to enter its starting inventory; every warehouse starts at implicit, unconfigurable zero.
- **No physical stock count / cycle count feature exists at all** — no model, no service, no UI.
- **No stock valuation.** `StockBalance` and `InventoryTransaction` carry quantity only — no cost/value field anywhere. There is no FIFO/weighted-average/standard-cost engine, so this system cannot report the ₹/$ value of on-hand inventory, cannot compute COGS from actual inventory movement (COGS is instead posted as a flat debit at Purchase Invoice time, a P&L-side entry unrelated to what's actually consumed from stock), and has no basis for an inventory line on a real balance sheet.

**Verdict**: the architecture is right and the majority of guards are correctly atomic. But three concrete, fixable defects (unguarded negative-stock races in 3 flows, a wholly unguarded Job Work issue path, and UOM-conversion bypass in 2 modules) mean the honest answer to "can this system maintain correct inventory quantities under real business workflows" is **not yet, in these specific paths** — and the absence of stock valuation is a separate, larger gap for anything beyond quantity tracking.

---

## 11. Sales Audit

**Classification: Strong workflow engineering, missing several standard commercial features.**

Genuinely solid: the sample-approval gate on order confirmation is real and correctly re-applied on edit-of-a-confirmed-order (closing the obvious "edit around the gate" hole); currency is deliberately and correctly forced to the company's base currency (a proactive fix applied after a real bug was found on Sales Order and never repeated); variant×qty breakdown is real, not flattened; Hold/Resume restores the exact prior status; edit-after-confirm rules correctly tighten once Dispatch or an active Invoice exists.

**Missing standard commercial capabilities, all confirmed absent by direct grep:**
- **No Sales Quotation / pre-order document** — the flow jumps directly from nothing (or an optional CRM Deal, which has no line items of its own) to a `DRAFT` Sales Order. There is no formal proforma/quotation artifact distinct from the order itself.
- **No discounts anywhere** in the pricing model — total is strictly `unitPrice × quantity`, no discount line, percentage, or amount field exists on any sales document.
- **`Customer.creditLimit` is a dead field.** It exists in the schema and is settable via the Customer form, but is **never read** by `createSalesOrder` or `confirmSalesOrder` — it has zero enforcement anywhere. This is worse than "not implemented" — it actively misleads a user who sets a credit limit into believing it does something.
- **No backorder concept** — Sales Order confirmation never checks finished-goods stock availability at all; the only "remaining" tracking that exists is the dispatch-side accumulator, not a stock-shortage/backorder workflow.

---

## 12. Dispatch Audit

**Classification: The most rigorously engineered module found in this audit.**

Verified directly, not merely asserted:
- **Over-dispatch is prevented at two independent layers**: a soft pre-check at create/update time, and a genuinely atomic, race-safe guarded `updateMany` at confirm time (re-reads live ordered-vs-dispatched totals inside the transaction) — with a dedicated regression test specifically exercising the race ("the guarded-increment cap rejects if the order's remaining quantity changed underneath it").
- **Warehouse stock deduction happens only at Confirm (PACKED→DISPATCHED), never at Draft or Packed** — the correct point, confirmed by direct code read.
- **Multiple dispatches against one Sales Order are genuinely supported**, with cumulative dispatched quantity correctly netted across all of them (not just within one dispatch document), and `PARTIALLY_DISPATCHED` is a first-class eligible starting status for a second dispatch.
- **Carton/box-level packing is a real hierarchy**, not a flat total — `markPacked()` validates that summed carton-item quantities across *all* cartons exactly equal each dispatch line's quantity, a genuine per-line reconciliation, test-covered for the multi-carton case.
- **Cancellation is defended by an independent, unconditional check on whether `dispatchedAt` is set** — not derived from the status label alone — explicitly built to defend against the exact "Hold/Resume bypasses a terminal-state guard" bug class this project has hit twice before in other modules, with its own dedicated regression test.
- Company isolation confirmed on every route sampled; document numbering (`DSP-2026-00001`) confirmed correct.

**Two real, smaller gaps**: stock deduction happens at the **product (style) level**, not per-variant, even though `CartonItem` captures real color/size detail (a direct consequence of §6's finding that `StockBalance` has no variant dimension at all — Dispatch didn't create this limitation, it inherited it). Shipment tracking (`transporterName`/`vehicleNumber`/`trackingNumber`) is free-text capture only — no carrier master, no tracking-number validation, no external carrier API integration.

---

## 13. Accounting & Finance Audit

**Classification: A genuinely solid double-entry core wrapped around a materially incomplete financial-reporting and correction layer.**

**What is production-grade:**
- Every posting path (Sales Invoice, Purchase Invoice, Payment, Expense) funnels through one shared `postJournalCore()` that re-aggregates debit/credit totals from a **fresh server-side read** of the actual `JournalLine` rows and hard-rejects an unbalanced journal before any `POSTED` write — never trusting a client-submitted total. This is real, verified double-entry integrity, not decorative.
- A hand-added Postgres CHECK constraint independently backstops the debit/credit exclusivity rule at the database level.
- Over-payment and over-invoice guards are genuinely atomic (guarded `updateMany`).

**What is materially incomplete:**
- **Chart of Accounts hierarchy is schema-only.** `parentAccountId` exists and is settable, but the Trial Balance and every ledger aggregate group strictly by leaf `accountId` — there is **no rollup of child accounts into a parent group total anywhere**. A real "Total Current Assets" figure cannot be produced by this system today.
- **No reversal/correction path for any of the four transaction-generating document types.** `reverseJournal()` explicitly and unconditionally blocks reversing a journal sourced from Payment, Sales Invoice, Purchase Invoice, or Expense — only a manually-created journal can be reversed. A found-and-verified **factual contradiction**: `sales-invoice.service.ts`'s own code comment claims "its auto-generated Journal can still be reversed via the Journal UI if a correction is needed" — this is **false**, contradicted directly by `reverseJournal()`'s own guard. This means a posted Sales Invoice, Purchase Invoice, Payment, or Expense is **functionally uncorrectable** today except via an ad hoc manual adjusting journal that will not update the originating document's own status/amount fields, leaving them out of sync with the "corrected" ledger.
- **No Credit Note / Debit Note model or workflow exists at all** — confirmed by an exhaustive schema-wide grep.
- **No real P&L or Balance Sheet.** Only a flat Trial Balance and a per-account running Ledger exist; grepped both the module and the dashboard route tree for "profit and loss"/"balance sheet" — zero matches.
- **No fiscal-period closing.** Nothing anywhere prevents a user from posting a journal, invoice, payment, or expense dated into an already-"closed" prior period, because no closing concept exists to enforce against.
- **Multi-currency is schema-present but functionally inert.** Every real code path that sets `exchangeRate` hardcodes `1`; no FX conversion math exists anywhere in the codebase. This is not "deferred UI on top of working logic" — the underlying logic itself has never been exercised with a real non-1 rate.
- **Tax is manual-only, no HSN-based auto-inference** — confirmed still accurate; `hsnSacCode` exists on `Product` but has zero relation to `TaxRate`/`TaxType`.
- **TDS is completely absent** — not a single field, comment, or trace anywhere in the schema or code, consistent with the project's explicit choice not to build unconfirmed compliance features.

**Verdict**: the ledger-integrity core (the part that would be catastrophic to get wrong) is genuinely well-built. The parts a real accounts team needs day-to-day — correcting a posted document, seeing real financial statements, closing a period, and rolling up an account hierarchy — are not there. This is squarely "a partial slice," not production-grade accounting, exactly the honest framing the audit brief asked for rather than crediting it because journal-balancing is solid.

---

## 14. HRMS Audit

**Classification: What exists is real; most of what a garment factory needs to run HR is absent by explicit, documented scope decision.**

**Implemented and genuinely working**: Attendance (per-employee, per-shift lateness computed against that employee's own actual shift start time, not a hardcoded company-wide cutoff — a real improvement over the reference system this was modeled from), Leave (full request→approve/reject workflow with a real computed leave-balance ledger that blocks over-quota approval), shift assignment (`Employee.shiftId` genuinely wired, not schema-only), holiday-calendar CRUD.

**One integration gap found**: `HolidayMaster` is a standalone CRUD table only — it is **never consulted** by attendance lateness computation or leave-balance math. A garment factory's holiday calendar exists in the system but does nothing; working-day calculations don't account for it.

**Confirmed absent, by explicit and accurately-documented scope decision**: Payroll, salary structure, deductions, PF/ESIC statutory computation, loans/advances, employee documents, performance/KPI, recruitment, self-service portal. `CLAUDE.md` states these were user-approved exclusions, and that framing is accurate and current. **However**, stated bluntly per the audit brief's own instruction not to soften findings for "planned" items: **a real Indian garment factory cannot actually run its HR/payroll operations on this system today** — it can track attendance and leave, and nothing else. Whether that matters depends entirely on whether this business intends to run payroll through this ERP or a separate system; if the former is ever assumed, this is a hard blocker, not a nice-to-have.

---

## 15. Reporting & MIS Audit

**Classification: The weakest area of the entire system relative to what "run the business" implies.**

This section demands the bluntest finding in the audit: **of everything under the dashboard route tree, only two pages are genuine management dashboards with real aggregation and charts (CRM Dashboard, Marketing Dashboard) — and both belong to the CRM/Marketing side-initiative, not the core 11-phase ERP roadmap.** Trial Balance and Account Ledger are legitimate financial aggregates but are UX-thin (no filters or pagination on Trial Balance at all, no export on either, and Account Ledger renders its entire unbounded result set client-side with no pagination — a real scale risk for a busy account).

**Everything else — Sales Orders, Purchase Orders, Sampling, Material Requests, Production Orders, Goods Receipts, Buyer Enquiries, Dispatch, Sales/Purchase Invoices, Payments, Expenses, Journals, Campaigns — is a paginated CRUD list**, not a report. A search box and status filter is not a management report.

**Confirmed to not exist anywhere in the codebase**: a stock-aging report, a production efficiency/wastage/rejection-rate dashboard, a receivables/payables aging report, a product/style profitability report, any cross-module KPI dashboard. The main landing dashboard (`/dashboard`) is a literal placeholder — five flat entity counts with an in-app disclaimer that Sampling/Production/Accounts/Dispatch KPIs "will appear here as those modules go live" — and `CLAUDE.md` itself independently confirms Phase 9 (Reports) has **not started**, so this matches the roadmap's own honest status exactly, not a doc/code mismatch.

**The one genuine bright spot**: the Job Work Orders worklist doubles credibly as an operational report — it carries computed pending-quantity/days-elapsed/overdue columns, a real filter, and a real Excel export. This is the pattern the rest of the system's "reports" should follow, and currently doesn't.

**Export surface area, confirmed exhaustively**: exactly three server-generated Excel exports exist in the whole system (Products, Stock Balances, Job Work Orders — all from the most recent gap-filling pass), plus one CSV-based export in Marketing Channel Performance. No other document type has any export at all.

---

## 16. RBAC & Security Audit

**Classification: Mature RBAC model, several concrete hardening gaps.**

RBAC itself (23 modules × 10 actions × 13 roles, `src/config/rbac.ts`) is thoughtfully modeled — the `masters_core`/`masters_finance` split specifically to keep floor/warehouse roles off financial masters, VIEWER programmatically limited to view-only across every module (verified, not just claimed), and a genuine segregation-of-duties mechanism (`SELF_APPROVAL_GUARDED_ACTIONS`) applied consistently across 9 of 10 approve/post checkpoints found. `PermissionService` is a real server-side gate that cannot be bypassed from the client. Every one of the 7 API routes found lacking an explicit `PermissionService.assert()` call was individually verified to be justified (self-scoped, delegated into the service layer, or a legitimate any-authenticated-user lookup) — no "forgot the permission check" gap was found.

**Concrete gaps:**
- The one leave-approval self-approval gap noted in §4.
- **2FA is purely aspirational.** `User.mfaSecret` exists as a schema column with zero supporting code anywhere — no service, no UI, no auth-flow logic. Confirmed by a codebase-wide grep for TOTP/2FA-related terms returning zero hits outside documentation. The project's own `ARCHITECTURE_REVIEW.md` independently flags this as a stated MVP requirement for financial/admin roles that was never implemented — worth stating unambiguously since money-handling roles are explicitly the ones this was meant to protect.
- **A docs-vs-code contradiction on session architecture**: `CLAUDE.md` describes the target as DB sessions with `sameSite=strict` cookies; the actual, current implementation uses stateless JWT sessions with NextAuth's un-overridden default cookie settings (`sameSite: "lax"`, `secure` conditional on detected HTTPS). Not inherently insecure, but there is no server-side session-invalidation/force-logout mechanism as a consequence, and the documentation should either match the code or the code should be brought in line with the documented architecture.
- **No HSTS, no Content-Security-Policy.** `next.config.ts` sets `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` — a reasonable baseline — but nothing forces HTTPS on repeat visits, and there is no XSS blast-radius reduction via CSP.
- **No explicit CSRF token scheme for the ~280 mutating API routes.** The app relies entirely on SameSite-cookie + JSON-only-body behavior as implicit CSRF defense — common and generally adequate for a same-origin app, but not an *explicit* control, and worth stating plainly since the audit brief specifically asked about CSRF.
- **Rate limiting exists only on login.** No other route — including high-value write endpoints like creating a Sales Order or posting a Journal — has any rate limiting. The login limiter itself is per-account, in-memory, single-instance-only (self-documented, would silently multiply its effective attempt budget across a horizontally-scaled deployment).
- File upload security is genuinely solid: MIME allow-list, 20MB cap, server-generated random storage keys (traversal-safe), storage kept outside `public/`, every read/write path company-scoped.
- The one raw-SQL usage in the entire codebase is correctly parameterized via Prisma's tagged-template form (not string concatenation) — no SQL injection risk found anywhere.

---

## 17. Data Integrity Audit

Covered in depth across §10 (Inventory) and §13 (Accounting). Additional findings:

- **Soft-delete convention is genuinely enforced, not just documented.** Every DELETE route in the entire API (11 total) was checked — each is either a genuine master or a legitimately-deletable child artifact (a file attachment). **No DELETE route exists for any transactional header/line table** (Sales Order, Purchase Order, Material Request, Job Order, Inventory Transaction, Journal, or any of their siblings) — the "financial/inventory transactional tables never delete" rule from the project's own stated architecture is actually followed in the routing layer, confirmed by direct inspection, not assumed from a comment.
- **CHECK constraints are present and confirmed current**: the job-order quantity-consistency invariant, the journal-line debit/credit mutual-exclusivity constraint, the payment-allocation exactly-one-of constraint, and several `amount = subtotal + tax` invariants across Expense/Purchase Invoice/Dispatch — all verified present in their respective migration SQL files.
- **One live naming-convention break**: `SampleRequest.sampleType` is missing its `@map`, so the actual live database column is camelCase (`sampleType`) while literally every sibling field on the same table is snake_case. Confirmed in the actual migration SQL, not just the schema file. Cosmetic (Prisma round-trips it fine via quoted identifiers), but a real inconsistency any external tool or raw-SQL consumer would trip on.
- **One indexing inconsistency**: `SalesOrder` has no `@@index([companyId, status])` or `@@index([companyId, customerId])`, unlike its direct sibling `PurchaseOrder`, which has both. Given a Sales Orders worklist almost certainly filters by status, this is a real, cheap-to-fix gap.

---

## 18. Audit Trail Audit

**Classification: Consistent and genuinely working.**

`AuditLog` writes were spot-verified end-to-end during this project's own development (per `CLAUDE.md`'s documented verification passes — created a record through the real UI, queried `audit_logs` directly, confirmed the correct `userId`/`companyId`/`tableName`/`newValues` snapshot). The self-approval-guard mechanism doubles as a "who approved" control on top of "who created"/"who modified," and status-transition functions across every module checked (Sales Order, Purchase Order, Material Request, Dispatch, Journal) consistently log old/new values on state changes. No module was found silently skipping audit logging on a state-changing action during this pass's sampling.

---

## 19. API Architecture Audit

**Classification: Consistent and well-structured, with two real gaps.**

280 of 281 total route files live under the stated `/api/v1/` convention (the one exception is NextAuth's own required framework route, a legitimate exception). Error handling funnels through one shared `handleApiError()`/`BusinessRuleError` hierarchy with 25 well-defined codes and a sensible HTTP-status mapping (409 for conflicts, 400 for validation, 403 for permission, 404 for not-found, 502 for the one external-integration-failure case). Pagination/sorting is consistently built on a shared `parseListQuery()` helper — worklist-style modules (Sampling, Material Request) correctly *extend* it with domain-specific filters rather than reinventing it, a genuine consistency finding, not a divergence. N+1 query risk is low: only two narrow, bounded per-row query patterns were found in the entire codebase (a campaign-metrics aggregation and a single-document detail-page availability lookup), neither in a list endpoint. No duplicate/overlapping endpoints were found across all 280 routes.

**Real gaps**: **no OpenAPI/Swagger specification or generated API docs exist anywhere** — a real barrier to a future mobile app or third-party integration being built against this API without reverse-engineering it from the route files. **Rate limiting exists only on the login route** — every other one of the ~280 API routes, including high-value writes, has zero throttling.

---

## 20. Database Architecture Audit

**Classification: Well-organized, with minor, fixable inconsistencies.**

117 models, 61 enums, 4,201 lines. UUID primary keys are effectively universal (the one exception, `Currency.code` as a natural ISO key, is a deliberate and reasonable design choice, not an oversight). snake_case-via-`@map` is applied to 1,057 of 1,058 mappable scalar fields — the one exception (`SampleRequest.sampleType`) is documented in §17. Indexing is generally deliberate and good, with the one `SalesOrder` gap noted in §17. 43 real migrations exist; `npx prisma migrate status` confirms no drift/corruption in the migration history (only a "one migration not yet applied to this sandbox's DB" state, an environment fact, not a project defect) — roughly a third of the migrations were hand-authored via the project's own documented non-interactive-shell workaround, which is an honestly-managed process limitation, not silent tooling drift. Hand-added CHECK constraints and the two deliberate, narrowly-scoped raw-SQL guards are all confirmed present and correctly justified (Prisma cannot express a column-to-column comparison in `updateMany`). No partitioning, archiving, or retention strategy exists for any of the four fastest-growing append-only tables (`InventoryTransaction`, `AuditLog`, `ProductionStageTransaction`, `JournalLine`) — not urgent at current data volumes, but a real item for a growth-stage roadmap once real transaction volume accumulates.

---

## 21. Frontend / UX Audit

**Classification: Functionally consistent for a desktop power-user tool; several real usability gaps.**

The shared UI primitives (`DataTable`, `Modal`, `ConfirmModal`, `ToggleSwitch`, `FilePreviewModal`, `Breadcrumb`, `FormField`) are genuinely reusable and widely reused, not one-off. The Server-Component-page + Client-Component-panel pattern (with the `key={id}`-forced-remount fix applied project-wide after a real stale-navigation bug was found) is consistently followed across every module checked, old and new alike — this is evidence of a real, disciplined convention, not accidental consistency.

**Real, concrete gaps:**
- **A genuine inconsistency in destructive-action confirmation**: `SalesOrderWorkflowPanel`'s "Cancel Order" button fires immediately on click with no `ConfirmModal`, while the equivalent Cancel action in Production Orders, Dispatch, and Journals all correctly gate behind a confirmation dialog. This is a real, user-facing risk (an accidental click cancels a live Sales Order with zero friction) and a one-line-scale fix.
- **No bulk actions exist anywhere** except one bespoke checkbox-selection flow on the BOM/MRP shortfall page. Every `DataTable`-based list — the large majority of the app — has no multi-row selection at all.
- **This is a desktop-only UI in practice.** Only 8.6% of page components use any responsive Tailwind prefix at all, and the dashboard shell renders a fixed-width, non-collapsible sidebar with no mobile navigation pattern. Fine for a back-office ERP used at a desk; a real limitation if any floor-level tablet/phone usage is ever expected (e.g., a QC inspector or dispatch clerk on a handheld device).
- **The sidebar is a flat, ungrouped list of 26 links** with no section headers separating core ERP modules from CRM/Marketing/HRMS — a real information-architecture weakness at this module count, though not a functional defect.
- **No skeleton loading states anywhere** — every loading state is plain "Loading…" text, consistent but visually unpolished.
- One `/reports` sidebar link points at a route that does not appear to exist in the current page tree — worth verifying and either building or removing before shipping the sidebar as-is.

For a straightforward transactional workflow (create → confirm → verify on list), the click count is reasonable — three page navigations plus one form submission plus one in-place confirm action, no wasted intermediate steps.

---

## 22. Performance & Scalability Audit

No load testing was performed (out of scope for a code audit); the following is architectural inference from the evidence above.

- **10 companies**: no issues expected. Current indexing, pagination, and query patterns comfortably handle this scale.
- **50 companies**: still comfortable on the transactional tables given per-company partitioning via `companyId` filters and existing indexes; the two identified indexing gaps (SalesOrder status/customer) would start to show as measurable, not yet painful, list-page latency.
- **100 companies**: the un-paginated Account Ledger and Trial Balance pages (client-side rendering of the *entire* unbounded result set) become a genuine risk for any single company with a busy ledger — this is a page-level defect independent of overall company count, and would surface at 100 companies mainly because more companies means more chance one of them has a genuinely large ledger.
- **500+ companies**: the lack of any partitioning/archiving strategy on `InventoryTransaction`, `AuditLog`, `ProductionStageTransaction`, and `JournalLine` becomes a real concern — these are unbounded, ever-growing, append-only tables with no TTL, rollup, or cold-storage plan. Query latency on these tables specifically (not the rest of the schema) is where scaling problems will first appear, since every other transactional table has a natural document lifecycle that keeps its row count roughly proportional to business activity, not to elapsed time. The single-instance, in-memory rate limiter and `PermissionService` cache would also need to move to a shared backend (Redis or similar) the moment this app is horizontally scaled across more than one process — both are self-documented as single-instance-only today.

---

## 23. Testing Audit

**Classification: Real where it exists, and it skips some of the most consequential code in the system.**

31 test files, 310 passing tests, all Vitest, all service-layer unit tests with fully mocked dependencies (`vi.mock` on the Prisma client, repositories, and cross-cutting services) — **zero tests touch a real database**, and **zero `.test.tsx`/component tests exist anywhere** (the Vitest environment is configured `node`, not `jsdom`, so a component test couldn't even run today without additional setup). **Zero API-route/integration tests exist** — every test exercises a service function directly, never an actual HTTP request/response cycle.

Where tests exist, they are genuinely good — not rubber-stamp happy-path-only coverage. Dispatch and Journal both have dedicated regression tests specifically targeting known race-condition/bug classes (a guarded-increment race, a Hold/Resume-bypasses-cancel-guard scenario) rather than just re-testing the happy path.

**The real problem is coverage, not quality.** Diffing the full service-file list against the test-file list finds **zero test coverage** for: `sales-order.service.ts` (a core Phase 5A module), `production-order.service.ts`, `bom.service.ts` and `mrp.service.ts` (the entire BOM/MRP explosion engine), `purchase-order.service.ts` and `goods-receipt.service.ts` (the PO/receiving cycle this project's own docs single out as needing correctness rigor), `chart-of-account.service.ts`, `tax-config.service.ts`, and — most notably — **`inventory.service.ts` itself, the core stock-ledger engine that every other module trusts.** Its downstream consumers (`material-request.service.ts`, `stock-movement.service.ts`) are tested; the ledger engine underneath them is not. Given §10's findings of real unguarded/race-prone paths in exactly this area, the absence of tests here is not a coverage nitpick — it's the gap most directly connected to this audit's most serious finding.

---

## 24. Production Readiness Audit

**Classification: Not ready for a real production deployment without closing several concrete gaps.**

- **`.env.example`** covers the essentials (DB URL, auth secret/URL) but has **no production file-storage variable at all** (no S3/Blob/GCS option, not even as a commented-out placeholder) and **no error-tracking DSN** — nothing to plug in even if observability were added later without a code change.
- **CI runs lint/typecheck/test/build on every push, but never against a real database** — no Postgres service container is defined in the workflow, so migrations are never actually exercised in CI, and the fully-mocked test suite means the DB layer is never tested there either. **There is no CD step at all** — deployment is entirely manual and undocumented in this repository.
- **No structured logging exists anywhere.** The entire backend error-observability story is a single `console.error()` call inside the shared error handler — confirmed to be the only logging call site in the entire `src/` tree. This matches the project's own explicit, documented deferral (Phase E), so it is a known and honestly-tracked gap, not a surprise — but it is a real production blocker regardless of whether it was planned.
- **No health-check endpoint exists** — flagged by the project's own architecture review and never subsequently closed.
- **No backup/disaster-recovery plan or tooling exists** — explicitly scheduled for a future hardening phase that has not started; expected at this project stage, not a surprise finding.
- **File storage is local-disk-only**, with the code's own doc comment acknowledging it needs to be swapped for an S3-compatible client before any real deployment — confirmed no cloud-storage adapter code exists anywhere. This will not survive a container restart or any horizontal scaling.
- **2FA, HSTS/CSP, and multi-instance rate limiting** are all real gaps for a production financial system, detailed in §16.

---

## 25. Business Completeness Score

Scores reflect Database + Business Logic + API + UI + Permissions + Validation + Audit + Reporting + Tests + Integration jointly, not module existence alone.

| Area | Score | Evidence basis |
|---:|---:|---|
| Multi-Company | 85 | Company-boundary enforcement is real and consistently applied at every layer checked; two historical bugs were found and genuinely fixed; the one open item (`UserBranchRole`) is unexploitable today. |
| Multi-Branch | 40 | Schema-correct, but `branchId` is pure metadata everywhere — zero access-control enforcement exists at the branch level, by explicit design deferral. |
| Multi-Warehouse | 80 | Genuinely enforced at the one true stock-write chokepoint; Transfer between warehouses is real and atomic. |
| Product / Fashion Master | 65 | Style/Material/Variant/SKU are conceptually correct and mostly enforced, but the missing Sales-Order itemType guard and the style-only (non-variant) inventory-truth limitation are real, consequential gaps. |
| Sampling | 90 | The single most complete, most rigorously built module in the entire system — full lifecycle, real costing, thorough testing of its formulas. |
| BOM | 55 | Solid single-level implementation; multi-level BOM is entirely absent, a real limitation for any style with sub-assemblies. |
| Costing | 35 | Excellent at Sampling; genuinely absent at actual Production — the average across the two stages a "production costing" score must reflect is low. |
| Procurement | 75 | Excellent goods-flow engineering; missing supplier ledger and price-side 3-way match are real financial-control gaps. |
| Inventory | 45 | Sound single-choke-point architecture undermined by three concrete, identified P1 correctness defects (negative-stock races, an unguarded Job-Work issue path, UOM-conversion bypass) plus the total absence of stock valuation. |
| Manufacturing | 70 | Stage flow, split/merge, and QC are all genuinely well-built and tested; costing and yield/wastage tracking on real production are absent. |
| Job Work | 80 | Genuinely well-integrated (reuses the core JobOrder engine correctly), but shares Inventory's UOM-bypass and unguarded-issue defects. |
| Quality Control | 80 | Thorough defect-type tracking and rework routing; two real bugs were found and fixed with regression tests during the project's own QA pass — a healthy sign, not a red flag. |
| Sales | 65 | Strong workflow guards; missing Quotation, discounts, backorder, and a dead (never-enforced) credit-limit field are real commercial-completeness gaps. |
| Dispatch | 88 | The most rigorously engineered module audited — real race-safe guards, genuine carton hierarchy, correct stock-deduction timing, dedicated regression tests for known bug classes. |
| Accounting | 50 | Double-entry integrity is genuinely production-grade; the absence of real financial statements, any correction/reversal path for the four main document types, period closing, and account-hierarchy rollup make the module as a whole a partial slice. |
| HRMS | 30 | Attendance/Leave are real and working; everything else a factory needs to run HR (payroll, PF/ESIC, documents) is absent by explicit scope decision — accurate scoring for what exists today, independent of intent. |
| Reporting | 20 | The weakest area in the whole audit — almost no real cross-module management reporting exists for the core ERP; the two genuine dashboards belong to the CRM/Marketing side-initiative, not the manufacturing ERP itself. |
| RBAC | 82 | Mature, consistently enforced, thoughtfully modeled; one real self-approval gap (leave) and one unexploitable-today landmine (`UserBranchRole`). |
| Security | 60 | Solid file-upload/raw-SQL/rate-limiter-for-login hygiene; 2FA is dead schema, no CSP/HSTS, no explicit CSRF tokens, JWT-vs-documented-DB-session mismatch, and rate limiting is login-only. |
| API | 78 | Consistent structure, good error taxonomy, low N+1 risk, no duplicate endpoints; missing OpenAPI docs and rate limiting beyond login. |
| Database | 85 | Well-organized, 117 models with disciplined conventions, real CHECK constraints, genuinely-enforced soft-delete rules; two small, fixable inconsistencies found. |
| UX | 60 | Consistent core patterns and reusable primitives; real gaps in confirmation consistency, bulk actions, responsiveness, and navigation grouping. |
| Performance | 65 | No load-tested defects found; architectural risk is specifically the unbounded ledger tables and the two un-paginated financial-report pages, not the system broadly. |
| Testing | 45 | Genuinely good test quality where it exists; genuinely serious coverage gaps in exactly the modules (Sales Order, BOM/MRP, PO/GRN, the core inventory ledger) where correctness matters most. |
| Production Readiness | 30 | No logging, no health check, no CD, local-only file storage, no 2FA, single-instance rate limiter/cache — a real, non-trivial list of production blockers, several self-acknowledged and scheduled but none yet closed. |

---

## 26. Critical Gap Matrix

| Priority | Gap | Business Impact | Technical Impact | Current State | Recommendation |
|---|---|---|---|---|---|
| **P0** | Negative-stock races in Material Request issue, Stock Movement, and Dispatch confirm (read-then-write availability checks, no atomic in-transaction cap) | Warehouse stock can go negative under real concurrent usage, corrupting every downstream MRP/dispatch decision that trusts `StockBalance` | Requires converting three pre-transaction checks into atomic guarded `updateMany`/raw-SQL patterns, matching the idiom already correctly used elsewhere in the same codebase | Confirmed via direct code read across all three services | Fix before production use at any real transaction volume — this is a data-integrity defect, not a hardening nicety |
| **P0** | External Job Work raw-material issuance has zero stock-availability check for non-fabric-roll materials | A single ordinary request (no concurrency needed) can drive stock arbitrarily negative | One missing `getAvailableQuantity` pre-check plus the same atomic-guard fix as above | Confirmed by direct code read — no guard of any kind exists today | Fix immediately; this is the single easiest-to-trigger data-integrity bug found in the audit |
| **P0** | Stock Movement and Job Work Order bypass UOM conversion entirely | A user selecting a non-base unit silently corrupts the shared stock ledger against every other module's base-UOM assumption | Add `convertUomQuantity()` calls matching the pattern already correct in Purchase Order/Goods Receipt/Material Request | Confirmed absent by grep — these are the only two ledger-writing modules that skip it | Fix before these two document types see real multi-unit usage |
| **P0** | Sales Order line items are never validated against `itemType` | A raw material can be sold as a finished-goods line via direct API use (UI-only guard today) | Add the same `findMaterialById`/`findStyleById` guard already used consistently everywhere else in the codebase | Confirmed absent by direct code read | One-line-scale fix, high consequence if missed |
| **P1** | No production costing anywhere (material+labor+overhead → per-unit/per-lot actual cost) | The system cannot tell you what a production run actually cost, or whether an order was profitable | Requires new schema fields on Lot/JobOrder plus a costing-rollup service, mirroring the already-built Sampling costing engine's structure | Confirmed genuinely absent — zero cost fields exist on any Production model | Design and build before this system is trusted for real margin decisions |
| **P1** | Inventory truth is style-level only; `ProductVariant` carries zero weight in `StockBalance`/MRP/Dispatch stock deduction | Cannot answer "how much of color/size X is in stock" — a basic apparel-business question | Would require adding a variant dimension to `StockBalance` and propagating it through every ledger-writing service — a substantial, cross-cutting change | Confirmed architecturally, not a bug to patch, a design decision to revisit | Scope as a deliberate roadmap item, not a quick fix; decide now whether this business genuinely needs variant-level stock before more is built on top of style-level assumptions |
| **P1** | No supplier ledger / outstanding-balance report | Accounts staff cannot see "what do we owe Supplier X" without opening every invoice individually | New aggregate query/report over Purchase Invoice + Payment Allocation | Confirmed absent by exhaustive grep | Needed for any real AP operation at more than a handful of suppliers |
| **P1** | Purchase Invoice price is never cross-validated against the PO's agreed price (3-way match is quantity-only) | Overbilling (accidental or fraudulent) is not caught by the system | Add a price-variance check/tolerance/approval gate at invoice creation | Confirmed absent — quantity is atomically capped, price is not checked at all | Real financial-control gap, should be closed before this module is trusted for supplier billing |
| **P1** | No reversal/correction path for posted Sales Invoice, Purchase Invoice, Payment, or Expense; no Credit/Debit Note workflow | Any mistake in a posted financial document requires an ad hoc manual journal that will desync the document's own status from the "corrected" ledger | Build a proper Credit Note/Debit Note document type, or a document-aware reversal that also resets the originating document's accumulators | Confirmed absent; a stale code comment in `sales-invoice.service.ts` incorrectly claims a reversal path exists | Needed before this system handles real invoice corrections/returns at any volume |
| **P1** | No real P&L, Balance Sheet, or account-hierarchy rollup | Management cannot get standard financial statements out of the system at all | Build on top of the existing, correctly-balanced Journal/ChartOfAccount data — the ledger integrity underneath this is already sound | Confirmed: Trial Balance (flat) and per-account Ledger only | Scheduled per the project's own Phase 9/roadmap; treat as a real go-live blocker if this system is meant to be the company's sole book of record |
| **P1** | No fiscal-period closing | Nothing prevents back-dated postings into an already-reported-on period | Add a `FiscalPeriod`/period-lock concept checked at every posting path | Confirmed absent | Needed before this system is relied on for compliant, audit-safe books |
| **P1** | Reporting/MIS is almost entirely absent for the core ERP (no stock aging, no production efficiency, no AR/AP aging, no profitability) | Management cannot actually run the business from this system today, only record transactions in it | Build a genuine reporting layer — the Job Work Orders worklist is a good template to replicate | Confirmed: only 2 real dashboards exist, both CRM/Marketing-side | This is the largest gap between "modules exist" and "the business can be run from this" |
| **P1** | Zero automated test coverage for Sales Order, BOM/MRP, Purchase Order/Goods Receipt, and — most importantly — the core inventory ledger engine itself | The exact code most connected to this audit's P0 inventory findings has no regression-test safety net | Add unit tests mirroring the quality already demonstrated in Dispatch/Journal's test files | Confirmed by diffing service files against test files | Prioritize the inventory ledger and Sales Order tests specifically, given the P0 findings above |
| **P2** | 2FA is schema-only; no HSTS/CSP; no explicit CSRF tokens; rate limiting is login-only; single-instance rate limiter/permission cache | Real but second-order security hardening gaps for a financial multi-tenant system | Standard hardening work, mostly additive, no architecture change needed | Confirmed absent/incomplete across all five | Close before a security-sensitive customer or compliance review, not before internal pilot use |
| **P2** | No structured logging, no health-check endpoint, no CD pipeline, local-disk-only file storage | Real production-operations blockers | Each is a bounded, well-understood piece of work; the project's own roadmap already schedules most of these | Confirmed absent, several explicitly and honestly deferred in project docs | Must close before any real (non-local) production deployment |
| **P2** | No supplier/customer-facing self-service, no Credit Limit enforcement, no Sales Quotation, no discounts, no backorder handling | Real commercial-completeness gaps versus a mature ERP | Each is a scoped, standalone feature addition on top of existing Sales Order infrastructure | Confirmed absent | Prioritize based on actual customer/sales-team need, not by default |
| **P3** | No multi-level BOM, no Collection concept, no cutting/finishing-specific UI beyond the generic stage engine, no cycle count/physical stock count, no stock valuation/FIFO | Real fashion-manufacturing features that would strengthen the system but are not blocking today's workflows | Larger, more architecturally significant additions | Confirmed absent | Roadmap items for a later "Manufacturing Excellence" phase, not urgent |
| **P3** | Minor DB/UX inconsistencies: `SampleRequest.sampleType` missing `@map`, `SalesOrder` missing status/customer index, inconsistent Cancel-confirmation UX on Sales Orders, flat ungrouped sidebar, no bulk actions | Small, cheap, high-value fixes | Each is a small, low-risk, isolated change | Confirmed | Batch these into a quick hardening pass — low effort, real polish |

---

## 27. What NOT to Add

Explicitly rejecting these, consistent with the project's own demonstrated discipline (it has already reversed course once this session — building then removing "Purchase Requisition" in favor of "Material Request" after recognizing scope creep):

- **TDS, 4-way GST split, a new "Merchant" role** — no confirmed business requirement exists for any of these; the project has already correctly declined to build them once and should continue to.
- **A second, parallel "Requisition" or "Purchase Request" document** — this was tried, found to conflate two responsibilities, and cleanly removed. Do not reintroduce it; Material Request already covers the real workflow.
- **A configurable approval-workflow engine** — every approval need found in this system so far has been correctly served by the fixed RBAC + self-approval-guard model. Building a generic configurable workflow engine before a second real use case demands it would be premature abstraction.
- **Speculative multi-currency UI** — the underlying exchange-rate columns exist and are correctly frozen at creation time, but zero real usage exists; building a currency-picker UI on top of logic that has never been exercised with a non-1 rate would be building on an untested foundation. Fix and test the rate logic itself first, if multi-currency is ever a real near-term need — don't build UI over an unverified engine.
- **A generic, decorative cross-module dashboard for its own sake** — the existing `/dashboard` placeholder is honest about its own incompleteness; replacing it with charts that don't correspond to real underlying reporting queries would be worse than the current honest placeholder. Build the underlying reports first (§15/§26 P1), then a dashboard that surfaces them.
- **Duplicate garment-attribute masters or a second color/size system** — `Color`, `Size`, `ProductVariant` already correctly serve this; there is no evidence any additional attribute master is needed beyond wiring the ones that already exist (Design/DesignPattern/Pattern) once their correct anchor point is actually decided, not speculatively.
- **Recruitment/Performance/KPI modules for HRMS** — correctly and explicitly out of scope; do not build these without a confirmed business need, per the project's own stated decision.
- **A bespoke mobile app before an OpenAPI spec exists** — building a client against undocumented, self-discovered API routes is a maintenance trap; if mobile is a real future need, documenting the API (§19/§26 P1-adjacent) is the actual prerequisite, not scaffolding a mobile client speculatively now.

---

## 28. Final Verdict

### Is the ERP complete?

**C — Feature Complete but Business Gaps Remain.**

This is not a close call between B and C once the evidence is weighed honestly. The transactional core is real: Sampling, Sales Orders, BOM/MRP, Purchasing, Goods Receipt with fabric-roll tracking, Material Request, Production (stage flow, split/merge, QC, external job work), Dispatch, and the double-entry Journal engine all genuinely exist, are genuinely wired together end to end, and in several places (Dispatch, Sampling, the PO/GRN cycle, the Journal engine's balance enforcement, multi-tenant scoping) are engineered to a standard well above what "many modules exist" would predict — with real atomic guards, real regression tests targeting known bug classes, and a demonstrated, repeated pattern of the project finding and fixing its own defects rather than leaving them.

But three categories of finding are specifically business-workflow gaps, not hardening gaps, and they are what keeps this from B:

1. **Production costing and inventory valuation are both structurally absent.** A "Manufacturing ERP" that cannot tell you what a production run cost, or what your inventory is worth, is missing something core to what that phrase means — not a polish item.
2. **Reporting/MIS for the core ERP barely exists.** Management cannot run the business from this system today; it can only record transactions in it. The only two real dashboards belong to a side-initiative (CRM/Marketing), not the manufacturing ERP itself.
3. **Accounting, while internally consistent, cannot produce a P&L or Balance Sheet, cannot correct a posted document, and has no period closing** — real gaps for a company that intends this to be its book of record, not merely a transaction log feeding an external accounting system.

None of these are security or architecture problems (that would point to B); they are missing manufacturing/ERP business capability (which is exactly C's definition). Separately and additionally, the P0 inventory-race and UOM-bypass findings in §10/§26 are genuine data-integrity defects that must be fixed regardless of the overall classification — they are not what determines B vs. C, but they are the single most urgent items in this report.

### What is already strong?

Multi-tenant isolation (consistently enforced, two historical bugs found and genuinely fixed); the PO→GRN→Fabric Roll cycle; Material Request's full BOM→MR→Issue/Shortfall→PO→GR traceability; Dispatch (the best-engineered module in the audit); the Journal engine's double-entry integrity; RBAC's segregation-of-duties model; the soft-delete/no-delete-on-transactional-tables discipline; the database schema's overall organization and CHECK-constraint discipline; Sampling's complete costing engine; and — perhaps most importantly — a demonstrated, repeated project habit of finding and fixing its own defects (documented explicitly in `CLAUDE.md` across multiple sessions) rather than papering over them.

### What is still missing?

Production costing, inventory valuation, real financial statements (P&L/Balance Sheet), period closing, a Credit/Debit Note workflow, a supplier ledger, cross-module management reporting, variant-level stock tracking, a Sales Quotation stage, discounts, enforced credit limits, backorder handling, multi-level BOM, a real 2FA implementation, and a production-deployment story (logging, health checks, CD, cloud file storage).

### What is risky?

The three P0 inventory findings (§10/§26) are the single riskiest items in this audit — they are live, identifiable data-integrity defects in a system that otherwise gets this exact class of guard right everywhere else, which makes them genuinely surprising misses worth fixing immediately rather than scheduling for later. The missing Sales-Order itemType guard is a close second for the same reason (a one-line-scale gap in an otherwise-consistent pattern). The stale code comment in `sales-invoice.service.ts` claiming a reversal path exists that the code actually blocks is a smaller but real risk — someone trusting that comment could give a user false expectations about correcting a mistake.

### What should be implemented next?

In order: (1) the four P0 inventory/validation fixes in §26 — small, bounded, high-consequence; (2) test coverage for the core inventory ledger and Sales Order service, given how directly they connect to finding #1; (3) a supplier ledger and price-side 3-way match, to close real financial-control gaps; (4) a genuine reporting layer for the core ERP, starting with the patterns already proven in the Job Work Orders worklist; (5) production costing, designed against the already-proven Sampling costing engine as a template.

### What should NOT be implemented?

Everything listed in §27 — most importantly, do not build TDS/4-way-GST/a new role/a configurable approval engine/a second requisition document without a confirmed, specific business need, and do not build UI on top of the currently-inert multi-currency logic before that logic itself has real usage to validate against.

### What must be fixed before production?

The four P0 items in §26; a real production-deployment story (structured logging, a health check, CD, and moving file storage off local disk — all self-acknowledged in the project's own docs as deferred, none yet closed); and, given this system's stated ambition to be a company's book of record, at minimum a Credit/Debit Note workflow and period closing before real financial operations depend on it.

### What can wait until later?

2FA, HSTS/CSP, explicit CSRF tokens, multi-instance rate limiting/caching, multi-level BOM, a Collection concept, cycle counting, and the UX polish items (bulk actions, sidebar grouping, responsive design) — all real, all worth doing, none of them blocking a careful internal pilot with a small number of trusted users, as distinct from a public or compliance-sensitive production launch.

---

## 29. Final Roadmap

### Phase A — Critical Fixes
*Only items that must be true before this system is trusted with real concurrent, multi-user transaction volume.*

| Item | Why | Business value | Technical complexity | Dependencies | Priority |
|---|---|---|---|---|---|
| Atomic stock-availability guards for Material Request issue, Stock Movement, and Dispatch confirm | Closes the three identified negative-stock races | Prevents silent, hard-to-diagnose inventory corruption | Low — the correct atomic-guard idiom already exists elsewhere in this codebase to copy | None | P0 |
| Stock-availability guard for Job Work Order raw-material issue | Closes a currently unguarded (not even racy — always reachable) negative-stock path | Same as above | Low | None | P0 |
| UOM conversion in Stock Movement and Job Work Order | Prevents ledger corruption from mixed-unit entries | Protects every downstream module's base-UOM assumption | Low — `convertUomQuantity()` already exists and is proven elsewhere | None | P0 |
| Sales Order line itemType validation | Prevents a raw material from being sold as a finished good | Data-integrity correctness | Low — mirror the existing BOM/PO/Material Request pattern | None | P0 |
| Test coverage for `inventory.service.ts` and `sales-order.service.ts` | Directly protects against regressing the fixes above | Confidence that the P0 fixes stay fixed | Low-Medium | The fixes above should land first so tests assert the corrected behavior | P0 |

### Phase B — Core ERP Completion
*Missing business workflows a real manufacturing company needs.*

| Item | Why | Business value | Technical complexity | Dependencies | Priority |
|---|---|---|---|---|---|
| Supplier ledger / AP outstanding-balance report | Basic AP operations capability currently missing entirely | High — daily operational need | Low-Medium (aggregate query over existing data) | None | P1 |
| Purchase Invoice price cross-validation against PO | Closes a real financial-control gap | High — prevents overbilling | Low-Medium | None | P1 |
| Credit Note / Debit Note workflow | Closes the "no correction path" gap for posted financial documents | High — needed for any real return/correction | Medium-High (new document type + accumulator-aware reversal) | Chart of Accounts, Journal engine (both already exist) | P1 |
| Real Trial Balance rollup by account hierarchy + a genuine P&L and Balance Sheet | Management cannot get standard financial statements today | High — core "run the business" capability | Medium-High | Existing Chart of Accounts hierarchy field (schema already supports it) | P1 |
| Fiscal period closing | Prevents back-dated postings into reported periods | High for audit-compliant books | Medium | None | P1 |
| A real reporting/MIS layer (stock aging, production efficiency/wastage, AR/AP aging, profitability) | The single largest gap between "modules exist" and "the business can run on this" | Very high | Medium-High per report, cumulatively large | The underlying transactional data already exists for all of these | P1 |

### Phase C — Manufacturing Excellence
*Improvements that make this specifically stronger as a Fashion Manufacturing ERP.*

| Item | Why | Business value | Technical complexity | Dependencies | Priority |
|---|---|---|---|---|---|
| Production costing engine (material + labor + overhead → per-unit/per-lot actual cost) | The most significant manufacturing-specific gap found | Very high — enables real margin/profitability decisions | Medium-High | `CostMaster`, `ProductionOrder`/`Lot`/`JobOrder` (all already exist as anchors) | P1 |
| Variant-level (SKU) inventory truth | Closes a real architectural mismatch between order-taking (variant-aware) and stock (style-only) | High for apparel specifically | High — touches `StockBalance` and every module that writes to it | Careful design pass first — this is a cross-cutting schema change, not a quick patch | P2 |
| Multi-level BOM | Supports sub-assembly styles | Medium — depends on this business's actual product complexity | Medium-High | Current single-level BOM engine as the base to extend | P2 |
| Yield/wastage tracking on real production (not just planning-time BOM wastage%) | Enables real efficiency reporting once the reporting layer exists | Medium-High | Low-Medium | Ties into the Phase B reporting work | P2 |
| A Collection concept | Supports buying-calendar/seasonal planning beyond a flat Season tag | Medium, depends on business need | Low-Medium | None | P3 |
| Stock valuation (weighted-average or standard cost) | Enables a real inventory asset value and true COGS-from-consumption | High for a manufacturing business's balance sheet accuracy | High — a genuinely significant addition to the ledger engine | Should follow the production-costing work above, since they share cost data | P2 |

### Phase D — Enterprise Hardening
*Security, scalability, observability, testing, architecture.*

| Item | Why | Business value | Technical complexity | Dependencies | Priority |
|---|---|---|---|---|---|
| Structured logging + error tracking | Zero observability today beyond one `console.error` call | High for operating this in real production | Low-Medium | None | P1 for real production, P2 for internal pilot |
| Health-check endpoint | Basic deployability requirement, currently absent | Low effort, real value | Low | None | P1 for real production |
| CD pipeline | CI exists; nothing deploys automatically today | Medium | Medium | Depends on chosen deployment target | P2 |
| Cloud file storage (S3-compatible) | Local disk will not survive a container restart or scaling | High if deployed on ephemeral infrastructure | Medium — the abstraction already exists, only the implementation needs swapping | None | P1 for real production |
| 2FA for financial/admin roles | Schema exists, zero implementation; explicitly an original MVP requirement for exactly these roles | Medium-High for a system handling money | Medium | `User.mfaSecret` already exists | P2 |
| HSTS + CSP headers | Standard hardening, currently absent | Medium | Low | None | P2 |
| Explicit CSRF tokens | Currently implicit-only | Medium | Low-Medium | None | P3 |
| Multi-instance rate limiter + permission cache (Redis-backed) | Current implementations are self-documented single-instance-only | Only matters once horizontally scaled | Medium | Only needed when/if scaling beyond one process | P3 until scaling is real |
| `UserBranchRole` cross-company consistency check | Currently unexploitable, becomes a real gap the moment a role-management UI ships | Low urgency today | Low | Build alongside any future role-management feature, not before | P3 (contingent) |
| OpenAPI/Swagger specification | Needed before any external/mobile client is built against this API | Medium, mainly for future integration work | Medium | None | P2 if mobile/integration is a near-term goal, otherwise P3 |

### Phase E — Advanced Features
*Only genuinely valuable future capabilities, not speculative additions.*

| Item | Why | Business value | Technical complexity | Dependencies | Priority |
|---|---|---|---|---|---|
| Sales Quotation / pre-order document | Standard commercial capability this system currently lacks entirely | Medium-High, depends on sales-team workflow needs | Medium | None | P2-P3 depending on actual sales process |
| Discounts on Sales Order/Invoice lines | Common commercial requirement, currently entirely absent | Medium | Low-Medium | None | P2-P3 |
| Real credit-limit enforcement (the field already exists — wire it up or remove it) | Currently a misleading dead field | Medium | Low | None | P2 |
| Backorder / stock-shortage handling on Sales Order confirmation | Currently no FG-availability check at order time at all | Medium-High for a business with real stock constraints | Medium | Ties into the variant-level-stock work in Phase C if both are pursued together | P2-P3 |
| Physical stock count / cycle count | Standard inventory-accuracy practice, currently absent | Medium | Medium | None | P3 |
| Multi-currency, actually exercised end to end | Schema exists but is entirely inert; either finish it properly or stop carrying the unused columns | Low unless this business genuinely trades in multiple currencies | Medium-High to do correctly (real FX conversion, rounding, reporting) | None | P3 unless a real multi-currency need exists now |
