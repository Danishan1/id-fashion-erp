# Fashion ERP — Feature Gap Analysis & Implementation Roadmap

**Analysis-only document. No code, schema, or migration changes were made while producing this. Nothing was
committed or pushed.**

Every claim below is backed by a direct citation into the real codebase (file path / model / function name),
gathered by reading `prisma/schema.prisma`, `src/modules/`, `src/app/`, `src/config/rbac.ts`,
`REPORTS_INVENTORY.md`, `GARMENT_ERP_REFERENCE_ANALYSIS.md`, and `FASHION_ERP_COMPLETE_READINESS_AUDIT.md` —
not guessed from memory of a similar-looking system. The goal is not to copy a reference ERP; it is to decide
which of its features would genuinely improve *this* Fashion Manufacturing ERP, and to say clearly when a
feature should **not** be built without an explicit business decision first.

---

## Step 1 — Current ERP inspection (what this analysis is grounded in)

Reviewed directly, not assumed:

- **Modules**: `src/modules/{customers,sampling,buyer-enquiry,sales-orders,bom-mrp,production,inventory,
  purchasing,accounts,dispatch,reports,administration,...}` — vertical-slice architecture, one folder per
  domain, each with `*.schema.ts`/`*.repository.ts`/`*.service.ts`.
- **Routes**: `src/app/api/v1/**` (REST, `requireSession` → `PermissionService.assert` → service call) and
  `src/app/(dashboard)/**` (server pages + client panels).
- **Entities/Database**: `prisma/schema.prisma` — ~90 models, UUID PKs, `companyId`/`branchId` scoping,
  append-only ledgers (`InventoryTransaction`, `ProductionStageTransaction`, `AuditLog`) as sources of truth.
- **APIs**: consistent `{data, meta}` envelope, `BusinessRuleError` → structured `{error:{code,message,
  details}}`, Zod validation on every write route.
- **Reports**: `src/modules/reports/` — 75 reports across 24 categories (`REPORTS_INVENTORY.md`), a shared
  descriptor/registry pattern (`src/modules/reports/registry.ts`) guaranteeing screen and export can never
  disagree.
- **Production workflow**: `ProductionOrder` → `Lot` → `JobOrder` (generic stage-transition unit) →
  `ProductionStageTransaction` (append-only ledger) → `QcInspection` → FG receipt into `StockBalance`.
  External contractor work: `JobWorkOrder`/`JobWorkReceipt` (built in an earlier pass).
- **Inventory workflow**: `InventoryTransaction` (immutable ledger) + `StockBalance` (derived cache), written
  in the same transaction from every module (`GoodsReceipt`, `MaterialRequest`, `StockMovement`, `Dispatch`,
  `JobWorkOrder`).
- **Purchase workflow**: `PurchaseOrder`/`PurchaseOrderItem` → `GoodsReceipt`/`GoodsReceiptItem` →
  `FabricRoll` (roll-level tracking) → `PurchaseInvoice` → `Payment`.
- **Job Work**: covered above — `src/modules/production/job-work-order.service.ts`.
- **Accounts**: `ChartOfAccount`/`Journal`/`JournalLine` (double-entry engine) → `SalesInvoice`/
  `PurchaseInvoice` → `Payment`/`PaymentAllocation` → `Expense`.
- **Permissions**: `src/config/rbac.ts` — a fixed `MODULES`/`ACTIONS` catalog, seeded `Role`/`Permission`/
  `RolePermission` rows, enforced via `PermissionService.assert()` server-side on every route (never
  UI-only).
- **Existing documentation reviewed**: `CLAUDE.md` (the living architecture/status doc — phase history,
  known gaps), `FASHION_ERP_COMPLETE_READINESS_AUDIT.md` (a full prior C-grade readiness audit with its own
  P0–P3 gap matrix), `GARMENT_ERP_REFERENCE_ANALYSIS.md` (a prior comparison against a different batch of
  reference-ERP screenshots — already led to building External Job Work, Product Catalog Filtering, and
  Excel export).

---

## Step 2 — Feature status verification

Legend: ✅ Fully implemented · 🟡 Partially implemented · ❌ Missing

### 1. Multi-order Purchase Planning — ❌ Missing (cross-order)

- **Current**: `getMaterialRequirements(companyId, salesOrderId)` (`src/modules/bom-mrp/mrp.service.ts`)
  takes exactly **one** Sales Order. `generatePurchaseOrdersForShortfall(actor, id, input)`
  (`src/modules/inventory/material-request.service.ts`) operates on exactly **one** `MaterialRequest`. There
  is no code path anywhere that consolidates requirements across multiple orders.
- **Missing**: select N open Sales Orders → one combined material-requirement table → group by supplier →
  review/edit purchase quantities → generate.
- **Business impact**: HIGH. Any company running several concurrent orders that share common
  fabrics/trims is placing separate, smaller purchase orders today when one consolidated order (better
  pricing, fewer supplier interactions) would serve the same need.
- **Technical complexity**: MEDIUM. The underlying single-order MRP function is reused unchanged; this is a
  new aggregation + review layer on top of it, not a new engine.
- **Recommendation**: Build (P1). See Step 5 for the full design.

### 2. Inventory Reports — 🟡 Partially implemented

- **Current**: `src/app/(dashboard)/inventory/stock-balances/page.tsx` +
  `src/modules/inventory/inventory.service.ts: listStockBalances` — search (name/code) + a single
  `warehouseId` filter, one Excel export (`GET .../export/xlsx`).
