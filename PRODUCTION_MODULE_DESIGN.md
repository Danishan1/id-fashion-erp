# Production Module (Phase 5C) — Consolidated Design

**Status: DESIGN ONLY. No schema, migration, API, or UI code has been written or modified for this phase.**
This document merges the earlier "Production Schema Blueprint" artifact with the corrections requested
in review, against the *actual* current schema (verified by direct inspection, not assumption — see
§0). It supersedes the old blueprint; differences are called out explicitly in §9 (Architecture Review).

---

## 0. Existing Architecture — Inspection Findings

Verified directly against `prisma/schema.prisma` (2064 lines), `src/config/rbac.ts`,
`src/core/numbering/DocumentNumberingService.ts`, and `src/modules/inventory/material-request.service.ts`
(the most recently built module, chosen as the reference pattern since it's the newest precedent).

| Existing thing | Verdict | Why |
|---|---|---|
| `SalesOrder` / `SalesOrderItem` | **REUSE**, no change | `SalesOrderStatus.IN_PRODUCTION` already exists and is explicitly reserved — a code comment in `sales-order.service.ts` already says it's meant to be set "as a side effect of creating a Production Order from this order." `SalesOrderItem` already has the trace-back-FK pattern (`sampleRequestId`) to copy for `ProductionOrder.salesOrderItemId`. |
| `Bom` / `BomItem` | **REUSE**, no change | One BOM per style (`productId @unique`), no versioning. `ProductionOrder` will snapshot a `bomId` pointer for audit purposes even though there's no version concept yet — cheap insurance if BOM versioning is ever added. |
| `MaterialRequest` / `MaterialRequestItem` | **MODIFY** | Add nullable `productionOrderId`. This is not a new idea — the current schema's own comment already flags the gap: *"no productionOrderId yet since Production (5C) doesn't exist... add it non-breaking later."* We're closing a gap the codebase already anticipated. No new "MaterialRequirement" table — a Production Order's material demand is just another `MaterialRequest` (reusing `createMaterialRequestFromShortfall`'s existing shape, sourced from `productionOrderId + bomId` instead of `salesOrderId`). |
| `InventoryTransaction` / `StockBalance` | **REUSE + small MODIFY** | `recordInventoryTransaction()`'s own doc comment already says *"Production (5C) ... expected to reuse this same engine later."* `PRODUCTION_RECEIPT` transaction type and `fabricRollId` column already exist and are exactly what Production needs. Two additions only: a `DAMAGE` transaction type, and a `PRODUCTION_ORDER` value on the `RelatedModule` discriminator enum. No new inventory tables. |
| `Warehouse` | **REUSE**, no change | `WarehouseType` enum already includes `WIP`, `FINISHED_GOODS`, and — critically — `REJECT`. `REJECT` is already the damage bucket this design needs; nothing to add. |
| `Product` / `ProductVariant` | **REUSE**, no change | |
| `ProductionStage` | **MODIFY** | Already exists (Phase 3), already used by 40+ records — keep the name, keep `code`/`name`/`sequence`/`parentStageId`/`isActive`. Add: `isFinal`, `allowRework`, `isQcRecommended` (advisory, not a gate — QC must remain possible anywhere per requirement), `departmentId` (FK existing `Department` master), `defaultOwnerEmployeeId` (FK existing `Employee` master, UI default only, not an enforcement gate). |
| `ProductionLine`, `Machine` | **REUSE**, no change | Referenced optionally from `JobOrder`. |
| `User` / `Role` / `Permission` / `RolePermission` / `UserBranchRole` | **REUSE**, no change | `User.employeeId` is already a unique, nullable FK to `Employee`. This turns out to directly resolve the worker-login question — see §7. |
| `Company` / `Branch` | **REUSE**, no change | Standard `companyId`(+`branchId`) scoping applies to every new table exactly as everywhere else. |
| `AuditLog` | **REUSE**, no change | Every new table logs through the existing `writeAuditLog()` helper with its own snake_case `tableName`. No second audit mechanism. |
| `DocumentType` enum | **REUSE**, no change | `PRODUCTION_ORDER` already exists in the enum and already has a reserved `PROD` prefix in `DocumentNumberingService`'s prefix map — unused until now. |
| `DocumentNumberingService` | **REUSE**, no change | `generateDocumentNumber({ documentType: "PRODUCTION_ORDER" })` → `PROD-2026-00001`. Lot numbers are a *sub*-sequence per order (`PROD-2026-00001-L01`), not a fiscal-year document number — generated from a simple counter column on `ProductionOrder`, not through this service (different concern, same as how Sales Order line numbers aren't separately sequenced either). |
| Soft-delete convention | **REUSE**, no change | Confirmed: transactional tables (`SalesOrder`, `MaterialRequest`, `InventoryTransaction`) have **no** `isActive`/`deletedAt` at all — status-driven lifecycle only. Every new Production transactional table (`ProductionOrder`, `Lot`, `JobOrder`, `ProductionStageTransaction`, `QcInspection`, `LotRelation`) follows the same rule. Only `ProductionStage`/`DefectType` (master data) keep `isActive`. |
| `ALLOWED_TRANSITIONS` pattern | **REUSE for ProductionOrder header status; REPLACE for Lot stage position** | `ProductionOrder.status` is a small fixed set (`PLANNED/MATERIAL_ALLOCATED/IN_PROGRESS/ON_HOLD/CANCELLED/CLOSED`) — the existing fixed-map idiom fits it fine. A **Lot's position across a company's configured stages** is not a fixed enum-to-enum map at all; it's runtime graph validation against `ProductionStage.sequence` (see §3). These are two separate state concerns and must not be conflated into one `ALLOWED_TRANSITIONS` table. |
| `production` RBAC module | **REUSE**, extend | Already exists in `src/config/rbac.ts` with role-action arrays seeded for `PRODUCTION_MANAGER`, `PRODUCTION_SUPERVISOR`, `QC_MANAGER`, etc. Only 3 new action verbs are needed beyond the standard 10 (`revert`, `restructure`, `skip_stage`) — see §7. |
| `Lot`, `JobOrder`, `Bundle`, `QcInspection`, `QcDefect`, `DefectType`, `ProductionOrder`, `ProductionStageTransaction` | **Confirmed absent** | Grepped directly — none exist. `FabricRoll` already exists (pulled forward in Phase 6) — **REUSE**, no change (see §6). |

---

## 1. Business Workflow

### Happy path
```
Sales Order (CONFIRMED)
  → BOM (existing, per style)
  → Production Order created (status: PLANNED)
      → sets SalesOrderItem's order to SalesOrderStatus.IN_PRODUCTION as a side effect
      → optionally generates a MaterialRequest (productionOrderId set, requestType=PRODUCTION_REQUIREMENT)
  → Material issued against that request (existing Material Request flow, unchanged)
      → ProductionOrder.status → MATERIAL_ALLOCATED
  → Lot(s) created against the Production Order (e.g. Lot-001 = 1,000 pcs)
      → ProductionOrder.status → IN_PROGRESS
  → Lot enters Stage 1 (e.g. Cutting) → auto-creates JobOrder #1
      → JobOrder #1 assigned to one or more workers (JobOrderAssignment rows)
      → Workers log progress (JobOrderProgressEntry: completed/rejected/damaged)
      → Supervisor forwards completed quantity → posts a ProductionStageTransaction → auto-creates JobOrder #2 at Stage 2
  → (repeat per configured stage)
  → QC performed at whichever stage the company configures (JobOrder-scoped, not stage-name-scoped)
      → Pass → continues forward
      → Partial Pass → accepted qty forwards, rejected qty reverts (mandatory reason)
      → Fail → full quantity reverts to a chosen earlier stage (mandatory reason)
  → Lot reaches the stage flagged IsFinal
      → auto-posts PRODUCTION_RECEIPT into a FINISHED_GOODS warehouse
      → Lot.status → COMPLETED
  → Once every Lot under a Production Order is COMPLETED/CANCELLED → ProductionOrder.status → CLOSED
```

### Exception paths
- **Partial completion**: a JobOrder can sit at `PARTIALLY_COMPLETED` indefinitely — nothing forces full completion before quantity is forwarded; forwarding is an explicit, separate action from logging progress.
- **Rejection / damage**: recorded per progress entry or QC inspection; repairable damage → rework transaction (no inventory event); fully damaged → one `DAMAGE` inventory transaction into a `REJECT` warehouse.
- **Rework**: a backward `ProductionStageTransaction`, mandatory reason, target stage validated (must be earlier in sequence, active, and have `allowRework=true`).
- **Lot split**: one lot, fully consumed, becomes N new lots (all-or-nothing — see §2.2 for why partial splits aren't supported in V1).
- **Lot merge**: N lots, each fully consumed, become one new lot (same product, same UOM, none with an open JobOrder).
- **Cancellation**: a JobOrder, a Lot, or the whole Production Order can be cancelled independently; cancelling a Lot does not touch sibling lots; cancelling every lot under an order does not auto-cancel the order (explicit action required) — mirrors how Sales Order / Material Request cancellation already works project-wide (status-driven, never cascading silently).
- **Stage failure / worker reassignment**: `JobOrderAssignment.status` flips to `REASSIGNED`; a new assignment row is created for the replacement worker. The old assignment row is never deleted — it stays as history.

---

## 2. Database Design

All new tables get `companyId` (+ `branchId` where the rest of the schema uses it) exactly like every existing table. Field lists below are the *logical* (camelCase) layer — `@map`/snake-case follows this project's existing convention, not written out here for brevity.

### 2.1 ProductionOrder — NEW

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| companyId, branchId? | uuid | standard scoping |
| orderNumber | string | `PROD-2026-00001` via `generateDocumentNumber` |
| salesOrderItemId | uuid, **nullable** | null = Make-to-Stock |
| productId | uuid | the style |
| bomId | uuid, nullable | snapshot pointer (BOM has no versioning yet, but audit trail should still point at "the BOM as it existed") |
| plannedQuantity | Decimal(18,4) | |
| status | `ProductionOrderStatus` | `PLANNED / MATERIAL_ALLOCATED / IN_PROGRESS / ON_HOLD / CANCELLED / CLOSED` |
| statusBeforeHold | enum?, nullable | same Hold/Resume pattern as every other module |
| priority | `ProductionPriority` | `LOW / NORMAL / HIGH / URGENT` |
| plannedStartDate, plannedEndDate, actualStartDate, actualEndDate | Date? | |
| nextLotSequence | Int, default 1 | internal counter for `-L01`, `-L02` lot suffixes — not a shared-sequence-service concern |
| requestedByUserId | uuid | |
| remarks | string? | |
| createdAt, updatedAt | | |

Indexes: `@@unique([companyId, orderNumber])`, `@@index([companyId, status])`, `@@index([salesOrderItemId])`, `@@index([productId])`.
No `isActive`/`deletedAt` — status-driven only.

### 2.2 Lot — NEW (first-class, not a string)

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| companyId, branchId? | uuid | |
| productionOrderId | uuid | |
| lotNumber | string | `PROD-2026-00001-L01` |
| quantity | Decimal(18,4) | **immutable** after creation except via a recorded split/merge event |
| uomId | uuid | |
| status | `LotStatus` | `PLANNED / IN_PROGRESS / ON_HOLD / COMPLETED / SPLIT / MERGED / CANCELLED` |
| currentStageId | uuid?, nullable | **cache only** — see §6 for why this must never become load-bearing |
| createdByUserId | uuid | |
| createdAt, updatedAt | | |

Indexes: `@@unique([companyId, lotNumber])`, `@@index([productionOrderId])`, `@@index([companyId, status])`.

**Business rules:**
- `quantity` is fixed at creation. A split or merge *closes* the source lot(s) (status → `SPLIT`/`MERGED`, terminal) rather than mutating their quantity.
- **Split is all-or-nothing in V1**: the sum of child quantities must exactly equal the parent's quantity in one operation. A partial split (only some of the parent's quantity carved out, remainder still active under the original lot) is **not supported in V1** — flagged as an open scope decision in §8, not silently dropped.
- **Split is blocked while the parent has an OPEN JobOrder** (i.e., a JobOrder not yet `COMPLETED`/`CANCELLED`). Splitting a lot mid-stage-in-progress is a real factory scenario but adds real complexity (which in-progress assignments/progress entries do the children inherit?) — deferred to V2, flagged in §8.
- **Merge requires every parent lot to be fully consumed** (its entire quantity rolls into the child; the parent becomes terminal `MERGED`). A partial merge isn't a separate concept — if a user wants to merge only *part* of a lot, they split it first, then merge the resulting piece. One mechanism, not two.
- **Merge requires all parent lots to share the same `productId` and `uomId`** — merging two different styles' lots has no physical meaning.
- **Merge is blocked if any parent has an OPEN JobOrder** — a lot can only be merged while "at rest" between stages.

### 2.3 LotRelation — NEW (genealogy)

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| companyId | uuid | |
| parentLotId | uuid | |
| childLotId | uuid | |
| relationType | `LotRelationType` | `SPLIT \| MERGE` |
| quantity | Decimal(18,4) | the slice of the parent that went into this specific child |
| reason | string? | |
| performedByUserId | uuid | |
| performedAt | timestamp | |

Indexes: `@@index([parentLotId])`, `@@index([childLotId])`.

Deliberately **not** `parentLotId` as a single column on `Lot` — a join table is what makes MERGE (many parents → one child) representable at all, and it makes SPLIT (one parent → many children) the same mechanism instead of a second one. Full genealogy (either direction, arbitrary depth) is a plain recursive walk over this table — no separate materialized "ancestry" table needed.

### 2.4 ProductionStage — MODIFY (existing table)

Add columns only, nothing removed, nothing renamed (40+ existing records must keep working):

| New field | Type | Notes |
|---|---|---|
| isFinal | Boolean, default false | landing here (forward) auto-fires the Finished-Goods receipt |
| allowRework | Boolean, default true | a stage can be marked "no rework back into this stage" (e.g. post-Dispatch labeling) |
| isQcRecommended | Boolean, default false | **advisory only** — QC remains possible at any stage regardless of this flag; it just pre-selects a default in the UI |
| departmentId | uuid?, nullable | FK existing `Department` master |
| defaultOwnerEmployeeId | uuid?, nullable | FK existing `Employee` master — a UI default for "who's usually responsible here," never an enforcement gate |

`sequence` (already exists) remains the single source of ordering truth the whole state model validates against.

### 2.5 JobOrder — NEW (generic; replaces every stage-named table)

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| companyId, branchId? | uuid | |
| productionOrderId | uuid | |
| lotId | uuid | |
| productionStageId | uuid | **whatever stage this company configured** — never a name in code |
| jobNumber | string | deterministic display code, e.g. `{lotNumber}-{stageCode}-{n}`, not a fiscal-year sequence |
| sourceJobOrderId | uuid?, nullable | the JobOrder this one's input came from; null for a lot's very first stage |
| productionLineId | uuid?, nullable | |
| plannedQuantity | Decimal(18,4) | = the quantity that entered this stage |
| completedQuantity | Decimal(18,4), default 0 | guarded accumulator |
| rejectedQuantity | Decimal(18,4), default 0 | guarded accumulator |
| damagedQuantity | Decimal(18,4), default 0 | guarded accumulator |
| forwardedQuantity | Decimal(18,4), default 0 | how much of `completedQuantity` has already been pushed to the next stage (forwarding is an explicit action, not automatic per progress entry — see §4) |
| qcPassedQuantity | Decimal(18,4), default 0 | guarded accumulator, capped at `completedQuantity` — prevents double-QC-ing the same units |
| status | `JobOrderStatus` | `PENDING / IN_PROGRESS / PARTIALLY_COMPLETED / COMPLETED / ON_HOLD / CANCELLED` |
| priority | `ProductionPriority` | |
| plannedStartAt, plannedEndAt, actualStartAt, actualEndAt | timestamp? | |
| createdAt, updatedAt | | |

Indexes: `@@index([lotId, productionStageId])` (**not unique** — a lot can legitimately revisit the same stage after rework; each revisit is a new row, never an update to the old one), `@@index([productionOrderId])`, `@@index([companyId, status])`, `@@index([productionStageId])`.

`remainingQuantity` is **computed, never stored**: `plannedQuantity − completedQuantity − rejectedQuantity − damagedQuantity` — same "computed, never stored" discipline already proven in `MaterialRequestItem`.

**Auto-creation rule**: whenever a `ProductionStageTransaction` posts with a `toProductionStageId`, the service layer — inside the same DB transaction — creates exactly one new `JobOrder` row for `(lot, toStage)`. This is the *only* way a JobOrder is created; there is no separate "create Job Order" step a user performs by hand. Applies identically to forward movement, rework, and QC-driven reverts — one mechanism, no special cases.

### 2.6 JobOrderAssignment — NEW (multi-worker)

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| jobOrderId | uuid | |
| employeeId | uuid | reuses the existing `Employee` master — **not** `User` (see §7) |
| assignedQuantity | Decimal(18,4) | soft-validated: sum across a JobOrder's assignments should not exceed `plannedQuantity`, checked at assignment time, not DB-enforced (assignments can be rebalanced before work starts) |
| status | `AssignmentStatus` | `ASSIGNED / IN_PROGRESS / COMPLETED / REASSIGNED / CANCELLED` |
| assignedByUserId | uuid | |
| assignedAt, startedAt?, completedAt? | timestamp | |

Indexes: `@@index([jobOrderId])`, `@@index([employeeId])`.

"Multiple Cutting Masters on one Lot" falls directly out of this — it's just multiple `JobOrderAssignment` rows against the same Cutting-stage `JobOrder`. No separate "CuttingMaster" concept needed anywhere.

### 2.7 JobOrderProgressEntry — NEW (worker logging, append-only)

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| jobOrderId | uuid | |
| jobOrderAssignmentId | uuid?, nullable | nullable for an ad-hoc/unassigned entry |
| employeeId | uuid | who actually did the work |
| recordedByUserId | uuid | who is logged in and clicked save — may differ from `employeeId` (supervisor-entry model, see §7) |
| completedQuantity, rejectedQuantity, damagedQuantity | Decimal(18,4), default 0 | normally non-negative |
| isAdjustment | Boolean, default false | **only** an `isAdjustment=true` row may carry a negative quantity, gated by a distinct permission — this is how a genuine data-entry mistake gets corrected without ever editing or deleting a row (mirrors `InventoryTransaction`'s own signed-reversal convention) |
| remarks | string? | |
| startedAt, endedAt | timestamp? | |
| createdAt | timestamp | |

Indexes: `@@index([jobOrderId])`, `@@index([employeeId])`.

**Quantity-consistency mechanism** (see §5 for the full rules): each entry, inside one DB transaction, increments `JobOrder.completedQuantity`/`rejectedQuantity`/`damagedQuantity`. Because the real constraint spans **three columns at once** (`completed + rejected + damaged ≤ planned`), this cannot be expressed as the single-column guarded-`updateMany` idiom used everywhere else in this codebase (e.g. `MaterialRequestItem.guardedIncrementIssued`). Two layers instead:
1. **Service-layer read-verify-write inside the transaction** — read the JobOrder's current three values, verify the combined sum with the new increments still fits `plannedQuantity`, then write. This is the primary correctness mechanism.
2. **A Postgres `CHECK` constraint as a hard backstop** (`completed_quantity + rejected_quantity + damaged_quantity <= planned_quantity`), added via raw SQL in the migration since Prisma's schema DSL doesn't yet express multi-column checks — the same "app-layer check + DB-level backstop" pattern this project already documents for journal-balance enforcement.

### 2.8 ProductionStageTransaction — NEW (the append-only ledger)

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| companyId | uuid | |
| productionOrderId, lotId | uuid | |
| fromJobOrderId | uuid?, nullable | null for a lot's first-ever stage entry |
| toJobOrderId | uuid | the JobOrder this transaction created/fed |
| fromProductionStageId | uuid?, nullable | denormalized for fast reporting, same rationale the old blueprint used for `LotNo` |
| toProductionStageId | uuid | |
| transactionType | `StageTransactionType` | `FORWARD \| REWORK \| ADJUSTMENT` |
| quantity | Decimal(18,4) | always positive — direction is expressed by from/to, not sign |
| isBackward | Boolean | precomputed at insert (`toStage.sequence < fromStage.sequence`) for fast querying |
| revertReason | string?, **required by service layer when `isBackward=true`** | not DB-enforced (conditional-required fields aren't expressible as a plain NOT NULL) |
| performedByUserId | uuid | |
| performedAt | timestamp | |
| notes | string? | |

Indexes: `@@index([lotId, performedAt])`, `@@index([toProductionStageId])`, `@@index([productionOrderId])`.

**Scope decision, flagged explicitly (§8)**: no `ProductionStageTransactionDetail` SKU/size-split child table in V1. The old blueprint had one; this redesign drops it because `Lot.quantity` is a single aggregate number in V1 (no per-variant breakdown within a lot). If a company genuinely needs per-size cutting-lot tracking, that's a V2 addition, not a V1 gap being silently skipped.

### 2.9 QC — NEW, generic (not tied to any stage by name)

**QcInspection**

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| companyId, productionOrderId, lotId | uuid | |
| jobOrderId | uuid | **the only stage pointer** — generic by construction |
| inspectedQuantity, acceptedQuantity, rejectedQuantity | Decimal(18,4) | `accepted + rejected + damaged == inspected`, service-validated |
| damagedQuantity | Decimal(18,4), default 0 | |
| result | `QcResult` | `PASS \| PARTIAL_PASS \| FAIL` |
| reworkStageTransactionId | uuid?, nullable | links to the `ProductionStageTransaction` created for the rejected portion, if any |
| inspectorUserId | uuid | |
| inspectedAt | timestamp | |
| remarks | string? | |

**QcDefect** (child): `qcInspectionId`, `defectTypeId`, `quantity`, `severity?`, `remarks?`.

**DefectType** (master, company-configurable, identical shape to `ProductionStage`/`Color`/`Size`): `code`, `name`, `isActive`.

A Fail or Partial-Pass result creates a new `ProductionStageTransaction` (`transactionType=REWORK`) using the **exact same target-validation function** as a manual revert (§3) — QC-driven revert and manual revert are one mechanism, not two.

### 2.10 Bundle — REUSE the *concept*, defer the table

`Bundle` (physical grouping of pieces flowing through a stage) stays conceptually valid — it represents a physical object, not a hardcoded stage. But without variant-level Lot tracking in V1 (§2.8), a Bundle would just be `jobOrderId + bundleNumber + pieceCount + status`, and nothing else in this design actually depends on it existing. **Recommendation: defer building it until a real need surfaces** (e.g. bundle-ticket printing) rather than shipping an unused table. Flagged as open scope in §8, not silently dropped.

### 2.11 FabricRoll — REUSE unchanged, and remove the old blueprint's redundant tables

`FabricRoll` already exists (Phase 6). `InventoryTransaction.fabricRollId` **already exists** as a column. This means Production needs **zero new tables** for roll-tracked fabric issuance — issuing a roll to a JobOrder is just a `MATERIAL_ISSUE` transaction with `fabricRollId` set, exactly like Goods Receipt already does. The old blueprint's `FabricRollIssue`/`FabricRollIssueDetail` tables are **removed** as pure duplication of a mechanism that already exists.

### 2.12 Modifications to existing enums

- `RelatedModule` — add `PRODUCTION_ORDER`.
- `InventoryTransactionType` — add `DAMAGE`. (`MATERIAL_ISSUE` and `PRODUCTION_RECEIPT` already exist and are reused as-is.)
- `MaterialRequest` — add nullable `productionOrderId`.

---

## 3. State / Stage Transition Model

Two separate state concerns, deliberately not merged into one mechanism:

### 3.1 ProductionOrder.status — fixed map (reuse existing idiom)
```
PLANNED → MATERIAL_ALLOCATED → IN_PROGRESS → CLOSED
   ↓             ↓                  ↓
 CANCELLED    CANCELLED          ON_HOLD → (resume to prior) | CANCELLED
```
This is a small, genuinely fixed set — the existing `ALLOWED_TRANSITIONS: Record<Status, Status[]>` pattern fits it without modification.

### 3.2 Lot stage position — runtime graph, not a fixed map

A Lot's position is validated against the company's own `ProductionStage` rows at the moment of the move, not against a hardcoded transition table. Core function (illustrative, not final code):

```
getValidForwardStages(companyId, fromStage):
  return ProductionStage.findMany({ companyId, isActive: true, sequence: { gt: fromStage.sequence } })
    .orderBy(sequence asc)

getValidRevertStages(companyId, fromStage):
  return ProductionStage.findMany({ companyId, isActive: true, allowRework: true, sequence: { lt: fromStage.sequence } })
```

- **Forward movement**: default-allowed only to *the immediate next active stage* in sequence. Jumping further ahead ("skip a stage") requires the caller to hold a new `production.skip_stage` permission — reuses the existing RBAC mechanism rather than inventing a per-company config table.
- **Backward movement / rework / QC-fail**: target must be `sequence < current`, `isActive`, and `allowRework=true` on the *target* stage. `revertReason` mandatory. One shared validation function serves manual revert, rework, and QC-driven reverts — no per-trigger special case.
- **Stage cancellation**: a single `JobOrder` can be cancelled independently (`status=CANCELLED`) without touching sibling JobOrders or the Lot's own status — cascading is an explicit follow-up action, never automatic (matches how cancellation already works everywhere else in this project).

---

## 4. Ledger Design (Production Stage Ledger)

`ProductionStageTransaction` is the single append-only source of truth (§2.8) — never edited, never deleted. Everything else derives from it:

- **A Lot's current position** = the JobOrder(s) with no onward `ProductionStageTransaction` yet. `Lot.currentStageId` is a **cache convenience column**, refreshed whenever a transaction posts — never queried as ground truth by any correctness-critical logic. This is exactly the mechanism that satisfies the "don't block future parallel-stage support" requirement: a V2 upgrade to true concurrent multi-position lots only has to stop trusting this one column and start querying "the set of open JobOrders for this lot" instead — the ledger and every other table are untouched.
- **Forwarding is explicit, not automatic.** A progress entry updates `JobOrder.completedQuantity`; it does *not* by itself move anything to the next stage. A supervisor (or an auto-forward-on-full-completion convenience action, if wanted later) explicitly forwards some or all of the not-yet-forwarded completed quantity, which is what actually posts a `ProductionStageTransaction` and creates the next JobOrder. This mirrors how the spec itself treats backward movement as a deliberate, auditable action — forward movement gets the same discipline, and it's also what makes **partial, continuous hand-off between stages** (200 of 900 pieces moving to Sewing while Cutting continues) representable without waiting for one stage to fully finish.

---

## 5. Quantity & Consistency Rules

| Value | Calculated or persisted? | Rule |
|---|---|---|
| `ProductionOrder.plannedQuantity` | persisted | set at creation |
| `Lot.quantity` | persisted, immutable | fixed at creation/split/merge |
| `JobOrder.plannedQuantity` | persisted | = the inbound transaction's quantity |
| `JobOrder.completedQuantity / rejectedQuantity / damagedQuantity` | persisted, guarded accumulators | `completed + rejected + damaged ≤ planned` — service read-verify-write + DB `CHECK` backstop (§2.7) |
| `JobOrder.forwardedQuantity` | persisted, guarded accumulator | `forwarded ≤ completed` |
| `JobOrder.qcPassedQuantity` | persisted, guarded accumulator | `qcPassed ≤ completed` |
| `JobOrder.remainingQuantity` | **computed, never stored** | `planned − completed − rejected − damaged` |
| `JobOrderAssignment.assignedQuantity` sum per JobOrder | soft-validated at write time | should not exceed `plannedQuantity`; not DB-enforced (rebalance-before-work-starts is normal) |
| `LotRelation` split quantities | validated at write time, one transaction | `Σ children.quantity == parent.quantity` exactly |
| `LotRelation` merge quantities | validated at write time, one transaction | `Σ parents.quantity == child.quantity` exactly, and every parent fully consumed |

**Prevents**: over-production (guarded accumulators + CHECK constraint), double counting (progress entries are additive-only; corrections are new `isAdjustment` rows, never edits), duplicate JobOrder creation at the same stage (each stage-entry — including rework revisits — is a fresh row, keyed off the transaction that created it, never reused), assignment quantity exceeding the JobOrder's planned quantity (soft check), split/merge quantity mismatches (exact-sum validation, single DB transaction, all-or-nothing).

---

## 6. Inventory Ledger Integration

No new inventory tables. Exactly four posting points, all through the existing `recordInventoryTransaction(tx, actor, input)` engine:

| Event | Transaction type | Warehouse | referenceModule / referenceRecordId |
|---|---|---|---|
| Raw material issued to production | `MATERIAL_ISSUE` (existing) | wherever the Material Request specifies | reuses the **existing, unmodified** Material Request → Issue flow |
| Lot reaches an `isFinal` stage | `PRODUCTION_RECEIPT` (existing) | a `FINISHED_GOODS`-type Warehouse | `PRODUCTION_ORDER` (new enum value) / `lotId` |
| Fully damaged quantity recorded | `DAMAGE` (**new** enum value) | a `REJECT`-type Warehouse (**already exists**) | `PRODUCTION_ORDER` / `jobOrderId` |
| Repairable damage → rework | **no inventory transaction at all** | — | purely a `ProductionStageTransaction`, internal WIP re-route |

Fabric roll issuance reuses `InventoryTransaction.fabricRollId` (already exists) — no `FabricRollIssue` table (§2.11). `StockBalance` updates automatically via the same "upsert in the same DB transaction as the ledger insert" mechanism already used everywhere else — nothing new to build there.

---

## 7. Worker Login Model

**Resolved architecturally, not assumed.** The existing `User.employeeId` column (already `@unique`, already nullable) is the load-bearing fact here: this schema already supports linking a real login to a specific `Employee` record, at zero additional schema cost.

- **`JobOrderAssignment.employeeId` and `JobOrderProgressEntry.employeeId` always point at the existing `Employee` master — never `User`.** Tracking *who did the work* never requires that person to have a login.
- **`JobOrderProgressEntry.recordedByUserId` always points at `User`** — whoever is actually logged in and clicked save.

This single design decision makes all three options the same schema, differing only in deployment/UI choice:

| Option | How it works here | V1 recommendation |
|---|---|---|
| **A — every worker has their own login** | Give the worker a `User` row with `employeeId` linked; they log their own progress; `recordedByUserId == employeeId`'s user. | Supported, not required. |
| **B — supervisor logs on workers' behalf** | Supervisor is the `User`; `employeeId` on each entry names the actual worker. `recordedByUserId != employeeId`'s user. | **Recommended default for V1.** Lowest onboarding cost (no login provisioning per shop-floor worker), least new auth surface, and matches this project's own earlier domain-research note that shop-floor login is a "consider later" item, never built. |
| **C — shared kiosk + PIN/badge identification** | Needs a *new* lightweight identification mechanism (PIN entry, badge scan) this project has zero precedent for. | **Not recommended for V1** — real new infrastructure, not a reuse of anything existing. Flagged as an explicit open business decision (§8), not silently ruled out for the future. |

---

## 8. Open Business Decisions (need your approval, not mine)

1. **Worker login model** — confirmed recommendation is Option B for V1 (§7), with the schema keeping A available at zero extra cost. Confirm before RBAC seeding.
2. **Lot split mid-JobOrder** — currently blocked in V1 (must be "at rest" to split/merge). Confirm this is acceptable, or if real usage needs it.
3. **Variant-level (size/color) tracking within a Lot** — dropped for V1 (`Lot.quantity` is a single aggregate number, no `ProductionStageTransactionDetail`). Confirm this is acceptable for now.
4. **`Bundle`** — concept kept valid, table deferred until a concrete need (e.g. bundle-ticket printing) appears. Confirm defer-vs-build-now.
5. **Approval gate on `ProductionOrder`** — no mandatory approval step is built into the state model (mirrors BOM's/Material Request's own "no unnecessary approval state" precedent); `production.approve` exists as an available-but-unenforced action if a company wants a manual review step later. Confirm this matches expectation.
6. **Stage-skip permission** (`production.skip_stage`) and **lot-restructure permission** (`production.restructure`) and **revert permission** (`production.revert`) — 3 new RBAC action verbs beyond the existing standard 10. Confirm scope/naming before seeding.

---

## 9. Permission & Audit Matrix

Reuses the existing `production` RBAC module (already seeded) and the existing standard 10 actions
(`view/create/edit/delete/approve/reject/post/cancel/export/print`), plus exactly 3 new actions:
`revert`, `restructure`, `skip_stage`.

| Action | ADMIN / MANAGEMENT | PRODUCTION_MANAGER | PRODUCTION_SUPERVISOR | QC_MANAGER (as QC Inspector) | STORE_MANAGER | Worker (Option A only) |
|---|---|---|---|---|---|---|
| Production Order create | ✓ | ✓ | – | – | – | – |
| Production Order approve | ✓ | ✓ (self-approval-guarded like everywhere else) | – | – | – | – |
| Production Order cancel | ✓ | ✓ | – | – | – | – |
| Lot creation | ✓ | ✓ | ✓ | – | – | – |
| Lot split / merge (`restructure`) | ✓ | ✓ | – | – | – | – |
| Job Order creation | *(automatic side effect only — no direct-create permission needed anywhere)* | | | | | |
| Job Order assignment | ✓ | ✓ | ✓ | – | – | – |
| Worker progress entry (`create` on JobOrderProgressEntry) | ✓ | ✓ | ✓ | – | – | ✓ (own assignments only, row-scoped via `employeeId == current user's linked employee`) |
| Progress correction (`isAdjustment=true`) | ✓ | ✓ | ✓ | – | – | – |
| QC entry | ✓ | ✓ | – | ✓ | – | – |
| Stage forward movement | ✓ | ✓ | ✓ | – | – | – |
| Stage skip (`skip_stage`) | ✓ | ✓ | – | – | – | – |
| Rework / revert (`revert`) | ✓ | ✓ | ✓ | ✓ (via QC fail) | – | – |
| Damage recording | ✓ | ✓ | ✓ | ✓ | – | – |
| Production completion (final-stage receipt) | *(automatic side effect of a stage transaction landing on `isFinal` — no separate permission)* | | | | | |
| Production configuration (`ProductionStage`/`DefectType` masters) | ✓ | ✓ (existing `masters_core`-style pattern) | – | – | – | – |

**Auditability**: every one of the actions above writes through the existing `writeAuditLog()` helper, `tableName` set to the new table's own snake_case name (`production_orders`, `lots`, `lot_relations`, `job_orders`, `job_order_assignments`, `job_order_progress_entries`, `production_stage_transactions`, `qc_inspections`). No second audit system. Quantity-changing events (progress entries, QC decisions, stage moves, damage, split/merge) log `oldValues`/`newValues` the same way every other module's status/quantity changes already do.

---

## 10. API Shape (design only — not implemented)

Following the existing `/api/v1/...` convention (one level of nesting max, business actions as sub-resource POSTs):

```
GET/POST   /api/v1/production-orders
GET/PATCH  /api/v1/production-orders/[id]
POST       /api/v1/production-orders/[id]/status         (Hold/Resume/Cancel/Close — fixed-map transitions)
POST       /api/v1/production-orders/[id]/material-request  (generate a MaterialRequest, reuses existing service)

GET/POST   /api/v1/production-orders/[id]/lots
GET        /api/v1/lots/[id]
POST       /api/v1/lots/split         { parentLotId, children: [{ quantity, reason? }] }
POST       /api/v1/lots/merge         { parentLotIds: [...], childLotNumber?, reason? }
GET        /api/v1/lots/[id]/genealogy

GET        /api/v1/job-orders?lotId=&stageId=&status=
GET        /api/v1/job-orders/[id]
POST       /api/v1/job-orders/[id]/assignments
PATCH      /api/v1/job-orders/assignments/[assignmentId]
POST       /api/v1/job-orders/[id]/progress-entries
POST       /api/v1/job-orders/[id]/forward       { quantity, targetStageId? }   (defaults to next active stage; skip_stage permission required otherwise)
POST       /api/v1/job-orders/[id]/revert        { targetStageId, quantity, reason }
POST       /api/v1/job-orders/[id]/qc-inspections

GET/POST   /api/v1/masters/production-stages       (extends the existing production-config route, not a new module)
GET/POST   /api/v1/masters/defect-types
```

No wireframes, sequence diagrams, or folder structure produced — per scope, these fall out of implementation and would go stale before they were ever built against.

---

## 11. Architecture Review — vs. the old Production Schema Blueprint

**Retained from the old blueprint:**
- Ledger-first philosophy (append-only stage-transaction table as sole source of truth; everything else is a rebuildable cache).
- `ProductionStage.sequence`-driven dynamic ordering (already existed, just extended).
- Reuse of the existing `InventoryTransaction`/`StockBalance` engine rather than a parallel inventory system.
- `IsFinal`-flag-triggers-receipt mechanism (renamed `isFinal`, same idea).

**Changed:**
- **Removed the hardcoded per-stage tables** (`CuttingPlan`, `SewingProduction`, `FinishingRecord`) — replaced with one generic `JobOrder`. This was the single real contradiction in the old blueprint: it claimed stage-agnostic design while shipping stage-named tables.
- **Removed `FabricRollIssue`/`FabricRollIssueDetail`** — redundant with the already-existing `InventoryTransaction.fabricRollId` column; not noticed until this pass because the old blueprint was written before that column's existence was cross-checked.
- **Dropped `ProductionStageTransactionDetail`** (SKU/size split) — a deliberate V1 scope cut now that Lot is a first-class, single-aggregate-quantity entity; flagged, not silent.

**Newly introduced (the old blueprint had no answer for these at all):**
- `Lot` as a first-class entity with its own lifecycle.
- `LotRelation` — full split/merge genealogy.
- `JobOrderAssignment` — multi-worker assignment (old blueprint assumed one operator per posting).
- `JobOrderProgressEntry` — append-only worker-level logging with the `isAdjustment` correction mechanism.
- `QcInspection`/`QcDefect`/`DefectType` — same idea the old blueprint had, but now explicitly generic (`jobOrderId`, not a stage name) from the start rather than needing a later fix.
- Explicit worker-login-model resolution (§7) — the old blueprint didn't address this at all.

**Hardcoded assumptions removed:** stage names anywhere in schema or logic; "one current stage per lot" as a physical constraint (now a cache convenience, not a limit); a single-parent-FK model for lot genealogy (couldn't represent merge).

**Risks carried forward, explicitly:**
- The 3-column `CHECK` constraint (§2.7) is new territory for this codebase — every other guarded accumulator here is single-column. Needs care in the actual migration/service implementation.
- Forward-movement-as-an-explicit-action (rather than automatic-on-progress-entry) is a real UX decision that needs a supervisor-facing "forward X pieces" screen — more clicks than a fully automatic model, traded deliberately for auditability and partial-hand-off support.

---

## 12. Final Recommendation

1. **Is this architecture internally consistent?** Yes, with three explicitly flagged V1 simplifications (no variant-level split, split/merge require "at rest," merge is full-consumption-only) — stated as scope decisions, not gaps.
2. **Does it truly support unlimited company-configured stages?** Yes. No stage name appears anywhere in the schema or in any service-layer logic; every table is generic over `ProductionStage.id`, validated only by `sequence`/`isActive`/`allowRework`.
3. **Does Lot split/merge have complete genealogy?** Yes, via `LotRelation`, traceable in both directions to arbitrary depth, with explicit invalid-genealogy rules (same product/UOM, full consumption, no open JobOrder, exact-sum quantities).
4. **Is JobOrder sufficiently generic?** Yes — zero stage-named tables anywhere; "multiple Cutting Masters on one lot" falls out for free as multiple `JobOrderAssignment` rows on one `JobOrder`.
5. **Is QC generic?** Yes — `QcInspection` keys off `jobOrderId`, and QC-driven reverts reuse the exact same target-stage validation as a manual revert. No `SewingQC`/`FinishingQC`-style tables.
6. **Is rework handled correctly?** Yes — same `ProductionStageTransaction` mechanism as forward movement, mandatory `revertReason`, target stage validated against `sequence` + `allowRework` at runtime, not a fixed transition map.
7. **Is inventory correctly integrated with the existing ledger?** Yes — zero new inventory tables; two small additions (`DAMAGE` transaction type, `PRODUCTION_ORDER` reference-module value) to the existing enums; the already-existing `REJECT` warehouse type and `fabricRollId` column are reused directly.
8. **Does the design avoid premature parallel-stage complexity?** Yes — `Lot.currentStageId` is documented and treated as a rebuildable cache, never a source of truth; the true position is always derivable from the ledger, so a future multi-position upgrade is additive, not a breaking migration.
9. **What business decisions still require your approval?** The six items in §8 — worker-login default, split-mid-JobOrder policy, variant-level tracking scope, Bundle build-vs-defer, approval-gate expectation, and the three new permission-verb names.
10. **What exact schema/API should be implemented in the next phase?** Everything in §2 (Database Design) and §10 (API Shape) above, once §8's open decisions are confirmed — in the same design-was-already-reviewed → schema → repository → service → UI → verify order every other phase in this project has followed.

**No schema, migration, API route, or UI code has been touched.** Full design saved to `PRODUCTION_MODULE_DESIGN.md` at the repo root for reference during implementation.
