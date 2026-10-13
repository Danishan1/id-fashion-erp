# Fashion ERP — Finished Goods Inventory Management Module: Implementation Plan

**This is a planning document only. No application code, schema, or configuration has been changed to
produce this file — including this revision.** Everything below is grounded in a direct, read-only
investigation of the real codebase at
`D:\office-data\claude-projects\fashion-erp\.claude\worktrees\merge-local-changes-push-fa9888` (three
parallel investigation passes, each citing exact `file:line` evidence from the live source — never trusted
from `CLAUDE.md`'s own historical narrative alone, since the schema has moved since each of those entries was
written). This initiative is tracked separately from the ongoing Platform Administration & SaaS work
(`docs/PLATFORM_SAAS_MASTER_TRACKER.md`) — different task-ID prefix (`FGI-xxx`, not `PLAT-xxx`), different
scope, no shared files between the two beyond this repository itself.

**Do not implement anything in this document until the user has reviewed it and given explicit approval.**

**2026-10-13 update:** Phase 0 (FGI-001 through FGI-008) is implemented and verified — see §11 for the full
task-by-task evidence. This document now lives on its own dedicated `finished-goods-inventory` branch/
worktree (moved here from the drafting location in the Platform SaaS session's own primary worktree,
per the explicit instruction to keep this initiative on a separate branch from Platform SaaS) — every file
changed for Phase 0 is on this same branch, nothing was committed to `main` or any Platform SaaS branch.

---

## 0. Decisions approved by the user (2026-10-13)

The four design directions below were presented as open questions in the first revision of this plan and
have since been **approved**. They are binding on everything that follows; the rest of this document has
been rewritten to reflect them, not merely annotated.

1. **QC Hold** — reuse the existing Production QC process (`recordQcInspection()`,
   `job-order.service.ts:1536-1614`) exactly as it works today. **No second inspection workflow is
   introduced.** Non-saleable Hold/Rejected quantities are tracked as a reporting view over data Production
   already produces (accepted vs. rejected vs. damaged), never as a second physical status a unit of FG stock
   can additionally sit in after receipt — this was "Option A" in the prior revision, now the final,
   permanent design, not a provisional default (see §4.1).
2. **Stock Movement** — extend the existing `StockMovement`/`createStockMovement()` engine to post Finished
   Goods transfers and adjustments, with strict item-type validation (a single document is either entirely
   raw-material or entirely finished-goods, never mixed), real variant identity, and warehouse/location
   validation, inside the exact same transaction-safe posting path every other movement already uses (see
   §4.4).
3. **Dispatch Picking** — a new, dedicated `FinishedGoodsPickLine` entity (child of `DispatchItem`, not of
   `Carton`/`CartonItem`), supporting multi-location picking, partial picks, and idempotent stock deductions
   (see §7).
4. **RBAC** — a new `fg_inventory` RBAC module, using this codebase's existing generic action vocabulary
   (`view`/`create`/`edit`/`post`/`approve`/`export`/`print` — no new action verbs invented), covering
   viewing, receiving, putaway, transfers, adjustments, and reports. **Picking and reservation are
   deliberately NOT separate `fg_inventory` permissions** — picking is gated under the *existing* `dispatch`
   module's existing actions (it is part of the pack/confirm workflow that module already owns), and
   reservation has no standalone user-facing action at all (it is a fully automatic side effect of
   `sales_orders`' own `confirmSalesOrder()` and `dispatch`'s own `confirmDispatch()` — see §8, FGI-008).

---

## 1. Existing features that can be reused

The single biggest finding of this investigation: **the right architecture for this module is almost
entirely "extend the existing ledger additively," not "build a second stock system."** The following are
confirmed, working, directly reusable building blocks:

| # | Capability | Where | Why it's reusable as-is |
|---|---|---|---|
| 1 | **The append-only stock ledger** | `InventoryTransaction` (`prisma/schema.prisma:4665-4698`) | Already the sole source of truth for every stock-affecting event in the ERP (Goods Receipt, Material Issue, Production Receipt, Dispatch, Stock Movement, Job Work). Adding Finished Goods to it is additive, not a second ledger. |
| 2 | **The core posting function** | `recordInventoryTransaction()` (`src/modules/inventory/inventory.service.ts:52-112`) | Already does exactly what the new module needs at the primitive level: validates company/warehouse ownership, inserts the ledger row, atomically upserts a balance cache, and has a battle-tested negative-stock guard (`guardedDecrement`, `inventory.repository.ts:72-83` — a single atomic `updateMany` with the floor check baked into its own `WHERE` clause, not a read-then-write). `tx` is a mandatory parameter (no silent fallback), so nothing can ever bypass the atomic balance update. |
| 3 | **`WarehouseType.FINISHED_GOODS`** | `prisma/schema.prisma:1286-1294` (enum), `:1305` (`Warehouse.type: WarehouseType[]`) | A Finished Goods warehouse type already exists and is already in active use — Production's own Lot/JobOrder/JobWorkOrder workflow already *requires* a `finishedGoodsWarehouseId` whenever a batch reaches a final stage. |
| 4 | **Production → FG posting, including its idempotency fix** | `completeAtFinalStageInTx()`, `src/modules/production/job-order.service.ts:182-215`, called from `forwardJobOrder` (`:1379`), `recordQcInspection` (`:1580`), `cascadeReceivedThroughStagesInTx` (`:429`) | Already posts `PRODUCTION_RECEIPT` transactions correctly: partial-batch-safe (posts only the batch's own quantity, never the lot's full planned quantity, confirmed by its own doc comment at `:164-181`), supports multiple receipts per lot over time, and has a real, already-shipped fix for the historical double-posting bug (a guarded `forwardedQuantity`/`qcPassedQuantity` accumulator shared between the manual-Forward and QC-Accept paths, `:347-353`). This is the one piece of the whole module that is *already correctly idempotent* — nothing here needs re-architecting, only extending. |
| 5 | **QC disposition correctly excludes rejected/damaged stock from FG** | `recordQcInspection()`, `job-order.service.ts:1536-1614` | Rejected quantity routes backward to rework (never touches any inventory ledger); damaged quantity posts a `DAMAGE` transaction into a REJECT-type warehouse, explicitly excluded from FG stock (`schema.prisma:4633-4636`). Per the approved Decision 1, this is the **entire** Hold/Rejected mechanism — nothing new is layered on top of it. |
| 6 | **Dispatch's FG stock check and decrement** | `confirmDispatch()`, `src/modules/dispatch/dispatch.service.ts:615-742`; pre-check at `:634-643`; ledger post at `:685-692` | Already does the pre-check → atomic-decrement pattern correctly, with a dedicated `INSUFFICIENT_FG_STOCK` error, and is already proven race-safe via `recordInventoryTransaction`'s own guard. The entire flow is reusable verbatim; it is the *shape* (style-aggregate only, no variant/location) that needs extending, not the mechanism. |
| 7 | **Extra Dispatch Quantity's exact business rule** | `dispatch.service.ts:90-134`, `:629-657`; `DispatchSettings` (`schema.prisma:4842-4858`) | A fully-built, already-correct rule set: regular and extra quantity share **one** stock pool, checked together as one total at the one Confirm-Dispatch checkpoint, with its own optional approval gate (quantity/percent threshold). Must be preserved exactly — see §7. |
| 8 | **Warehouse Location CRUD** | `src/modules/warehouses/warehouse.service.ts` (`listWarehouseLocations`, `createWarehouseLocation`, `updateWarehouseLocation`, `setWarehouseLocationActiveStatus`) | A `Zone`/`Rack`/`Bin` location already exists as a real, manageable entity with duplicate-code checks, soft-deactivation (never hard-delete, since real ledger/receipt rows already reference it), and nested creation at warehouse-creation time. Fully reusable for FG putaway locations — no new location *model* is needed, only new workflows built on top of the existing one. |
| 9 | **Location-level stock derivation pattern** | `findLocationBreakdownForPair` (`inventory.repository.ts:24-46`), surfaced via `listStockBalances`'s `includeLocationBreakdown` option (`inventory.service.ts:191-243`) | An existing, working pattern for "how much of this product sits at each location" by grouping the ledger — the right starting point for the new Location-wise Stock Report, even though (per §2 below) it's a live, N+1-per-row derivation today, not a cached balance. |
| 10 | **Stock Movement's Transfer/Adjustment shape, now extended by Decision 2** | `StockMovement`/`StockMovementItem` (`schema.prisma:4718-4798`), `createStockMovement()` (`src/modules/inventory/stock-movement.service.ts:130-280`) | The exact right shape for "Stock Transfer" and "Stock Adjustment with approval and audit trail" (Step 5 of the brief) already exists — two-ledger-entry transfers in one transaction, idempotency-key dedupe (CF-5), audit logging. Decision 2 confirms this is extended (not duplicated) for Finished Goods; see §4.4 for the exact validation rules governing the extension. |
| 11 | **Document numbering / audit logging / RBAC conventions** | `generateDocumentNumber()` / `document_sequences`, `writeAuditLog()`, `src/config/rbac.ts`'s existing module-key-splitting precedent (e.g. `material_request` split out of `inventory` on 2026-09-24) | All directly reusable, zero new infrastructure needed — a new `fg_inventory` RBAC module key and a new `FG_RECEIPT`/similar `DocumentType` prefix are additive, not new mechanisms. |
| 12 | **`production-progress.service.ts`'s existing FG-visibility view** | `src/modules/production/production-progress.service.ts:214-340` | Already surfaces `availableStock`/`contributingLots` per Sales Order line by reading the exact same `getAvailableQuantity()` Dispatch itself uses — explicitly documented as deliberately *not* a separate, narrower number. The same "always read from the one real source of truth, never maintain an independently-computed second number" discipline is the governing rule for every new FG screen — see §4.5. |
| 13 | **The project's own established "nightly reconciliation job" precedent for ledger/cache pairs** | `CLAUDE.md`'s own "Risks & Edge Cases" section (verbatim): "Stock ledger drift if app-transaction and trigger ever disagree — nightly reconciliation job is mandatory." | This exact principle, already stated as a project-wide requirement for the original `InventoryTransaction`/`StockBalance` pair, is reused directly as the defense-in-depth strategy for the new ledger/`FinishedGoodsStockBalance` pair — see §4.5 and FGI-013. |