- **Missing**: Category/Brand/Unit/Status filters (data already exists on `Product`), PDF export
  (`src/core/reports/pdf.tsx` already exists and is used by 75 other reports — just not wired here), and
  Summary/Ledger/Movement export variants.
- **Business impact**: MEDIUM-HIGH — daily operational convenience for store/warehouse staff.
- **Technical complexity**: LOW for most filters/exports (data and shared utilities already exist); genuinely
  HIGH for a few reference items that don't fit this project's data model at all (see Step 6).
- **Recommendation**: Build (P1) — see Step 6 for exactly which parts are cheap vs. genuinely hard.

### 3. Fabrication / Job Work Stock Report — ❌ Missing (as a report; underlying data is complete)

- **Current**: `JobWorkOrder`/`JobWorkReceipt` (`prisma/schema.prisma`) already carries
  `issuedQuantity`/`receivedQuantity`/`rejectedQuantity`/`damagedQuantity` per `supplierId`/`jobOrderId`;
  `computeJobWorkOrderMetrics()` (`src/modules/production/job-work-order.service.ts`) already computes
  pending quantity. `src/modules/reports/` has no file for it (confirmed against `REPORTS_INVENTORY.md`).
- **Missing**: a report screen presenting this existing data as Issue/Receipt/Balance by Processor.
- **Business impact**: MEDIUM-HIGH — visibility into "what's currently outside with which contractor."
- **Technical complexity**: LOW — zero schema changes, a pure read over existing tables (see Step 8).
- **Recommendation**: Build (P1) — one of the cheapest, highest-certainty items in this whole analysis.

### 4. Party Bill — 🟡 Partially implemented (different name, same core function)

- **Current**: `PurchaseInvoice` (`src/modules/accounts/purchase-invoice.service.ts`) already covers
  supplier bill booking, `supplierInvoiceNumber`, due date, status, and Journal posting
  (Dr COGS / Dr GST-ITC / Cr Accounts Payable).
- **Missing**: TDS, Reverse Charge flag, No-ITC-Claim flag, a separate "Location" dimension.
- **Business impact**: LOW as-is (core function already exists); the missing pieces are real compliance
  features only if this business actually deducts TDS.
- **Technical complexity**: LOW to relabel; MEDIUM to add real TDS math (touches the Journal/Payment engine).
- **Recommendation**: Do NOT rebuild — already functionally covered. Add TDS/Reverse Charge only on
  explicit confirmation that this business deducts TDS (matches `GARMENT_ERP_REFERENCE_ANALYSIS.md`'s own
  prior, still-valid recommendation).

### 5. Profitability Report — 🟡 Partially implemented

- **Current**: `src/modules/reports/profitability.reports.ts` — Order/Style profitability from posted Sales
  Invoice lines, filtered by date range + customer.
- **Missing**: a Job-No-based view, a Date Type dropdown, a two-step Fetch-Orders→Generate flow,
  Pending/Style-Wise/Freeze-Columns toggles — but more importantly, `CLAUDE.md`'s own Phase 9 build notes
  already flag that this report's Labour Cost/Overhead Cost columns literally render the string `"Not
  Tracked"` today, because no production-costing data exists yet (see Feature 8 below).
- **Business impact**: MEDIUM. The report already gives revenue-side margin visibility; its real ceiling is
  the missing cost data, not its UI shape.
- **Technical complexity**: LOW for UI polish; the number-completeness problem is HIGH complexity and is the
  same work as Feature 8.
- **Recommendation**: Don't rebuild this report's UI in isolation — prioritize closing the BOM Cost Sheet gap
  first (Feature 8); that is what actually makes this report's numbers trustworthy.

### 6. Gate Entry — ❌ Missing entirely

- **Current**: `grep -rniE "gate.?entry|gate.?in"` across `src/` and `prisma/schema.prisma` returns zero
  matches. Today's flow goes straight from `PurchaseOrder` to `GoodsReceipt` — nothing records "a truck
  arrived" independent of matching it to a specific PO.
- **Business impact**: CONDITIONAL — entirely dependent on whether this business's factory gate/security
  desk actually performs a distinct goods-inward registration step before the warehouse team creates a
  formal Goods Receipt.
- **Technical complexity**: MEDIUM — new, additive tables; doesn't touch existing PO/GRN logic.
- **Recommendation**: Do not build speculatively. Needs one explicit business-process question answered
  first (Step 7).

### 7. Bill Monitoring — ❌ Missing entirely

- **Current**: `grep -rniE "bill.?monitor|sent for pb|delay.?by|MSME"` returns zero matches anywhere.
- **Business impact**: LOW-MEDIUM — an accounts-team internal SLA-tracking convenience; the actual
  bill-booking/payment workflow (`PurchaseInvoice`/`Payment`) already exists and works independently of this.
- **Technical complexity**: MEDIUM.
- **Recommendation**: Defer (P3) — real, but not close to the highest-value gap found here.

### 8. BOM Cost Sheet — ❌ Missing

- **Current**: `BomItem.quantityPerUnit`/`wastagePercentage` + `Product.unitCost` (a flat master field) give
  Material Cost as a directly computable number. `CostMaster` (`prisma/schema.prisma`) exists as an overhead
  rate master but has **zero FK from any transactional table** — confirmed identically by both
  `FASHION_ERP_COMPLETE_READINESS_AUDIT.md` and this analysis's own schema read. No labour-cost concept
  exists anywhere.
- **Missing**: Processing Cost (no rate field on `JobWorkOrder` at all — only quantities), Labour Cost (zero
  concept, anywhere), a real wiring of `CostMaster` into any cost rollup, Selling Price (no Price List Master
  exists either — confirmed absent in `GARMENT_ERP_REFERENCE_ANALYSIS.md`).
- **Business impact**: HIGH — this is independently flagged as the **#1 P1 gap** in
  `FASHION_ERP_COMPLETE_READINESS_AUDIT.md`'s own critical-gap matrix ("the system cannot tell you what a
  production run actually cost, or whether an order was profitable... design and build before this system is
  trusted for real margin decisions").
- **Technical complexity**: MEDIUM-HIGH — real schema work, but this codebase already has a proven costing
  engine to mirror: Sampling's own cost-rollup (`sample.service.ts`, `SampleVersion.costSubtotal`/
  `finalTotal`, margin%/commission%/freight) is structurally the same shape this needs at the Production
  level.
- **Recommendation**: Build (P1) — the highest-value single item in this entire analysis. See Step 9.

### 9. Processing Requirement — ❌ Missing

- **Current**: `JobWorkOrder` creation is pure order-entry; no requirement/planning report computes "how
  much still needs to go out to a contractor" the way BOM/MRP computes raw-material shortfall.
- **Business impact**: LOW-MEDIUM — a planning aid, not a blocker; a merchandiser can already create
  `JobWorkOrder`s directly.
- **Technical complexity**: MEDIUM — would need a new "process routing" concept (which stages of which
  styles go to which kind of external process) that doesn't exist today; a real design task, not a quick
  report.
- **Recommendation**: Defer (P3).

### 10 & 11. Vendor Inspection / Material Inspection — ❌ Missing (same underlying gap)

- **Current**: `QcInspection` (`prisma/schema.prisma`) is keyed to `productionOrderId`/`lotId`/`jobOrderId`
  only — confirmed zero link to `GoodsReceipt` or `Supplier` anywhere. This is production QC, not
  incoming-goods QC.
- **Missing**: any inspection step tied to a Goods Receipt / supplier delivery, and any vendor
  quality-rating/scorecard.
- **Business impact**: CONDITIONAL — depends entirely on whether incoming fabric/trims are actually formally
  inspected before being put into stock, or whether "receiving it" is the only check today.
- **Technical complexity**: MEDIUM — could extend `GoodsReceipt`/`GoodsReceiptItem` with inspection fields,
  or add a new inspection type reusing the existing `QcDefect`/`DefectType` masters.
- **Recommendation**: Treat 10 and 11 as **one** feature (they're the same gap at the same attachment point —
  don't build twice). Needs a business-process confirmation first (Step 10).

### 12. Production Shortage Tracking — 🟡 Partially implemented

- **Current**: `StockMovement` with `movementType: ADJUSTMENT` (`prisma/schema.prisma`) — a manual, real,
  reason-required physical-count correction. No "planned BOM consumption vs. actual material issued"
  comparison exists.
- **Missing**: a report comparing `BomItem`-planned quantity against actual `InventoryTransaction
  MATERIAL_ISSUE` rows per Lot/Production Order.
- **Business impact**: MEDIUM.
- **Technical complexity**: MEDIUM — a reporting-layer feature over existing data, no new ledger.
- **Recommendation**: P2.

### 13. Production Shrinkage Tracking — 🟡 Partially implemented

- **Current**: `BomItem.wastagePercentage` only captures **planned** wastage at BOM-authoring time — never
  compared against what actually happened on the floor. This is independently flagged in
  `FASHION_ERP_COMPLETE_READINESS_AUDIT.md` as "Yield/wastage tracking on real production (not just
  planning-time BOM wastage%)" (P2).
- **Missing**: planned-vs-actual comparison, surfaced as a real efficiency metric.
- **Business impact**: MEDIUM-HIGH — feeds directly into real manufacturing-efficiency visibility and, later,
  into the BOM Cost Sheet's accuracy.
- **Technical complexity**: MEDIUM — a reporting-layer feature over `JobOrder.completedQuantity`/
  `rejectedQuantity`/`damagedQuantity` vs. BOM-planned quantity; no new ledger needed.
- **Recommendation**: P2 — natural pairing with Feature 8's costing work.

### 14. Piece Wage — ❌ Missing entirely