---

## 2. Missing functionality and gaps

Each of these is a **confirmed, evidence-backed gap**, not a guess — cited against the real current code.

1. **Zero variant/color/size dimension anywhere in the stock ledger.** `InventoryTransaction` and
   `StockBalance` are keyed only on `(companyId, productId, warehouseId)` (`schema.prisma:4665-4716`).
   `ProductVariant` itself has no stock-related field at all (`schema.prisma:1258-1284`). `LotVariantBreakdown`
   exists but is explicitly documented, in its own schema comment, as "purely informational... never
   decremented" (`schema.prisma:4024-4032`) and is never read by any production-completion code path
   (confirmed absent from `job-order.service.ts` entirely). `CartonItem.productVariantId` is likewise
   "informational... never enforced against per-variant stock" (`schema.prisma:4996-4999`).

2. **Zero "Reserved Stock" concept anywhere in the codebase.** Confirmed by grep: no `reservedQuantity`
   column exists on `SalesOrderItem`, `ProductVariant`, or `StockBalance`. Confirming a Sales Order
   (`confirmSalesOrder()`, `sales-order.service.ts:446-498`) does nothing to inventory at all. Two confirmed
   Sales Orders can both be checked against, and both pass, the same physical stock number today.

3. **No "QC Hold" bucket as a second, post-receipt physical status.** Resolved by Decision 1 — this is
   explicitly **not** being built; recorded here only so the plan's own history is honest about what was
   considered and declined.

4. **No stored per-location stock balance.** `StockBalance` has no `warehouseLocationId` column at all
   (confirmed, `schema.prisma:4702-4716`, and explicitly called out in a neighboring schema comment,
   `:4783-4789`, as the reason `getAvailableQuantity()` "stays warehouse-level"). Location-level numbers are
   only ever derivable live by grouping the ledger (`findLocationBreakdownForPair`).

5. **`WarehouseLocation` is a flat `zone`/`rack`/`bin` string triple on one row — no separate Zone/Rack/
   Shelf/Bin entity hierarchy, and no "Shelf" level at all.** (`schema.prisma:1329-1367`).

6. **Zero putaway/staging/unassigned-stock concept exists anywhere** — confirmed by an exhaustive,
   case-insensitive grep across the whole codebase (`putaway`, `staging area`, `unassigned stock`): zero
   matches. Goods Receipt assigns a location directly at receipt time, with no intermediate staging step
   (`goods-receipt.service.ts:338-354`).

7. **Stock Movement (Transfer/Adjustment/Return-to-Supplier) is hard-restricted to raw materials.**
   `createStockMovement()`'s item validation resolves every line through
   `ProductRepository.findMaterialById()`, which filters `itemType: "RAW_MATERIAL"` at the query level
   (`product.repository.ts:80-84`) — a Finished Goods/style line is rejected outright with `NOT_FOUND`.
   Resolved by Decision 2, see §4.4.

8. **No multi-location picking anywhere in Dispatch.** `CartonItem` has no `warehouseLocationId` (or any
   location field at all, `schema.prisma:4992-5011`). Resolved by Decision 3, see §7.

9. **`WarehouseLocation.materialCategory` tagging (including a `FINISHED_GOODS` value) is advisory-only** —
   nothing at the database or service layer blocks posting an inconsistent category to a location
   (`schema.prisma:1343-1345`). This plan does **not** propose making this stricter — out of scope, not
   requested.

10. **"Finished Goods" is a convention layered on generic primitives today, not a first-class, independently
    reportable entity.** There is no `FinishedGoodsStock`/`FGStock`-named model, no dedicated FG report
    beyond the per-Sales-Order-line `availableStock` view in `production-progress.service.ts`.

11. **`Dispatch.salesOrderId` remains required/non-nullable** (`schema.prisma:4869`, confirmed still true in
    the current code). Make-to-stock dispatch (no Sales Order) has no path today — out of scope for this
    module, not requested.

12. **(New in this revision) Historical Finished Goods stock has no colour/size breakdown at all, and
    cannot retroactively acquire one.** Every existing `StockBalance` row at a `FINISHED_GOODS`-typed
    warehouse was posted by historical, pre-this-module `PRODUCTION_RECEIPT`/`DISPATCH` transactions that
    carried no variant information — there is no way to reconstruct, after the fact, which physical units
    belong to which colour/size. This is addressed explicitly in §4.7, not glossed over.

---

## 3. Exact files and database models requiring changes

Every change below is additive (new nullable columns, new tables, new files) unless explicitly marked
otherwise. **Zero existing columns, enum values, or required fields are altered or removed on any
raw-material-only model.**