- **Current**: `grep` for piece-wage/piece-rate returns zero matches anywhere.
- **Business impact**: CONDITIONAL, potentially HIGH — very common in garment manufacturing if this
  business pays operators per piece — but this is Payroll/HRMS territory, which `CLAUDE.md` records as an
  **explicit, deliberate scope exclusion** from an earlier confirmed decision ("HRMS's payroll... explicitly
  excluded"), not an oversight.
- **Technical complexity**: HIGH — a real payroll sub-system (piece-rate master, per-worker output capture,
  wage calculation, statutory deductions).
- **Recommendation**: Do NOT build without an explicit new business decision reopening the payroll-scope
  question. This is the single biggest "don't build just because the reference has it" item in this analysis.

### 15. Advances & Deduction — ❌ Missing entirely

- **Current**: zero matches. Same payroll-scope exclusion as Feature 14.
- **Business impact**: same conditional reasoning as Feature 14.
- **Technical complexity**: HIGH.
- **Recommendation**: Do NOT build — same deliberate-exclusion reasoning as Feature 14.

### 16. Daily Line Loading — ❌ Missing entirely

- **Current**: `ProductionLine.capacityPerDay` exists as a flat master field with nothing consuming it for
  actual scheduling/allocation — confirmed zero matches for line-loading/line-capacity logic anywhere.
- **Business impact**: MEDIUM — genuine production-planning value, more so for a larger multi-line factory.
- **Technical complexity**: MEDIUM-HIGH — a real allocation/scheduling engine (assign Lots/JobOrders to
  ProductionLines per day against capacity), not a report.
- **Recommendation**: Defer (P3) — matches this project's own existing "Manufacturing Excellence" future-phase
  bucket for similarly-shaped planning features.

---

## Step 3 — Business value

| # | Feature | Business Value | Classification |
|---|---|---|---|
| 1 | Multi-order Purchase Planning | ⭐⭐⭐⭐⭐ | Nice to Have (high-value, not a blocker) |
| 2 | Inventory Reports (filters/exports) | ⭐⭐⭐⭐ | Nice to Have |
| 3 | Fabrication/Job Work Stock Report | ⭐⭐⭐⭐ | Nice to Have |
| 4 | Party Bill (as-is) | ⭐⭐ | Not Recommended to rebuild; already covered |
| 5 | Profitability Report (UI polish alone) | ⭐⭐ | Future Enhancement |
| 6 | Gate Entry | ⭐⭐⭐ (conditional) | Future Enhancement — needs confirmation |
| 7 | Bill Monitoring | ⭐⭐ | Future Enhancement |
| 8 | BOM Cost Sheet | ⭐⭐⭐⭐⭐ | **Recommended before heavy reliance on Profitability numbers** |
| 9 | Processing Requirement | ⭐⭐ | Future Enhancement |
| 10/11 | Vendor / Material Inspection | ⭐⭐⭐ (conditional) | Future Enhancement — needs confirmation |
| 12 | Production Shortage Tracking | ⭐⭐⭐ | Future Enhancement |
| 13 | Production Shrinkage Tracking | ⭐⭐⭐⭐ | Future Enhancement (pairs with #8) |
| 14 | Piece Wage | ⭐ – ⭐⭐⭐⭐⭐ (fully business-dependent) | **Not Recommended without explicit confirmation** |
| 15 | Advances & Deduction | ⭐⭐ | **Not Recommended** (deliberately out of scope) |
| 16 | Daily Line Loading | ⭐⭐⭐ | Future Enhancement |

**None of the 16 features are "Mandatory before Go-Live."** This matches `FASHION_ERP_COMPLETE_READINESS_AUDIT.md`'s
own independently-reached conclusion: nothing here is a correctness or data-integrity defect — every item is
an enhancement, not a fix to something broken. (That audit's own actual P0 items — negative-stock races,
UOM-conversion bypasses, a missing Sales-Order `itemType` guard — were already fixed in an earlier pass; see
`CLAUDE.md`'s "Full ERP readiness audit + P0 inventory/UOM/validation fixes" entry.)

---

## Step 4 — Implementation priority

### P0 (Go-Live blockers)
None of the 16 features. (Real go-live blockers, per the existing readiness audit, are operational —
backup/DR plan, a health-check/CD pipeline, cloud file storage — not feature gaps; already tracked
separately in `CLAUDE.md`'s Phase 11 Hardening notes.)

### P1 — High business value
- BOM Cost Sheet (Material Cost first; wire `CostMaster`)
- Multi-order Purchase Planning
- Inventory Report filters + PDF/Ledger/Movement exports
- Fabrication/Job Work Stock Report

### P2 — Operational improvements
- Production Shrinkage Tracking
- Production Shortage Tracking
- Vendor/Material Inspection (combined, conditional on confirmation)
- Gate Entry (conditional on confirmation)

### P3 — Future roadmap
- Processing Requirement
- Bill Monitoring
- Daily Line Loading
- Party Bill's TDS/Reverse-Charge extension (conditional)
- Piece Wage, Advances & Deduction (conditional — payroll scope reopening required)

---

## Step 5 — Multi-order Purchase Planning: detailed design (no code)

### Current chain

```
SalesOrder (single) --getMaterialRequirements()--> requirement per material
                                                          |
                                                          v
                                              MaterialRequest (salesOrderId: single, nullable)
                                                          |
                                            issue from stock / generatePurchaseOrdersForShortfall(id: single)
                                                          |
                                                          v
                                                   PurchaseOrder (grouped by supplier, ONE MaterialRequest's shortfall only)
```

Every step above is real, working, and already company-scoped/guarded (over-issue, over-order, and
duplicate-request checks all already exist per `MaterialRequest`'s own service). The limitation is
structural: everything is anchored to exactly one Sales Order at a time.

### Proposed workflow

```
Multiple Sales Orders (user-selected, filterable by date range / customer / status = CONFIRMED)
        |
        v
Material Consolidation  — for EACH selected order, call the EXISTING, UNCHANGED
                           getMaterialRequirements() and merge results by materialId
                           across all selected orders (a pure aggregation step —
                           the same kind of aggregation MRP already does across a
                           single order's own style lines, just widened by one level)
        |
        v
Supplier-wise Grouping  — reuse the EXISTING grouping-by-defaultSupplierId logic
                           already proven in generatePurchaseOrdersForShortfall,
                           just fed a cross-order shortfall list instead of a
                           single-request one
        |
        v
Purchase Recommendation — one review table: Material | Total Required (with a
                           "contributing orders" breakdown preserved for
                           traceability, same shape as MRP's own contributingStyles
                           today) | Available Stock | Shortfall | Suggested
                           Supplier | editable Purchase Qty — same editable-review-
                           modal pattern already built for Material Request's own
                           "Generate Purchase Order(s)" screen, scaled to span
                           multiple orders
        |
        v
Purchase Orders          — one PurchaseOrder per supplier group, exactly as today;
                           each PurchaseOrderItem still links back to its own
                           originating MaterialRequestItem (the existing
                           materialRequestItemId FK already supports this — it lost
                           its uniqueness constraint in an earlier phase precisely
                           so one line can be split across multiple POs/requests)
```

### Key design decision: no MaterialRequest schema change needed

`MaterialRequest.salesOrderId` stays a single, nullable FK — the existing traceability model is preserved,
not widened into a many-to-many. Consolidation happens **above** that layer: the system creates one
`MaterialRequest` per selected Sales Order (each capturing that order's own share, via the existing
`createMaterialRequestFromShortfall()` unchanged, called once per order), then a **new** function performs
supplier-grouped Purchase Order generation **across** all of those newly-created requests at once, rather
than the existing function's one-request-at-a-time scope.

### Benefits

- Fewer, larger, better-negotiated purchase orders when multiple orders share common materials.
- Removes the current risk of a merchandiser handling orders one at a time and missing that combining them
  would avoid three small POs to the same supplier.
- Reduces manual repetition for a merchandiser managing many concurrent orders.
- Fully additive — the existing single-order screen keeps working unchanged for the common case of one
  order at a time.

### Required UI

- A new "Purchase Planning Workbench" page: Sales Order multi-select (filterable by date range, customer,
  status), a "Calculate Consolidated Requirement" action, the combined review table (material rows,
  expandable to show which orders contribute to each), a per-material supplier picker (defaulting to
  `defaultSupplierId`, editable), and a final "Generate" action.

### Required APIs

- `POST /api/v1/bom-mrp/consolidated-requirements` — accepts `salesOrderIds: string[]`, returns the merged
  requirement table (server-side recomputation, never trusting client-sent numbers — matching this
  project's own established discipline everywhere else).
- `POST /api/v1/bom-mrp/generate-consolidated-purchase` — accepts the reviewed quantities + supplier
  assignments, creates N `MaterialRequest`s (one per source order) and M `PurchaseOrder`s (one per supplier
  group across all of them).

### Database impact

**None required for a first version** — pure aggregation of already-existing data, reusing already-existing
tables end to end. An optional future addition, if a "which planning session created these documents"
audit trail becomes a real ask, would be a lightweight new `PurchaseConsolidationBatch` table linking a
batch id to the `MaterialRequest`/`PurchaseOrder` rows it spawned — not needed for v1.

### Workflow impact

Purely additive — a new, optional parallel path alongside the existing single-order flow. Nothing about the
current MRP→MaterialRequest→PurchaseOrder chain changes or is removed.

### Reports impact

None of the existing Material Request / Purchase Order list reports need any change — each generated
document is a completely normal row in those existing lists.

### Risks

- **Concurrent consolidation sessions on overlapping materials** — mitigated by reusing the exact
  re-verify-`availableToOrderQuantity`-immediately-before-each-PO-creation pattern already proven in
  `generatePurchaseOrdersForShortfall` (an accepted, already-documented trade-off for a manual,
  low-frequency, reviewed action rather than a hot concurrent path).
- **UI complexity of a cross-order editable table** — mitigated by reusing the exact editable-quantity
  review-modal pattern already built and proven for Material Request's own PO-generation screen.
- **Traceability confusion** ("which order does this purchased quantity belong to") — mitigated by
  preserving the same `contributingStyles`-style breakdown MRP's current single-order view already shows.

---

## Step 6 — Inventory Report: filter and export analysis

| Recommended filter | Already exists? | Effort if not |
|---|---|---|
| Warehouse | ✅ exists today | — |
| Category | 🟡 `Product.categoryId` exists, just not wired into this query | Low |
| Brand | 🟡 `Product.brandId` exists (wired for Products list already) | Low |
| Product/Item | 🟡 search partially covers this; a dedicated filter | Low |
| Unit | 🟡 derivable via `Product.baseUomId` | Low |
| Status (active/inactive) | 🟡 `Product.isActive` exists | Low |
| Color / Size | ❌ genuinely absent at the ledger level — `StockBalance` has **no variant dimension at all**, stock is tracked at style level, confirmed the same way `FASHION_ERP_COMPLETE_READINESS_AUDIT.md` already flagged it ("touches StockBalance and every module that writes to it") | High — a real cross-cutting schema change, not a report filter |
| Stage (WIP) | ❌ wrong domain fit — WIP is tracked via `JobOrder`, not `StockBalance`; forcing it into this report would blur Inventory and Production reporting | N/A — don't add here |
| Job / Buyer / Style | ❌ wrong domain fit for raw-material stock-at-rest; this is what MRP's own material-requirement view already covers | N/A — don't duplicate |
| Date (opening balance) | ❌ genuinely absent — no period-snapshot concept exists on `StockBalance` | High — a real schema addition |

| Recommended export | Already exists? | Effort if not |
|---|---|---|
| Excel | ✅ exists | — |
| PDF | 🟡 the shared PDF utility (`src/core/reports/pdf.tsx`) already powers 75 other reports — just not wired to this one | Low |
| Summary | ❌ | Low-Medium — a different aggregation level of the same underlying query |
| Detailed | 🟡 today's export is already close to this shape | Low |
| Ledger | ❌ | Low — `InventoryTransaction` already **is** the ledger; export its rows for the filtered scope |
| Movement | ❌ | Low — same idea, over `StockMovement` |

**Bottom line**: 6 of the 10 reference-inspired filters, and 4 of the 6 export types, are genuinely
low-effort because the underlying data already exists — this is the single cheapest, highest-ROI item in
this whole analysis. Color/Size and opening-balance-Date are real, deeper gaps that should not be
casually bundled into a "just add a filter" task — they require the same variant-level-stock schema
decision the existing readiness audit already flagged as its own P2 item.

---

## Step 7 — Gate Entry: should it exist?

**Recommendation: conditional — do not build speculatively.** This is the one feature in this whole analysis
that hinges entirely on a fact about the real physical operation this ERP is meant to run, not on anything
derivable from the code.

**The one question that decides this**: does a security/gate person register an incoming truck or delivery
(with a challan/bill reference) *before* the warehouse team creates a formal Goods Receipt against a
specific Purchase Order — or does the warehouse team create the Goods Receipt directly the moment goods
arrive, with no separate earlier step?

**If yes** (a real, distinct gate step exists):

```
Truck Arrival -> Gate Entry (party, challan/bill reference, rough qty count — no PO match yet)
             -> Inspection (optional, see Step 10)
             -> Goods Receipt (now formally matched to a specific PO, converts to real stock)
```

- **Advantages**: closes a real gap — today there is no way to record "something arrived" independent of
  already knowing which PO it belongs to; a security desk currently has nowhere to log a delivery until
  someone in the warehouse is ready to match it to a PO.
- **Database impact**: new `GateEntry`/`GateEntryItem` tables, a new `DocumentType`/numbering series, an
  optional link field on `GoodsReceipt` back to the `GateEntry` that preceded it. Fully additive — no
  existing table changes.
- **Operational impact**: introduces a new data-entry responsibility at the point of physical arrival —
  needs a real answer for who performs it.
- **Required users**: security/reception staff, or the existing `WAREHOUSE_USER` role if there's no
  separate gate role in practice.
- **Reports**: a "goods pending Goods Receipt" report (Gate Entries not yet converted) — directly analogous
  to the "pending"/"not yet issued" report pattern already used elsewhere in this codebase (e.g. Material
  Request's own pending-lines view).

**If no** (receiving is already a single step): this feature would be pure duplication with zero
operational value — do not build it.

---

## Step 8 — Job Work Report: can it be built on existing data?

**Yes, with zero schema changes.** `JobWorkOrder` already carries everything needed:

- **Issue Qty** = `JobWorkOrder.issuedQuantity`
- **Receipt Qty** = `JobWorkOrder.receivedQuantity`
- **Balance** = the exact `pendingQuantity` already computed by `computeJobWorkOrderMetrics()`
  (`src/modules/production/job-work-order.service.ts`) — `issuedQuantity - receivedQuantity -
  rejectedQuantity - damagedQuantity`
- **Processor** = `JobWorkOrder.supplier.name`
- **Order/Style/Buyer** = traceable through the existing chain `jobOrder → lot → productionOrder →
  salesOrderItem → salesOrder → customer/buyer`

This is purely a new report descriptor file (`src/modules/reports/job-work.reports.ts`, following the exact
same pattern every one of the other 75 reports already uses) reading the existing tables — no ledger
change, no new field, no migration.

---

## Step 9 — BOM Cost Sheet: what exists, what's missing

| Line item | Status |
|---|---|
| Material Cost | 🟡 Computable today: `Σ (BomItem.quantityPerUnit × (1 + wastagePercentage/100) × Product.unitCost)` — the exact formula shape already proven in Sampling's own costing engine (`sample.service.ts`) |
| Processing Cost | ❌ Missing — `JobWorkOrder` has quantities only, no rate/amount field at all |
| Labour Cost | ❌ Missing entirely — zero concept anywhere in the schema |
| Overhead | 🟡 `CostMaster` (rate master, type `HOURLY`/`MONTHLY`/`PER_UNIT`/`FIXED`) already exists — but has zero FK from any transactional table, confirmed by both this analysis and the prior readiness audit |
| Total Cost | ❌ Blocked on the three items above being real |
| Selling Price | ❌ Missing — no Price List Master exists (confirmed absent in the prior reference-ERP analysis too) |
| Margin | ❌ Blocked on Total Cost + Selling Price both being real |

**Recommendation**: build incrementally, in this order —
1. Material Cost roll-up (near-zero effort — reuses the proven Sampling costing pattern, no schema change).
2. Wire `CostMaster` into a real overhead rate applied per Lot/Production Order (this is the actual missing
   piece — the master data already exists, it's simply never consumed today).
3. Add a rate field to `JobWorkOrder` for Processing Cost (small, additive schema change).
4. Labour Cost is the hardest piece — needs either a real per-piece-rate capture mechanism (which overlaps
   directly with Feature 14's payroll-scope question) or an approximation via `CostMaster`'s existing
   `PER_UNIT` rate type as a stand-in until/unless real piece-wage tracking is ever built.

This closes the exact gap independently flagged as the **#1 P1 item** in `FASHION_ERP_COMPLETE_READINESS_AUDIT.md`.

---

## Step 10 — Quality Module comparison

| Area | Status |
|---|---|
| Incoming Material Inspection | ❌ Missing — no inspection tied to a `GoodsReceipt` |
| Vendor Inspection | ❌ Missing — no vendor quality-rating/scorecard, no GRN-tied inspection |
| Production QC | ✅ Fully exists — `QcInspection`/`QcDefect`/`DefectType`, tied to `JobOrder`/`Lot`/
  `ProductionOrder`, with a real accept/reject/damage + rework loop, verified live per `CLAUDE.md`'s Phase
  5C build notes |
| Finished Goods QC | 🟡 Partial — the same `QcInspection` mechanism already works at any stage, including
  a final (`ProductionStage.isFinal = true`) stage, so FG-level QC is functionally covered by the existing
  mechanism; there's just no *separately labeled* "Finished Goods QC" concept distinct from ordinary
  stage QC |

**Missing area**: any inspection step at the point goods physically arrive from a supplier, and any
resulting vendor quality history/scorecard (e.g. "Supplier X has a 3% rejection rate over the last 6
months") — a genuinely valuable report once/if incoming inspection exists, since it would reuse the exact
same `QcDefect`/`DefectType` masters already proven for production QC, just attached to a new inspection
type.

---

## Step 11 — Final roadmap

| Feature | Current Status | Business Value | Technical Complexity | Priority | Go-Live Required | Recommended Version | Owner |
|---|---|---|---|---|---|---|---|
| BOM Cost Sheet (Material Cost + CostMaster wiring) | ❌ | ⭐⭐⭐⭐⭐ | Medium-High | P1 | No | v1.1 | Production/Accounts |
| Multi-order Purchase Planning | ❌ | ⭐⭐⭐⭐⭐ | Medium | P1 | No | v1.1 | Purchasing |
| Inventory Report filters + PDF/Ledger/Movement export | 🟡 | ⭐⭐⭐⭐ | Low | P1 | No | v1.1 | Inventory |
| Fabrication/Job Work Stock Report | ❌ (report only) | ⭐⭐⭐⭐ | Low | P1 | No | v1.1 | Production |
| Production Shrinkage Tracking | 🟡 | ⭐⭐⭐⭐ | Medium | P2 | No | v1.2 | Production |
| Production Shortage Tracking | 🟡 | ⭐⭐⭐ | Medium | P2 | No | v1.2 | Production/Inventory |
| Vendor/Material Inspection (combined) | ❌ | ⭐⭐⭐ (conditional) | Medium | P2 | No | v1.2 | Purchasing/QC |
| Gate Entry | ❌ | ⭐⭐⭐ (conditional) | Medium | P2 | No | v1.2 | Warehouse |
| Processing Requirement | ❌ | ⭐⭐ | Medium | P3 | No | v2.0 | Production |
| Bill Monitoring | ❌ | ⭐⭐ | Medium | P3 | No | v2.0 | Accounts |
| Daily Line Loading | ❌ | ⭐⭐⭐ | Medium-High | P3 | No | v2.0 | Production |
| Party Bill TDS/Reverse-Charge extension | 🟡 | ⭐⭐ (conditional) | Medium | P3 | No | v2.0 | Accounts |
| Piece Wage | ❌ | Business-dependent | High | Not Recommended | No | — (needs scope decision) | HR/Payroll |
| Advances & Deduction | ❌ | ⭐⭐ | High | Not Recommended | No | — (out of scope) | HR/Payroll |

Version buckets, per the requested convention:
- **v1.0** — current production-ready ERP (already shipped, unaffected by this document).
- **v1.1** — Reporting & Costing Improvements (the four P1 items).
- **v1.2** — Warehouse & Quality Improvements (the four P2 items).
- **v2.0** — Advanced Manufacturing & Planning (the P3 items, each gated on its own confirmation where noted).

---

## Step 12 — Final recommendation

**1. What MUST be built before production?**
Nothing in this document. All 16 features are enhancements, not correctness gaps — confirmed independently
by both this analysis and the prior `FASHION_ERP_COMPLETE_READINESS_AUDIT.md`. The real pre-production
blockers (backup/DR plan, health-check/CD pipeline, cloud file storage) are tracked separately in
`CLAUDE.md`'s Phase 11 Hardening section and are unrelated to this feature comparison.

**2. What should wait until after Go-Live?**
All P1–P3 items above. None are urgent enough to delay a go-live that's otherwise ready.

**3. What should never be built unless business specifically requests it?**
Piece Wage and Advances & Deduction (full payroll — a deliberate, already-recorded scope exclusion); TDS/
Reverse Charge on Party Bill (a real compliance feature with real correctness stakes if built wrong); Gate
Entry and Vendor/Material Inspection (both genuinely conditional on confirming the real physical workflow —
building either speculatively risks modeling a step that doesn't match actual operations).

**4. Which features can reuse the existing database?**
Fabrication/Job Work Stock Report (100% — zero schema change), Multi-order Purchase Planning (100% for a v1
— reuses `MaterialRequest`/`PurchaseOrder` end to end), most of the Inventory Report filters (Category,
Brand, Unit, Status), Material Cost within the BOM Cost Sheet, and the Production Shortage/Shrinkage
reports (both pure reporting-layer reads over existing `JobOrder`/`BomItem` data).

**5. Which features require schema changes?**
BOM Cost Sheet's Processing Cost (a rate field on `JobWorkOrder`) and Labour Cost (a genuinely new concept);
Gate Entry (new tables); Vendor/Material Inspection (new fields or a new inspection type); Daily Line
Loading (a real scheduling/allocation model); Inventory Report's Color/Size filter and opening-balance date
(both deep, already-flagged variant-level-stock and period-snapshot gaps, not simple additions); Piece Wage
and Advances & Deduction (a full payroll data model, if ever approved).

**6. Which features require new workflows?**
Multi-order Purchase Planning (a new planning-workbench step alongside the existing one); Gate Entry (a new
pre-GRN physical step); Vendor/Material Inspection (a new pre-stock-in inspection step); Daily Line Loading
(a new scheduling/allocation activity).

**7. Which features provide the highest ROI?**
In order: **Fabrication/Job Work Stock Report** (zero schema change, real visibility gain) → **Inventory
Report filters/exports** (mostly cheap, high daily-use value) → **BOM Cost Sheet** (highest absolute
business value, moderate effort, and independently the #1 flagged gap in this project's own prior audit) →
**Multi-order Purchase Planning** (highest value-per-feature, moderate effort, fully additive).

---

## Executive Summary

This Fashion ERP already covers the full order-to-cash and procure-to-pay cycle correctly and completely —
Sampling, Sales Orders, BOM/MRP, Production (including external job-work), Inventory, full double-entry
Accounts, and Dispatch are all built, tested, and verified. None of the 16 features compared against the
reference ERP expose a correctness or data-integrity defect; every one is a genuine enhancement opportunity,
not a fix to something broken.

The single most valuable, best-evidenced gap — corroborated independently by both this analysis and an
earlier full readiness audit — is the complete absence of **production costing** (BOM Cost Sheet: material
cost is computable today, but processing cost, labour cost, and overhead are entirely unwired), which is
also what currently caps the existing Profitability Report at "revenue-side visibility only." Three other
items are unusually cheap relative to their value because their underlying data already fully exists:
the **Fabrication/Job Work Stock Report**, most of the **Inventory Report's missing filters/exports**, and
**Multi-order Purchase Planning**'s core aggregation.

Three areas were deliberately **not** recommended for implementation despite appearing in the reference ERP:
full payroll (Piece Wage, Advances & Deduction — an already-made, deliberate scope exclusion), TDS/GST
4-way-split compliance features (real correctness stakes, needs explicit confirmation, not inference from a
screenshot), and a new "Merchant" role concept (likely duplicates the existing Sales Agent/assignment
model). Gate Entry and Vendor/Material Inspection are real candidates but hinge entirely on confirming this
business's actual physical receiving process — building either speculatively risks modeling a workflow step
that doesn't match how the factory actually operates.

## Top 10 Recommendations

1. **BOM Cost Sheet** — build Material Cost first (near-zero effort), then wire `CostMaster` for real
   overhead — the highest-value gap in the whole ERP today.
2. **Multi-order Purchase Planning** — consolidate material requirements across several Sales Orders into
   one supplier-grouped purchase recommendation, fully additive to the existing single-order flow.
3. **Fabrication/Job Work Stock Report** — a pure report over data that already fully exists; build this
   first among the four P1 items for the fastest visible win.
4. **Inventory Report — Category/Brand/Unit/Status filters + PDF/Ledger/Movement exports** — cheap, daily
   operational value, all backed by data that already exists.
5. **Production Shrinkage Tracking** — planned-vs-actual wastage, pairs naturally with the costing work in
   #1 and closes an already-flagged efficiency-reporting gap.
6. **Production Shortage Tracking** — a companion reporting-layer feature over the same existing data.
7. **Confirm the real physical receiving process** before deciding on Gate Entry and Vendor/Material
   Inspection — one business conversation, not a build task, but it should happen before v1.2 planning.
8. **Do not touch Party Bill** beyond its existing `PurchaseInvoice` coverage unless TDS is explicitly
   confirmed as a real requirement.
9. **Do not reopen the payroll-scope decision** (Piece Wage, Advances & Deduction) without an explicit new
   business ask — this was already deliberately excluded once.
10. **Defer Processing Requirement, Bill Monitoring, and Daily Line Loading** to a later planning phase —
    real, but genuinely lower-value or higher-complexity than everything above.

## P0 / P1 / P2 / P3 Roadmap

- **P0 (Go-Live blockers)**: none.
- **P1 (v1.1 — Reporting & Costing Improvements)**: BOM Cost Sheet, Multi-order Purchase Planning, Inventory
  Report filters/exports, Fabrication/Job Work Stock Report.
- **P2 (v1.2 — Warehouse & Quality Improvements)**: Production Shrinkage Tracking, Production Shortage
  Tracking, Vendor/Material Inspection (conditional), Gate Entry (conditional).
- **P3 (v2.0 — Advanced Manufacturing & Planning)**: Processing Requirement, Bill Monitoring, Daily Line
  Loading, Party Bill's TDS extension (conditional).
- **Not Recommended**: Piece Wage, Advances & Deduction (unless the payroll-scope decision is explicitly
  reopened).

## Estimated Implementation Order

1. Fabrication/Job Work Stock Report (fastest win — zero schema change)
2. Inventory Report filters + exports (cheap, high daily-use value)
3. BOM Cost Sheet — Material Cost, then CostMaster wiring (highest absolute value)
4. Multi-order Purchase Planning (highest value-per-effort of the remaining P1 items)
5. Production Shrinkage Tracking, then Production Shortage Tracking (natural pair, builds on #3's data)
6. *(Business decision point)* — confirm real Gate Entry / Vendor Inspection need before building either
7. Gate Entry and/or Vendor/Material Inspection, only if confirmed in step 6
8. Remaining P3 items, revisited at the next planning cycle