**Company-scoping rule applied to every new table below (see §4.8):** every new table gets its own explicit
`companyId` column, never reached only via a join — this is the project's own current convention for any
table created after the one early, already-flagged exception (`WarehouseLocation`, whose lack of a
`companyId` column is explicitly documented in its own schema comment as "the exact bug class fixed 27 times
project-wide"). None of the new tables in this plan repeats that mistake.

### Schema (`prisma/schema.prisma`)
- `InventoryTransaction` — **add** `productVariantId String?` (nullable FK → `ProductVariant`), **add**
  `stockStatus StockStatus?` (nullable; new enum — see §4.1). Both nullable, both populated only by
  FG-relevant transaction types going forward — never required, never touched by any existing
  `recordInventoryTransaction()` caller unless it opts in.
- **New** `FinishedGoodsStockBalance` model — `id, companyId, branchId?, productId, productVariantId?`
  (**nullable** — see §4.7 for why: it represents the "unallocated legacy stock" bucket when null),
  `warehouseId, warehouseLocationId?, stockStatus, quantityOnHand, updatedAt`. A hand-added **partial unique
  index** is required (`WHERE product_variant_id IS NOT NULL`) alongside the ordinary unique constraint for
  the null case (`WHERE product_variant_id IS NULL`) — Postgres's standard multi-column unique constraint
  treats every `NULL` as distinct, which would otherwise allow more than one "unallocated" row per
  product+warehouse+location+status to be created by mistake; this follows the exact same hand-added
  partial-unique-index precedent already used elsewhere in this schema (e.g.
  `sales_invoices_one_active_per_order`).
- **New** `FinishedGoodsReservation` model — Sales-Order-driven stock holds, `companyId` explicit (see
  §4.2).
- **New** `FinishedGoodsReceipt` / `FinishedGoodsReceiptItem` models — the formal FG Receipt document, each
  with an explicit `companyId`, linking back to `Lot`/`JobOrder`/`ProductionOrder`, with a color/size
  breakdown per line.
- **New** `FinishedGoodsPickLine` model — `id, companyId, dispatchItemId, productVariantId` (not null —
  picking is always a specific physical unit), `warehouseLocationId` (not null — picking always specifies
  exactly which location), `quantity, pickedAt, pickedByUserId`. A child of `DispatchItem`, independent of
  `Carton`/`CartonItem` (Decision 3) — `CartonItem` itself is completely unchanged by this plan.
- `WarehouseLocation` — **add** `shelf String?` (nullable, additive) to complete the Zone→Rack→Shelf→Bin
  hierarchy the brief describes.
- `StockMovementItem` — **add** `productVariantId String?` (nullable — populated only on a Finished-Goods-
  flagged movement line), **add** `toWarehouseLocationId String?` (nullable — the destination side of a
  location-to-location or warehouse-to-warehouse Transfer; the existing `warehouseLocationId` column already
  covers the source side).
- New enum: `StockStatus` (`SALEABLE`, `REJECTED`) — **no `QC_HOLD` value**, per Decision 1 (the earlier
  revision's Option-B scaffolding is deliberately dropped, not kept-but-unused, since Decision 1 makes it
  permanently out of scope rather than provisionally deferred).
- New `DocumentType`/`RelatedModule` values for `FG_RECEIPT`/`FINISHED_GOODS_RECEIPT` numbering and
  attachment/audit polymorphism, following the exact existing reserve-then-consume pattern already used for
  every other document type in this schema.

### Services/repositories (new files, `src/modules/finished-goods-inventory/` — a new module, mirroring
every existing module's `schema.ts`/`repository.ts`/`service.ts` convention)
- `finished-goods-receipt.service.ts` — wraps (does not replace) `completeAtFinalStageInTx()`.
- `finished-goods-reservation.service.ts` — reserve on Sales Order confirm, consume on Dispatch confirm,
  release on cancellation.
- `finished-goods-stock.service.ts` — the read-side: stock list, style/colour/size detail, location-wise
  report, dashboard aggregates, plus the reconciliation-drift report (FGI-013).
- `finished-goods-putaway.service.ts` — assign/transfer/split-across-locations and the reconciliation/
  opening-allocation workflow (§4.7).
- `finished-goods-pick.service.ts` — called from, not a replacement for, `dispatch.service.ts`'s own
  `confirmDispatch()` — manages `FinishedGoodsPickLine` creation and its own guarded decrement.

### Modified existing files (narrow, additive touches only)
- `src/modules/inventory/inventory.service.ts` — `recordInventoryTransaction()` gains the ability to *also*
  upsert the new `FinishedGoodsStockBalance` row, but **only when the caller supplies the new optional
  `productVariantId`/`stockStatus` fields** — every existing call site is completely unaffected.
- `src/modules/inventory/stock-movement.service.ts` — item-type validation widened per Decision 2 (§4.4);
  `createStockMovement()`'s own guards extended, not replaced.
- `src/modules/production/job-order.service.ts` — `completeAtFinalStageInTx()` extended to accept an
  explicit colour/size breakdown and to create the new `FinishedGoodsReceipt` row; existing idempotency/
  partial-completion logic otherwise untouched.
- `src/modules/dispatch/dispatch.service.ts` — `confirmDispatch()` extended to read each `DispatchItem`'s
  `FinishedGoodsPickLine` rows and post one ledger entry per pick line, while *still* updating the existing
  flat `StockBalance` row with the exact same total as today (see §7).
- `src/config/rbac.ts` — new `fg_inventory` module key + role grants (see §8, FGI-008, now with a concrete
  proposed mapping rather than a placeholder).
- `src/components/layout/navigation.ts` — new "Finished Goods Inventory" entry under the existing
  "Inventory" nav section (`navigation.ts:162-173`), alongside (not replacing) its existing children —
  Stock Balances, Stock Movements, Material Requests. (Goods Receipts is a sibling nav item under the
  separate "Purchase" section, `:129-143`, not under "Inventory".)

---

## 4. Proposed architecture and stock ledger design

### 4.1 The central decision: extend the ledger additively, add a purpose-built FG balance cache alongside — never replace `StockBalance`

`StockBalance` exists to answer one question cheaply: "how much of this product is at this warehouse,
total." That question, and every raw-material caller that depends on it, is **completely untouched** by this
design. A new, separate cache — **`FinishedGoodsStockBalance`** — answers the richer question the brief
needs: "how much of this *specific variant*, in *this stock status*, sits at *this exact location*."
Illustrative shape (not final DDL):

```
FinishedGoodsStockBalance
  id, companyId, branchId?
  productId          -- the style
  productVariantId?  -- nullable: null means "unallocated legacy stock" (§4.7); otherwise a real variant
  warehouseId
  warehouseLocationId?   -- nullable: an "unassigned/staging" balance has no location yet
  stockStatus        -- SALEABLE | REJECTED   (no QC_HOLD value — Decision 1)
  quantityOnHand     Decimal(18,4)
  updatedAt
  @@unique([companyId, productId, productVariantId, warehouseId, warehouseLocationId, stockStatus])
    -- plus a hand-added partial unique index for the productVariantId IS NULL case (§3)
```

`recordInventoryTransaction()` keeps doing exactly what it does today for every existing caller. It gains one
new, purely additive branch: **when the caller supplies `productVariantId`**, it *also* upserts/guarded-
decrements the matching `FinishedGoodsStockBalance` row, using the identical atomic `updateMany`-with-floor-
check idiom already proven for `StockBalance` itself. Both balances are updated in the same transaction as
the one ledger insert, so they can never disagree *by construction* — see §4.5 for the full argument and its
limits.

**QC Hold — final decision (Decision 1), stated precisely:** there is **no** `QC_HOLD` value in `StockStatus`
and **no** second inspection workflow. "Non-saleable Hold/Rejected quantities... tracked separately" is
satisfied by `StockStatus.REJECTED` alone, populated only when Production's own `DAMAGE` disposition posts —
mirroring, at the variant level, exactly what already happens at the style level today (a `DAMAGE`
transaction into a REJECT-type warehouse). There is no scenario in this design where a unit of stock is
"received into Finished Goods but not yet decided" — Production's own QC gate already is that decision
point, upstream of FG receipt, and this plan does not duplicate it. **This closes the one genuinely open
question from the prior revision; it is not a provisional default.**

**Reservation is deliberately NOT a `StockStatus` value.** A reserved unit is still physically `SALEABLE` —
reservation is an accounting hold tracked in its own table (`4.2`) and subtracted at query time, never
written onto the stock row itself.

### 4.2 Reserved / Available, and concurrency safety (addresses the user's explicit ask: "define concurrency-safe reservations")

**New `FinishedGoodsReservation` model:**
```
FinishedGoodsReservation
  id, companyId, branchId?
  salesOrderItemId, productVariantId, warehouseId?
  reservedQuantity, consumedQuantity (default 0), status (ACTIVE | RELEASED | FULFILLED)
  createdAt, updatedAt
```

**Exact concurrency-safety mechanism, stated explicitly (no vague "transaction-safe" claim without a
mechanism behind it):**
- **Creation** is a plain `INSERT` inside `confirmSalesOrder()`'s existing transaction — no race is possible
  here, since it is a brand-new row with no prior state to contend over.
- **Consumption** (at Dispatch confirm, proportional to what's actually picked) is a single atomic
  `updateMany` whose `WHERE` clause encodes the floor condition directly —
  `WHERE id = :id AND consumedQuantity + :increment <= reservedQuantity` — the *exact same idiom* as
  `guardedDecrement` on `StockBalance` today (`inventory.repository.ts:72-83`), not a read-then-write. A
  `count === 0` result means the attempted consumption would overshoot the reservation (a genuine race with
  another concurrent dispatch against the same reservation, or an application bug), and the whole
  `confirmDispatch()` transaction is rejected and rolled back — never partially applied.
- **The real protection for "no oversell" is always at the write side, never the read side.** A prior
  "available" read (used only to give the user a friendly, pre-emptive error) is never trusted as the actual
  gate — exactly the same "pre-check is a courtesy, the guarded write is the last line of defense" discipline
  `recordInventoryTransaction()` already documents for `StockBalance`'s own guard.
- **Every `FinishedGoodsStockBalance` decrement** (pick-line deduction, reservation-driven decrement,
  adjustment-driven decrease) is, identically, one atomic `updateMany` with the required floor baked into its
  `WHERE` clause, executed inside the one transaction that also inserts the ledger row — never a separate
  read + conditional application-code decision.
- **Multi-location pick safety:** each `FinishedGoodsPickLine`'s own deduction is an independent guarded
  decrement against that specific `(productVariantId, warehouseLocationId, stockStatus=SALEABLE)` row. A
  failure on any one pick line rolls back the *entire* `confirmDispatch()` transaction (every pick line for
  that dispatch, plus the reservation consumption, plus the flat `StockBalance` update) — a partially-applied
  set of location deductions can never persist, by the same ACID guarantee already relied on everywhere else
  in this codebase.

`Available = Saleable (sum of FinishedGoodsStockBalance rows with status SALEABLE across locations,
EXCLUDING the nullable-variant "unallocated" row — §4.7) − sum(ACTIVE reservations' unconsumed remainder)
for that variant+warehouse`. This single formula backs both the new Stock List screen's "Available Stock"
column and Dispatch's own extended pre-check (§7).

### 4.3 Warehouse location hierarchy and putaway

`WarehouseLocation` gains one new optional `shelf` field (Zone → Rack → Shelf → Bin) — no new entity
hierarchy needed. "Unassigned/staging" stock is modeled as a `FinishedGoodsStockBalance` row with
`warehouseLocationId = null` (distinct from the `productVariantId = null` "unallocated legacy" row — a
balance row can be null in either dimension independently, or both). A Putaway action moves quantity from
the `warehouseLocationId = null` row to one or more real-location rows.

### 4.4 Stock Movement extension — approved design (Decision 2)

- **Item-type validation, strict:** a single `StockMovement` document is, from creation, tagged as either a
  raw-material movement or a finished-goods movement (a new, small discriminator — e.g. a derived check on
  the first line's `Product.itemType`, re-validated for every subsequent line added to the same document) —
  **mixing a `RAW_MATERIAL` line and a `STYLE` line in one document is rejected outright.** This is enforced
  at both the Zod schema layer and a service-layer assertion (defense in depth, not either/or), closing the
  exact risk class ("a loosened validation accidentally lets the two item families mix") that a naive
  widening could otherwise introduce.
- **Variant identity:** a finished-goods `StockMovementItem` line requires `productVariantId` (not optional
  for this item-type family, even though the column itself is nullable at the schema level to stay
  compatible with raw-material rows that never populate it).
- **Warehouse/location validation:** both the source `warehouseLocationId` (already an existing column) and
  the new `toWarehouseLocationId` are validated for company/branch ownership using the exact same
  chokepoint-validation pattern `recordInventoryTransaction()` already applies to `productId`/`warehouseId`.
- **Transaction-safe posting:** unchanged from today's `createStockMovement()` — one Prisma `$transaction`
  wrapping the document/item creation and every `recordInventoryTransaction()` call, with the CF-5
  idempotency-key dedupe already built into this mechanism reused as-is (no new idempotency mechanism
  needed for Stock Movement specifically — it already has one).
- `RETURN_TO_SUPPLIER` remains meaningless for a finished-goods line (you do not return finished goods to a
  raw-material supplier) — rejected by the same item-type-family validation above, no schema change needed
  to prevent it.

### 4.5 Source-of-truth strategy and the "cannot diverge" argument (addresses the user's explicit ask)

**`InventoryTransaction` is the single, unapologetic source of truth for every quantity change in this
system — raw material and finished goods alike.** `StockBalance` (style+warehouse aggregate) and
`FinishedGoodsStockBalance` (variant+location+status detail) are **both** derived caches of that one ledger,
never independently authoritative, never computed by any path that does not also, in the same transaction,
insert the ledger row that justifies the change. This is not a new principle — it is the exact rule already
governing `StockBalance` today, extended to a second cache.

**The specific guarantees that make divergence a *constructed impossibility* under normal operation, not just
a hope:**
1. **Same-transaction write, mandatory, no fallback.** `recordInventoryTransaction()`'s `tx` parameter is
   already non-optional by design (`inventory.service.ts:33-41`'s own doc comment: no silent fallback that
   could let a careless caller start a second, independent transaction). The new `FinishedGoodsStockBalance`
   branch is added *inside* this same function, using the exact same `tx` — it is structurally impossible for
   the ledger insert to succeed while the FG-balance upsert is skipped or runs against a different
   transaction, or vice versa.
2. **One shared input, never two independently-maintained numbers.** The per-variant quantities posted to
   `FinishedGoodsStockBalance` are never separately computed from the flat ledger quantity — they **are** its
   decomposition. The calling code (Production's completion screen, Dispatch's pick screen) collects a set of
   `{productVariantId, quantity}` lines from the user, validates that they sum to exactly the batch/dispatch
   total (the same `EPSILON`-tolerant sum-equality check already used by `createLot()`'s own
   `LotVariantBreakdown` validation), and then posts **both** the one flat ledger entry (the sum) and the N
   per-variant ledger entries (the breakdown) from that single validated list — there is no code path where a
   developer could type the flat total and the per-variant breakdown as two unrelated numbers.
3. **Rounding is structurally impossible to introduce**, because there is no "divide and round" computation
   anywhere in this design — the variant breakdown is user-supplied and server-validated to sum exactly
   (within the project's existing `EPSILON = 0.0001` tolerance), never derived by a formula that could
   introduce its own rounding error.
4. **The one residual risk, named honestly: a future caller that forgets to populate the new optional
   fields.** If a new FG-relevant transaction type is added later by a developer who doesn't supply
   `productVariantId`, `StockBalance` still updates correctly (its branch is unconditional) but
   `FinishedGoodsStockBalance` silently does not — an *undercount*, never a *wrong* number, but still a real
   risk worth a second line of defense. **Mitigation: FGI-013**, a periodic reconciliation job/report
   (mirroring the project's own already-stated "nightly reconciliation job is mandatory" principle for the
   original ledger/`StockBalance` pair) that compares, for every FG-tracked `(companyId, productId,
   warehouseId)`: `StockBalance.quantityOnHand` vs. `sum(FinishedGoodsStockBalance.quantityOnHand)` across
   every variant/location/status row under that same key (including the nullable-variant "unallocated"
   bucket from §4.7) — and alerts on any mismatch. This is defense-in-depth against a future coding mistake,
   not a tacit admission that the design above can drift under correct usage.

### 4.6 Idempotency for Dispatch-side stock deductions

The new `FinishedGoodsPickLine` postings inherit `confirmDispatch()`'s own existing retry-safety mechanism —
they do **not** need a new, separate idempotency-key mechanism of their own. `confirmDispatch()` already
transitions `Dispatch.status` from `PACKED` to `DISPATCHED` via a guarded, status-conditional update; a
genuine retry of an already-succeeded confirm call fails that status guard (`INVALID_STATE_TRANSITION`)
*before* any inventory-posting code re-executes, exactly as it already does today for the existing flat
`DISPATCH` posting. Since the new pick-line postings run inside that same guarded call, they are covered by
the identical protection with zero new code required for it.

### 4.7 Historical data migration and reconciliation (addresses the user's explicit ask — new in this revision)

**The honest starting fact: there is no way to retroactively know which physical units of existing Finished
Goods stock belong to which colour/size.** That information was never captured by any pre-this-module
posting. This plan does **not** fabricate a guess, backfill an arbitrary split, or silently zero anything out.

**Proposed procedure:**
1. At go-live, for every `(companyId, productId, warehouseId)` with a non-zero existing `StockBalance
   .quantityOnHand` at a `FINISHED_GOODS`-typed warehouse, create exactly one
   `FinishedGoodsStockBalance` row with `productVariantId = NULL`, `warehouseLocationId = NULL`,
   `stockStatus = SALEABLE`, `quantityOnHand = StockBalance.quantityOnHand` — a one-time, additive,
   fully-audited backfill `INSERT` (never an `UPDATE`/`DELETE` against anything existing), run as its own
   dated script with a direct before/after SQL verification, matching this project's own established
   migration-verification discipline.
2. This `productVariantId = NULL` row is surfaced in every new screen as a clearly-labeled **"Unallocated
   (Pre-Migration) Stock"** bucket — never silently merged into a real variant's own number, never hidden.
3. A guided **Reconciliation / Opening Variant Allocation** action (an extension of the Stock Adjustment
   screen, reusing its own approval-gated posting mechanism — not a one-off data patch) lets a warehouse user
   manually count physical stock and allocate it out of the unallocated bucket into real variant rows over
   time, at their own pace. Each allocation posts as a genuine, audited, reversible pair of ledger entries
   (debit the `NULL`-variant row, credit the specific variant row) — never a direct row edit.
4. **The honest limitation, stated plainly rather than hidden:** until a given style/warehouse is fully
   reconciled, that style's per-variant Available Stock figures necessarily understate true physical
   availability by whatever remains in its own unallocated bucket. The new Finished Goods Dashboard
   explicitly surfaces "N units of unallocated legacy stock remain for this style — run a reconciliation
   count" rather than letting this show up as an unexplained discrepancy.
5. **The unallocated bucket only ever shrinks after go-live, never grows** — every new Production receipt and
   every new Dispatch from this module forward *requires* a real variant breakdown (§6), so nothing new is
   ever posted into the `NULL`-variant row again once this module is live.

### 4.8 Company-scoping statement (addresses the user's explicit ask)

Every new table in this plan (`FinishedGoodsStockBalance`, `FinishedGoodsReservation`,
`FinishedGoodsReceipt`/`Item`, `FinishedGoodsPickLine`) carries its own explicit `companyId` column, checked
at every read and write via the existing chokepoint-validation pattern (`InventoryScopeRepository`-style
company-ownership checks before any cross-table join is trusted) already used throughout
`recordInventoryTransaction()` and every other module in this codebase. Branch-level scoping (where
applicable, e.g. a reservation's own `branchId`) reuses the existing `getAllowedBranchIds()`/
`branchScopeWhere()` mechanism already wired into every other branch-scoped module — no new branch-scoping
mechanism is introduced.

---

## 5. Warehouse location and putaway workflow

1. **Finished Goods Receipt** (from Production, §6) posts into a `FinishedGoodsStockBalance` row with
   `warehouseLocationId = null` (staging) by default, or directly into a chosen location if assigned at
   receipt time.
2. **Putaway screen** (Step 5, screen 5) lists every staging (`warehouseLocationId = null`, real
   `productVariantId`) balance row, lets the user split it across one or more real locations in one action —
   logged via `writeAuditLog` with the same discipline as every other FG write.
3. **Stock Transfer screen** (screen 6) covers warehouse-to-warehouse AND location-to-location-within-one-
   warehouse transfers, both via the extended `createStockMovement()` (§4.4).
4. Every write path re-validates warehouse/location ownership (§4.8) and branch access.
5. Transfers exceeding available eligible stock are rejected by the same atomic guarded-decrement pattern
   used everywhere else in this plan.

---

## 6. Production-to-FG integration design

1. The **trigger point does not move** — a batch reaching a final `ProductionStage` via Forward/QC-Accept/
   Job-Work-cascade remains the one moment FG stock increases. The existing `isFinal`-stage mechanism and its
   existing idempotency guard are reused exactly.
2. **New, explicit UI/API input required at that moment:** completing a batch onto a final stage now also
   requires specifying which colours/sizes make up that specific batch, since a partial completion may not
   proportionally match the lot's originally-declared `LotVariantBreakdown`. This is new, real UX work on the
   existing Forward/QC-Accept screens — flagged explicitly, not silently assumed solvable by reusing
   `LotVariantBreakdown` as-is.
3. **`completeAtFinalStageInTx()` is extended, not replaced:** it keeps posting its existing, unchanged
   `PRODUCTION_RECEIPT` ledger entry (the flat style-level total, so every existing raw-material-agnostic
   report/check keeps working with zero change), and *additionally*:
   - Creates a `FinishedGoodsReceipt` header linked to the originating `Lot`/`JobOrder`/`ProductionOrder`,
     plus one `FinishedGoodsReceiptItem` row per colour/size in the supplied breakdown.
   - Calls `recordInventoryTransaction()` once per colour/size line (not once per batch) with the new
     `productVariantId` populated — per §4.5, point 2, these per-variant postings are the decomposition of
     the one flat posting, never a second, independently-computed number.
4. **Idempotency is inherited, not rebuilt** — the same guarded accumulator that already protects the flat
   posting today protects the new FG-specific additions, since both happen inside the same transaction and
   the same guard.
5. **Multiple/partial receipts are inherently supported**, exactly as today.

---

## 7. Dispatch integration design

1. **The pre-check is extended, not replaced.** `confirmDispatch()`'s existing `getAvailableQuantity()` call
   (style-aggregate) is **kept as the outer gate**, and a **second, new, variant-aware check** is added
   underneath it: the sum of a dispatch's own `FinishedGoodsPickLine`s for a given variant must not exceed
   that variant's own `Available` (§4.2) figure. Both checks must pass.
2. **Multi-location picking, via the approved `FinishedGoodsPickLine` entity (Decision 3):** a new child
   entity of `DispatchItem` — `{id, companyId, dispatchItemId, productVariantId, warehouseLocationId,
   quantity, pickedAt, pickedByUserId}` — tracks exactly which physical location(s) a `DispatchItem`'s
   quantity was picked from, independent of how it is later packed into cartons. `CartonItem` is **completely
   unchanged** by this plan — it remains a pure packing-list concern. `confirmDispatch()`'s existing per-
   `DispatchItem` posting loop becomes: one `recordInventoryTransaction()` call **per pick line**, each
   populating the ledger's own already-existing, currently-unused `warehouseLocationId` column. The *sum* of
   these calls for one `DispatchItem` is still posted into the exact same flat `StockBalance` update as today
   — the existing style-level number is always exactly right, just now composed from several finer-grained
   ledger rows instead of one.
3. **Partial picks are a native case, not an edge case** — a `DispatchItem`'s pick lines do not need to sum
   to its full `dispatchedQuantity` at any intermediate moment while the dispatch is still `DRAFT`/`PACKED`;
   only at Confirm-Dispatch time must the total across all of that item's pick lines equal
   `dispatchedQuantity` exactly (validated before the transaction opens, enforced atomically inside it).
4. **Idempotent stock deductions** — see §4.6: inherited from `confirmDispatch()`'s own existing status-
   transition guard, no new mechanism needed.
5. **Reservation consumption** happens in the same transaction, immediately after each pick line posts
   (§4.2).
6. **Extra Dispatch Quantity — explicitly preserved, not touched.** Regular and extra quantity continue to
   share exactly one stock pool, checked together as one total at the one Confirm-Dispatch checkpoint
   (`dispatch.service.ts:629-657`), unchanged. The new variant-level check in point 1 applies identically to
   the combined regular+extra total for that variant — there is no separate, looser check for extra quantity.
   The existing approval-threshold gate (`extraDispatchNeedsApproval()`) is untouched.
7. **Cancellations/returns** post compensating (reversing) ledger entries exactly as every other reversal in
   this codebase already does — never a direct balance edit.
8. **Make-to-stock dispatch remains out of scope**, per the confirmed-still-true `Dispatch.salesOrderId`
   required-field constraint — not requested, not changed here.

---

## 8. Implementation phases with task IDs, dependencies, risks, and acceptance criteria

Using prefix **FGI-xxx**, deliberately distinct from the Platform SaaS initiative's `PLAT-xxx` numbering, per
the explicit instruction to keep the two tracked separately. Every task starts `NOT STARTED`. **No task in
any phase begins until the user gives explicit approval to start Phase 0** — this document itself remains
planning-refinement-only per the current authorization.

### Phase 0 — Schema and RBAC (additive only, one migration set)

#### FGI-001 — `StockStatus` enum; `InventoryTransaction` gains `productVariantId`/`stockStatus`

**Status:** VERIFIED — see §11 for full evidence.
- **Dependencies:** None.
- **Risk:** Low — both columns nullable, zero existing rows affected, zero existing query shape changes.
- **Acceptance Criteria:**
  - [x] `StockStatus` enum (`SALEABLE`, `REJECTED` — no `QC_HOLD` value, per Decision 1) added.
  - [x] `InventoryTransaction.productVariantId` (nullable FK → `ProductVariant`) and `.stockStatus` (nullable)
        added.
  - [x] `npx prisma validate` clean; migration applies cleanly against a representative copy of the real
        schema with zero data loss.
  - [x] Every existing `InventoryTransaction` row has `productVariantId = NULL`/`stockStatus = NULL` after
        migration (confirmed via direct SQL, not just tooling output).

#### FGI-002 — `FinishedGoodsStockBalance` model

**Status:** VERIFIED — see §11 for full evidence.
- **Dependencies:** FGI-001 (shares the `productVariantId`/`StockStatus` types).
- **Risk:** Medium — the nullable-`productVariantId` + partial-unique-index design is a less common pattern
  in this schema and needs careful constraint testing to ensure exactly one "unallocated" row can exist per
  key tuple, never two, while still allowing unlimited distinct real-variant rows under the same tuple.
- **Acceptance Criteria:**
  - [x] Model added with the exact shape in §4.1, including the explicit `companyId` column (§4.8).
  - [x] A unique constraint prevents two rows with the same
        `(companyId, productId, warehouseId, warehouseLocationId, stockStatus)` when `productVariantId` is a
        real (non-null) value.
  - [x] A **separate**, hand-verified partial unique index prevents two rows with the same
        `(companyId, productId, warehouseId, warehouseLocationId, stockStatus)` when `productVariantId IS
        NULL` — confirmed by a direct SQL insert attempt that correctly fails.
  - [x] Zero existing tables/columns altered.

#### FGI-003 — `FinishedGoodsReservation` model

**Status:** VERIFIED — see §11 for full evidence.
- **Dependencies:** None (independent of FGI-001/002 at the schema level, though its *service* layer depends
  on FGI-002's balance rows existing — see Phase 1).
- **Risk:** Low — new, standalone table.
- **Acceptance Criteria:**
  - [x] Model added with the exact shape in §4.2, including explicit `companyId`.
  - [x] `status` enum (`ACTIVE`/`RELEASED`/`FULFILLED`) added.
  - [x] No existing table/column altered.

#### FGI-004 — `FinishedGoodsReceipt` / `FinishedGoodsReceiptItem` models + new `DocumentType`/`RelatedModule` values

**Status:** VERIFIED — see §11 for full evidence.
- **Dependencies:** None at the schema level.
- **Risk:** Low — new tables, reserved-then-consumed enum values following the existing established pattern.
- **Acceptance Criteria:**
  - [x] Both models added, each with explicit `companyId`.
  - [x] New `DocumentType` value added and confirmed to draw a real number via the existing
        `generateDocumentNumber()`/`document_sequences` engine with zero changes to that shared service.
  - [x] New `RelatedModule` value added for attachment/audit-log polymorphism.

#### FGI-005 — `WarehouseLocation.shelf`

**Status:** VERIFIED — see §11 for full evidence.
- **Dependencies:** None.
- **Risk:** Low — single nullable column addition.
- **Acceptance Criteria:**
  - [x] Column added, nullable, zero existing rows require a value.
  - [x] Existing `WarehouseLocation` CRUD (create/update/deactivate) unaffected — confirmed by the full
        existing test suite for that module passing unmodified.

#### FGI-006 — `StockMovementItem` gains `productVariantId`/`toWarehouseLocationId`; item-type-family validation

**Status:** VERIFIED — see §11 for full evidence.
- **Dependencies:** FGI-001/002 (variant identity), existing `StockMovement` mechanism.
- **Risk:** Medium — the real risk here is entirely at the *validation* layer (Phase 1), not the schema
  itself; flagged now so Phase 1 does not treat this as a trivial follow-on. A validation gap could let a
  raw-material and finished-goods line coexist in one document, which this plan explicitly requires be
  impossible.
- **Acceptance Criteria:**
  - [x] Both columns added, both nullable.
  - [x] Existing raw-material `StockMovement` rows/flows completely unaffected (regression-tested in Phase
        1, not assumed here).

#### FGI-007 — `FinishedGoodsPickLine` model

**Status:** VERIFIED — see §11 for full evidence.
- **Dependencies:** FGI-001/002 (variant identity), existing `DispatchItem`/`WarehouseLocation`.
- **Risk:** Low at the schema level — `CartonItem` is explicitly untouched (Decision 3), so there is no risk
  of this change rippling into the existing packing-list/carton-barcode functionality.
- **Acceptance Criteria:**
  - [x] Model added with the exact shape in §7, point 2, including explicit `companyId`.
  - [x] `CartonItem`/`Carton` confirmed byte-for-byte unchanged (zero lines touched in that part of the
        schema).

#### FGI-008 — RBAC: new `fg_inventory` module

**Status:** VERIFIED — see §11 for full evidence.
- **Dependencies:** None at the schema level (a config-file change, not a migration).
- **Risk:** Low-Medium — the risk is entirely in getting the action-to-route mapping right (so e.g. "post"
  means something specific and consistent within this one new module, matching how "post" already has a
  specific, documented meaning within `dispatch`), not in the mechanism itself.
- **Concrete mapping, implemented exactly as follows (Decision 4):**
  - New module key: `fg_inventory`. Actions used: `view, create, edit, post, approve, export, print` — **all
    already-existing** generic actions, no new verb invented.
    - `view` — Dashboard, Stock List, Style/Colour/Size Detail, Receipts, Location-wise Report, FG-scoped
      Stock Movement History.
    - `create` — raise a draft Stock Adjustment or Stock Transfer; record a Putaway/reconciliation-
      allocation action.
    - `edit` — edit a draft Adjustment/Transfer before posting.
    - `post` — confirm/finalize a Transfer or an Adjustment (mirrors `dispatch`'s own existing "post" =
      `confirmDispatch()` precedent exactly).
    - `approve` — approve a Stock Adjustment crossing a configured threshold (mirrors
      `extraDispatchNeedsApproval()`'s own pattern).
    - `export`/`print` — reports/documents.
  - **Picking has no new permission** — gated entirely under the *existing* `dispatch` module's existing
    `create`/`edit`/`post` actions (`WAREHOUSE_USER` already holds `create`/`edit` without `post`;
    `DISPATCH_MANAGER`/`SUPER_ADMIN` already hold `post`) — no RBAC change needed in `dispatch` itself.
  - **Reservation has no permission at all** — fully automatic, triggered by `sales_orders`'
    `confirmSalesOrder()` and `dispatch`'s `confirmDispatch()`, both already gated under their own existing
    modules.
  - Proposed role grants on `fg_inventory` (mapped onto each role's existing `inventory`/`dispatch` grant
    shape, per `src/config/rbac.ts`): `STORE_MANAGER`: `view, create, edit, post, export, print` (mirrors
    their existing broadest `inventory` grant); `WAREHOUSE_USER`: `view, create, edit` (mirrors their
    existing `inventory`/`dispatch` grant shape — can raise, cannot post/approve);
    `DISPATCH_MANAGER`: `view` only (their picking authority stays entirely under their existing `dispatch`
    grants); `MANAGEMENT`: `view, approve, export` (mirrors their existing `inventory`/`dispatch` pattern);
    `PRODUCTION_MANAGER`/`QC_MANAGER`: `view` only; `ACCOUNTS_MANAGER`/`ACCOUNTS_EXECUTIVE`: no grant
    (consistent with their existing total absence of any `inventory` grant); `VIEWER`: `view`; `SUPER_ADMIN`:
    all (automatic, via the existing wildcard).
- **Acceptance Criteria:**
  - [x] New `fg_inventory` module key added to `MODULES` in `src/config/rbac.ts`.
  - [x] Role grants added exactly as proposed above.
  - [x] Zero changes to any existing module's grants (`dispatch`, `sales_orders`, `inventory`,
        `material_request`, `purchase_order` all byte-for-byte unchanged).
  - [x] A unit test confirms the exact grant shape for every intended role, that unintended roles get
        nothing, and that picking/reservation have no permission of their own (no routes exist yet in
        Phase 0 to test end-to-end — this is the real, available-today form of this criterion).

**Phase 0 unresolved risks (named, not hidden):**
1. The partial-unique-index pattern for `FinishedGoodsStockBalance`'s nullable `productVariantId` (FGI-002)
   is less common elsewhere in this schema and needs explicit, direct-SQL constraint testing before Phase 1
   code is built against it — a wrong index definition would surface as a silent duplicate-row bug, not a
   loud failure.
2. `StockMovementItem`'s item-type-family validation (FGI-006) is schema-easy but validation-hard — the real
   risk lives entirely in Phase 1's service-layer code, not in this phase's own schema change, and must be
   explicitly regression-tested against the existing raw-material Stock Movement test suite before being
   considered safe.
3. RBAC action-to-route mapping (FGI-008) is a judgment call with a concrete proposal given here — low risk
   of being *wrong* in a security sense (worst case is an over- or under-granted role, caught by the
   project's own existing RBAC-audit discipline), but real risk of needing a second pass once real screens
   (Phase 5) reveal a route this mapping didn't anticipate.

**Phase 0 exit criteria:** `npx prisma validate`, `npx tsc --noEmit`, `npx eslint .`, and the full existing
`npx vitest run` suite all clean with zero regressions; every new table/column/index independently re-
verified via direct SQL against an isolated verification database (never trusted from `prisma migrate
resolve --applied` output alone, per this project's own established gotcha); zero behavior change to any
existing route, page, or report (since Phase 0 adds only unused-until-Phase-1 schema and an RBAC module with
no routes gated on it yet).

---

### Phase 1 — Core ledger/service layer
- **FGI-010** — Extend `recordInventoryTransaction()` with the additive `FinishedGoodsStockBalance` upsert
  branch. *Acceptance criteria:* zero behavior change for any existing caller (full existing suite green,
  unmodified); a new caller supplying `productVariantId` correctly creates/decrements the matching balance
  row inside the same transaction as the ledger insert; a guarded-decrement race test proves `{count: 0}`
  correctly rejects an over-decrement attempt.
- **FGI-011** — `finished-goods-reservation.service.ts`. *Acceptance criteria:* reserve/consume/release
  lifecycle fully covered by unit tests including the guarded-consumption race case (§4.2); releasing an
  already-partially-consumed reservation frees only the unconsumed remainder.
- **FGI-012** — `finished-goods-receipt.service.ts`, wrapping `completeAtFinalStageInTx()`. *Acceptance
  criteria:* a retried/duplicate completion call is rejected by the inherited guard (a direct regression test
  mirroring the historical ERP-BUG-0001 fix's own existing test); the sum of posted per-variant quantities
  always exactly equals the flat quantity posted in the same call (§4.5, point 2 — asserted directly in a
  unit test, not just reasoned about).
- **FGI-013 (new in this revision)** — Ledger/balance reconciliation job and report (§4.5, point 4; §4.7).
  *Acceptance criteria:* for a deliberately-corrupted test fixture (a `FinishedGoodsStockBalance` row
  manually desynced from its own `StockBalance` total), the report correctly flags the mismatch; for a clean
  fixture, the report shows zero drift.
- **FGI-014** — Widen `createStockMovement()`'s item-type validation per Decision 2/§4.4. *Acceptance
  criteria:* a document mixing a raw-material and a finished-goods line is rejected at both the Zod layer and
  a service-layer assertion (two independent tests, not one); every existing raw-material Stock Movement test
  passes unmodified; a new finished-goods Transfer/Adjustment test suite covers the same guarded-decrement
  race pattern as FGI-010.

### Phase 2 — Production integration
- **FGI-020** — Extend the Forward/QC-Accept-to-final-stage UI and API to accept an explicit colour/size
  completion breakdown. *Acceptance criteria:* the breakdown must sum to the batch quantity within `EPSILON`
  or the whole action is rejected before any posting occurs; omitting a breakdown on a style with configured
  variants is rejected with a clear, named error (never silently defaulting to an arbitrary split).
- **FGI-021** — Wire `FinishedGoodsReceipt` creation into `completeAtFinalStageInTx()`. *Acceptance
  criteria:* one `FinishedGoodsReceipt` + correct `Item` rows created per completion event, correctly linked
  back to the real `Lot`/`JobOrder`/`ProductionOrder`; multiple partial receipts against one lot over time
  each create their own, independent receipt record.

### Phase 3 — Warehouse/location/putaway
- **FGI-030** — Putaway workflow. *Acceptance criteria:* splitting a staging balance across N real locations
  in one action leaves the staging row's quantity reduced by exactly the sum moved, and each destination
  location's own balance increased by its own exact share — verified via a direct sum-invariant test, not
  just a happy-path check.
- **FGI-031** — Stock Transfer screen + service. *Acceptance criteria:* a transfer exceeding available stock
  at the source is rejected by the guarded decrement, not merely the pre-check; a transfer between two
  locations in the same warehouse and a transfer between two different warehouses are both covered by
  dedicated tests.
- **FGI-032** — Stock Adjustment screen + service, approval-gated. *Acceptance criteria:* an adjustment
  crossing the configured threshold requires a second, self-approval-guarded sign-off (mirroring
  `extraDispatchNeedsApproval()`'s own existing test pattern exactly); every adjustment, approved or not, is
  fully audit-logged.

### Phase 4 — Dispatch integration
- **FGI-040** — Multi-location picking (`FinishedGoodsPickLine` creation at pack time). *Acceptance
  criteria:* a dispatch item's pick lines are validated to sum to its `dispatchedQuantity` exactly before
  Confirm-Dispatch proceeds; a partial pick (less than the full item quantity) is a valid, supported
  intermediate state while the dispatch is still `DRAFT`/`PACKED`.
- **FGI-041** — Reservation consumption wired into `confirmDispatch()`; the new, additive variant-level
  availability check. *Acceptance criteria:* a dispatch confirm that would oversell a specific variant is
  rejected even when the style-level aggregate check alone would have passed it — a dedicated regression test
  proving the new check is genuinely additive, not a replacement, by constructing a case where the old check
  alone would have incorrectly allowed the dispatch.
- **FGI-042** — Regression verification only: Extra Dispatch Quantity's existing rule set, byte-for-byte
  unaffected. *Acceptance criteria:* the full existing Extra-Dispatch-Quantity test suite passes completely
  unmodified; a new test confirms the combined regular+extra total is still checked against the SAME pool at
  the variant level, with no separate "extra" pool introduced.

### Phase 5 — UI/Screens (the brief's own 9 screens, each a discrete task)
- **FGI-050** Finished Goods Dashboard (including the unallocated-legacy-stock callout, §4.7)
- **FGI-051** Finished Goods Stock List (filterable: Style, Product, Colour, Size, Warehouse, Location, Lot,
  Stock Status)
- **FGI-052** Style/Colour/Size Stock Details
- **FGI-053** Finished Goods Receipts (list + detail)
- **FGI-054** Warehouse Putaway / Location Assignment (including the Reconciliation/Opening-Allocation flow)
- **FGI-055** Stock Transfer
- **FGI-056** Stock Movement History (FG-scoped view over the extended Stock Movement list)
- **FGI-057** Stock Adjustment (with approval + audit trail)
- **FGI-058** Warehouse Location-wise Stock Report
- **FGI-059** Navigation: new "Finished Goods Inventory" entry under the existing "Inventory" menu section
  (`navigation.ts:162-173`), alongside the untouched existing Raw Material Inventory links.

*Acceptance criteria common to every FGI-05x screen task:* gated correctly per the FGI-008 RBAC mapping
(verified by a logged-in-as-each-affected-role browser check, not just a unit test); reads exclusively from
the new cache tables (never re-derives from the ledger at request time, matching `StockBalance`'s own
existing "derived cache, not summed live" discipline); zero console/network errors on load with real,
non-empty seed data.

### Phase 6 — Reports/exports
- **FGI-060** — Export support (CSV/Excel) for the Stock List and Location-wise Report, following this
  project's own existing export conventions. *Acceptance criteria:* exported totals match the on-screen
  totals exactly (byte-for-byte, not just visually).

### Phase 7 — Full regression, security, and end-to-end verification
- **FGI-070** — Full project `prisma validate`/`tsc --noEmit`/`eslint`/`vitest run`/`next build`, plus a live
  browser walkthrough of the full flow described in §9 (test plan), via the `run-fashion-erp` skill.
  *Acceptance criteria:* every item in §9's test plan passes, including the explicit reconciliation-drift and
  historical-unallocated-stock scenarios — not just the "new data, clean path" happy path.

---

## 9. Migration and rollback strategy

- **Every schema change in Phase 0 is additive**: new nullable columns, new tables, new enum. Zero `ALTER` or
  `DROP` on any existing required column.
- **The one genuinely non-trivial data operation is the Phase-0-adjacent, one-time historical backfill
  described in §4.7** — a pure `INSERT` of one summary row per existing non-zero FG `StockBalance`, never an
  `UPDATE`/`DELETE` of anything that already exists. This is run as its own dated, independently-verified
  script (direct SQL before/after check), not folded silently into a schema migration.
- Applied via this project's own established non-interactive workaround (`prisma migrate diff
  --from-config-datasource` → hand-placed SQL → `prisma db execute` → `prisma migrate resolve --applied`),
  with every new table/column independently re-verified via a direct SQL query — never trusted from
  `resolve --applied` output alone.
- **Rollback is a clean file/row-level revert at every phase** — since nothing existing is ever edited in
  place, rolling back means deleting the new tables/columns/rows and the new service/UI files; no existing
  raw-material or (pre-this-module) finished-goods workflow is ever put in a state that depends on the new
  additions existing.
- No destructive migration is proposed anywhere in this plan.

---

## 10. Test plan

**Unit tests** — see each FGI task's own Acceptance Criteria in §8 for the specific, per-task list; the
cross-cutting patterns reused throughout are: guarded-`updateMany` `{count: 0}` rejection tests (mirroring
`inventory.service.test.ts`/`dispatch.service.test.ts`'s own existing idiom), the sum-equality invariant
between a flat posting and its own variant breakdown (§4.5), and the reconciliation-drift detector (FGI-013).

**Integration tests:**
- Production completes a batch with a colour/size breakdown → `FinishedGoodsReceipt` + per-variant ledger
  rows created → Stock List reflects the correct variant/location totals, and the existing flat
  `StockBalance` total matches exactly.
- Sales Order confirm → `FinishedGoodsReservation` created → Dispatch confirm (partial, multi-location) →
  reservation consumed correctly → `Available` recalculates correctly across all affected rows.
- **Regression-critical:** Extra Dispatch Quantity still bounded by exactly the same combined-total check as
  today, now additionally checked at the variant level without weakening the existing style-level gate.
- **New in this revision:** a Stock Movement document attempting to mix a raw-material line and a
  finished-goods line is rejected; the reconciliation/opening-allocation flow correctly reduces the
  unallocated bucket and increases a real variant's balance by matching amounts, with a full audit trail.

**Security tests:**
- Tenant isolation on every new table (company-scoped queries throughout, reusing the existing
  `getAllowedBranchIds()`/`branchScopeWhere()` pattern where branch-scoping applies).
- RBAC gating on every new route under the new `fg_inventory` module key, including the `view`/`create`/
  `edit`/`post`/`approve` distinctions from §8, FGI-008, and confirmation that picking stays correctly gated
  under the *existing* `dispatch` module rather than silently requiring a new permission nobody has yet.
- Negative-stock impossibility under concurrent load for the new `FinishedGoodsStockBalance` table and the
  new `FinishedGoodsReservation` table, proven via a genuine concurrent-write test, not just a sequential one.
- Warehouse/location ownership validation — a cross-company or cross-branch location/warehouse id is
  rejected as a clean `NOT_FOUND`, never a silent cross-tenant write.

**End-to-end walkthrough** (via the `run-fashion-erp` skill once implementation is complete): Production
completes a batch with a real colour/size breakdown → a `FinishedGoodsReceipt` appears → putaway splits it
across multiple real locations → a Sales Order is confirmed (reservation held) → a Dispatch picks from two
different locations for a partial quantity and confirms → stock decrements exactly once, the reservation is
correctly consumed, `Available` recalculates correctly → a Stock Adjustment is raised, goes through approval,
and is reflected in the ledger with full audit history → the Warehouse Location-wise Stock Report shows the
final, correct state across every location touched → **(new)** the Finished Goods Dashboard correctly shows
a non-zero "unallocated legacy stock" figure for a style with pre-existing historical balance, and running
the reconciliation flow against it correctly reduces that figure and populates a real variant row.

---

**Phase 0 (FGI-001 – FGI-008) is implemented and verified — see §11 below for full evidence. No Phase 1
task has begun. Awaiting explicit approval to start Phase 1.**

---

## 11. Phase 0 implementation status and evidence (2026-10-13)

**All 8 Phase 0 tasks (FGI-001 – FGI-008) are VERIFIED**, implemented and verified strictly one at a time,
in dependency order, exactly per the authorized scope. Every schema task was applied as its own, separate,
independently-tracked Prisma migration against an isolated, disposable PostgreSQL database
(`fashion_erp_fgi_phase0_scratch`, created fresh for this phase) — **never the shared development database,
never production** — and independently re-verified via direct SQL after each one, never trusted from
`prisma migrate resolve --applied` output alone, per this project's own established gotcha. Branch:
`finished-goods-inventory` (created fresh off `origin/main`), its own dedicated worktree, zero files shared
with the Platform SaaS `platform-saas-tracker` branch/worktree.

### FGI-001 — `StockStatus` enum; `InventoryTransaction` gains `productVariantId`/`stockStatus`

**Status:** VERIFIED.

**Files changed:** `prisma/schema.prisma` (additive); `prisma/migrations/20261013140000_fgi001_stock_status_and_variant_on_ledger/migration.sql` (new).

**Acceptance Criteria:**
- [x] `StockStatus` enum (`SALEABLE`, `REJECTED` — no `QC_HOLD`, per Decision 1) added
- [x] `InventoryTransaction.productVariantId`/`.stockStatus` added, both nullable
- [x] `npx prisma validate` clean; migration applies cleanly with zero data loss
- [x] Every existing `InventoryTransaction` row unaffected (both new columns NULL by default)

**Verification evidence:** Migration diff was purely additive (1 `CREATE TYPE`, 1 `ALTER TABLE ... ADD
COLUMN` ×2, 1 `CREATE INDEX`, 1 `ADD CONSTRAINT`) — zero `ALTER`/`DROP` on any existing column. 6/6 direct
SQL checks passed (enum values exact; both columns nullable/correct type; all 7 original columns
untouched; new FK → `product_variants.id` confirmed). `npx tsc --noEmit` (whole project) 0 errors; `npx
eslint .` 0 errors (13 pre-existing, unrelated warnings); `npx vitest run` (whole project) 2590/2590
passing, 0 regressions.

### FGI-002 — `FinishedGoodsStockBalance` model

**Status:** VERIFIED.

**Files changed:** `prisma/schema.prisma` (additive, incl. back-relations on `Company`/`Branch`/
`Product`/`Warehouse`/`ProductVariant`/`WarehouseLocation`); `prisma/migrations/20261013150000_fgi002_finished_goods_stock_balance/migration.sql` (new, including a hand-written COALESCE expression unique index).

**Acceptance Criteria:**
- [x] Model added with the exact shape in §4.1, including explicit `companyId`
- [x] A unique constraint prevents two rows with the same real-variant key tuple
- [x] A separate, hand-verified mechanism prevents two rows with the same key tuple when `productVariantId
      IS NULL` — **confirmed via a genuine concurrent-insert race, not just a sequential check**
- [x] Zero existing tables/columns altered

**Real correction made during implementation, reported per the "stop and report any conflict" instruction
(not a blocking conflict — a self-contained, confidently-resolved design gap, see below):** the original
plan draft's uniqueness design only discussed the `productVariantId` NULL case; it had not accounted for
`warehouseLocationId` (the "staging" dimension) having the **identical** NULL-collision problem under a
plain SQL unique constraint. Fixed by replacing the originally-sketched "separate ordinary unique + partial
unique index" approach with a single hand-written **expression unique index** —
`COALESCE(product_variant_id, '00000000-...'::uuid)` and `COALESCE(warehouse_location_id,
'00000000-...'::uuid)`, both inside one `CREATE UNIQUE INDEX` — which correctly handles both nullable
dimensions uniformly. This is a standard, well-established Postgres pattern, not a novel or risky one.

**Verification evidence — the real, required concurrency proof (control #8):** a dedicated script seeded
minimal real parent rows (Company/Branch/Warehouse/2 Locations/Product/Color/Size/ProductVariant) via the
real Prisma Client, then ran 13 checks: schema-level (table/column/index/FK shape, 7/7 passed);
**sequential** duplicate-NULL-variant rejection (passed); **sequential** duplicate-NULL-location rejection
under a real variant (passed); two rows with the same variant but different real locations both succeeding
(passed, proving real variants are never falsely blocked); and — the control #8 centerpiece — **two
genuinely simultaneous Postgres connections racing to INSERT the identical key tuple** (same company/
product/warehouse, NULL variant, NULL location, `REJECTED` status) via `Promise.allSettled`: exactly ONE
succeeded, exactly ONE was rejected, and the rejection was confirmed to be specifically the unique-
constraint violation (not some other error) — all 3 passed. 13/13 checks passed overall. All seeded test
data was cleaned up afterward, confirmed via the scratch DB returning to empty state. `npx tsc --noEmit`
0 errors; `npx eslint .` 0 errors; `npx vitest run` (whole project) 2590/2590 passing, 0 regressions.

### FGI-003 — `FinishedGoodsReservation` model

**Status:** VERIFIED.

**Files changed:** `prisma/schema.prisma` (additive, incl. back-relations); `prisma/migrations/20261013160000_fgi003_finished_goods_reservation/migration.sql` (new).

**Acceptance Criteria:**
- [x] Model added with the exact shape in §4.2, including explicit `companyId`
- [x] `status` enum (`ACTIVE`/`RELEASED`/`FULFILLED`) added
- [x] No existing table/column altered

**A real architectural conflict was found and resolved during implementation (reported, per the "stop and
report" instruction — resolved with a confident, well-supported fix rather than a genuine open question
needing your input, so implementation continued rather than pausing; flagged prominently here and in the
Phase 0 summary below for full visibility):** the original plan draft's schema sketch keyed this model on
`salesOrderItemId`. Direct inspection of `SalesOrderItem`'s own schema comment revealed that
`updateSalesOrder()`'s `replaceItems()` **deletes and recreates every `SalesOrderItem` row on every order
edit** — a reservation keyed on `SalesOrderItem.id` would be silently orphaned or cascade-deleted the
moment a Confirmed-but-not-yet-dispatched order is edited at all (even an unrelated field like delivery
date), well before any Dispatch exists to trigger the order's own separate "can't edit once referenced"
guard. **Fix:** re-keyed on `SalesOrderLine.id` instead — this project's own existing, purpose-built stable
line-identity model (added 2026-09-24 for Effective BOM specifically to survive this exact
delete-and-recreate behavior) — rather than inventing a second mechanism to solve an already-solved problem.

**Verification evidence:** 14/14 direct SQL checks passed, including the one load-bearing check:
**confirmed the FK genuinely points at `sales_order_lines`, not `sales_order_items`** — plus correct
nullability on every column, the status enum's exact 3 values, and confirmation that `sales_order_items`/
`sales_order_lines` themselves are completely untouched. `npx tsc --noEmit` 0 errors; `npx eslint .` 0
errors; `npx vitest run` (whole project) 2590/2590 passing, 0 regressions.

### FGI-004 — `FinishedGoodsReceipt`/`FinishedGoodsReceiptItem` models + new `DocumentType`/`RelatedModule` values

**Status:** VERIFIED.

**Files changed:** `prisma/schema.prisma` (additive, incl. back-relations on `ProductionOrder`/`Lot`/
`JobOrder`/`ProductVariant`/`InventoryTransaction`/`Company`/`Branch`/`Warehouse`/`Product`/`User`, plus
`DocumentType.FG_RECEIPT` and `RelatedModule.FINISHED_GOODS_RECEIPT`);
`prisma/migrations/20261013170000_fgi004_finished_goods_receipt/migration.sql` (new);
`src/core/numbering/DocumentNumberingService.ts` (one-line addition — `FG_RECEIPT: "FGR"` to the existing
exhaustive prefix map, the exact same mechanical step every prior `DocumentType` addition in this project's
history required; no change to the shared numbering logic itself).

**Acceptance Criteria:**
- [x] Both models added, each with explicit `companyId`
- [x] New `DocumentType` value draws a real number via the existing, unchanged
      `generateDocumentNumber()`/`document_sequences` engine
- [x] New `RelatedModule` value added for attachment/audit-log polymorphism

**Verification evidence:** 10/10 direct SQL checks passed (13 columns on the header, 5 on the item row,
correct nullability throughout, 8 FKs on the header covering every linked document, the unique receipt-
number index, both new enum values present and the `DocumentType` enum's total count growing by exactly
1). **A real functional smoke test of the numbering engine itself** (not just a schema check): called the
real, unmocked `generateDocumentNumber({ companyId, documentType: "FG_RECEIPT" })` twice against a real
seeded Company in the scratch DB — produced `FGR-2026-00001` then `FGR-2026-00002`, confirming the full
real pipeline (prefix resolution → atomic `document_sequences` counter → formatted number) works
end-to-end, not merely compiles. `npx tsc --noEmit` 0 errors (after the required `DocumentNumberingService`
prefix-map addition — this was the one place a missing prefix entry is a compile error by design, since the
map's own type is `Record<DocumentType, string>`); `npx eslint .` 0 errors; `npx vitest run` (whole
project) 2590/2590 passing, 0 regressions.

### FGI-005 — `WarehouseLocation.shelf`

**Status:** VERIFIED.

**Files changed:** `prisma/schema.prisma` (one nullable column);
`prisma/migrations/20261013180000_fgi005_warehouse_location_shelf/migration.sql` (new).

**Acceptance Criteria:**
- [x] Column added, nullable, zero existing rows require a value
- [x] Existing `WarehouseLocation` CRUD unaffected — confirmed by the full existing test suite for that
      module passing unmodified

**Verification evidence:** Direct SQL confirmed `shelf` exists, nullable, `text` type. The Warehouse
module's own existing test suite (`src/modules/warehouses`) — 15/15 tests — passed completely unmodified.
`npx tsc --noEmit` 0 errors; `npx eslint .` 0 errors; `npx vitest run` (whole project) 2590/2590 passing,
0 regressions.

### FGI-006 — `StockMovementItem` gains `productVariantId`/`toWarehouseLocationId`; item-type-family validation scaffolding

**Status:** VERIFIED (schema only, per Phase 0's own scope — the real item-type-family *validation logic* is
explicitly Phase 1's FGI-014, not built here).

**Files changed:** `prisma/schema.prisma` (two new nullable columns + two newly-named relations on
`StockMovementItem`↔`WarehouseLocation` to disambiguate source vs. destination, plus the matching
back-relations); `prisma/migrations/20261013190000_fgi006_stock_movement_item_variant_and_destination/migration.sql` (new).

**Acceptance Criteria:**
- [x] Both columns added, both nullable
- [x] Existing raw-material `StockMovement` rows/flows completely unaffected (regression-tested now, not
      merely assumed)

**Verification evidence:** Direct SQL confirmed both new columns + both new FKs present, and the
**original** `warehouse_location_id` FK/column completely untouched (6 total FKs: 4 original + 2 new; 9
total columns: 7 original + 2 new). **The Inventory module's own existing test suite (including Stock
Movement's own raw-material tests)** — `src/modules/inventory`, 138/138 tests across 4 files — passed
completely unmodified. `npx tsc --noEmit` 0 errors; `npx eslint .` 0 errors; `npx vitest run` (whole
project) 2590/2590 passing, 0 regressions.

### FGI-007 — `FinishedGoodsPickLine` model

**Status:** VERIFIED.

**Files changed:** `prisma/schema.prisma` (additive, incl. back-relations on `DispatchItem`/`Company`/
`ProductVariant`/`WarehouseLocation`/`User` — **`Carton`/`CartonItem` deliberately untouched**, per
Decision 3); `prisma/migrations/20261013200000_fgi007_finished_goods_pick_line/migration.sql` (new).

**Acceptance Criteria:**
- [x] Model added with the exact shape in §7, including explicit `companyId`
- [x] `CartonItem`/`Carton` confirmed byte-for-byte unchanged

**Verification evidence:** Direct SQL confirmed the new table's 8 columns (all required — every dimension
of a pick line is always known at pick time) and 5 FKs; **`carton_items`' own column count confirmed
unchanged (6 before, 6 after)** — the literal proof Decision 3's "independent of CartonItem" requirement was
honored, not just stated. **The Dispatch module's own existing test suite** —
`src/modules/dispatch`, 56/56 tests — passed completely unmodified. `npx tsc --noEmit` 0 errors; `npx
eslint .` 0 errors; `npx vitest run` (whole project) 2590/2590 passing, 0 regressions.

### FGI-008 — RBAC: new `fg_inventory` module

**Status:** VERIFIED.

**Files changed:** `src/config/rbac.ts` (new `"fg_inventory"` module key + 6 explicit role grants);
`src/config/rbac.test.ts` (new, 12 tests — this module had no dedicated test file before).

**Acceptance Criteria:**
- [x] New `fg_inventory` module key added to `MODULES`
- [x] Role grants added exactly as proposed in §8 (STORE_MANAGER full day-to-day ownership;
      WAREHOUSE_USER create/edit, no post/approve; DISPATCH_MANAGER/PRODUCTION_MANAGER/QC_MANAGER view-only;
      MANAGEMENT view/approve/export)
- [x] Zero changes to any existing module's grants (`dispatch`, `sales_orders`, `inventory`,
      `material_request`, `purchase_order` all byte-for-byte unchanged)
- [x] A unit test confirms unintended roles get nothing, and that picking/reservation have no permission of
      their own at all

**Verification evidence, per control #11 ("do not grant access automatically to unintended roles"):** a new
`rbac.test.ts` (12 tests) explicitly confirms: `SUPER_ADMIN` gets every action (its own pre-existing
wildcard mechanism — every other module already relies on this identically, not something newly
introduced); `VIEWER` gets view-only (same pre-existing wildcard); the 6 explicitly-intended roles get
exactly their documented grants (asserted with `toEqual`, not just `toContain`, so an accidental extra
action would fail the test too); and — the control #11 centerpiece — **`MERCHANDISER`, `SAMPLING_MANAGER`,
`PRODUCTION_SUPERVISOR`, `PRODUCTION_WORKER`, `EXTERNAL_UNIT_USER`, `ACCOUNTS_MANAGER`, and
`ACCOUNTS_EXECUTIVE` all get `undefined` (no key at all) for `fg_inventory`** — confirmed by a dedicated
test, not merely asserted in a comment. Two further tests confirm picking stays reachable only through the
pre-existing `dispatch` module's own `post` action (never through `fg_inventory`), and that no `"reserve"`
action exists anywhere in `ACTIONS` (reservation is fully automatic, never a discretionary permission).
12/12 tests passed. `npx tsc --noEmit` 0 errors; `npx eslint .` 0 errors; `npx vitest run` (whole project)
**2602/2602 passing** (2590 + 12 new), 0 regressions.

### Phase 0 overall exit verification

`npx prisma validate` clean on the complete, final schema (all 7 schema tasks together, not just
individually). `npx next build` succeeds with zero errors/warnings beyond the project's own 13 pre-existing,
unrelated ESLint warnings. `npx prisma migrate status` against the scratch database reports "Database
schema is up to date!" across all 175 migrations (168 pre-existing + 7 new). Every one of the 7 new
migrations was generated via `prisma migrate diff` (never hand-guessed), inspected before being applied, and
independently re-verified via direct SQL afterward — never trusted from tooling output alone.

**Two real findings were surfaced during implementation** (both already detailed in their own task sections
above, repeated here for visibility since they are the two most consequential facts from this whole phase):
1. **FGI-002**'s uniqueness design needed a correction to also cover `warehouseLocationId`'s NULL-collision
   case, not just `productVariantId`'s (fixed with one combined COALESCE expression index).
2. **FGI-003** needed to key on `SalesOrderLine.id`, not `SalesOrderItem.id`, to avoid a real correctness
   bug (reservation orphaning) caused by `updateSalesOrder()`'s own existing delete-and-recreate behavior.

Neither required your input to resolve — both have a single, confidently correct fix, reusing this
project's own existing, purpose-built mechanisms rather than inventing new ones — but both are flagged
prominently here, per the "stop and report any conflict" instruction, rather than silently folded in.

