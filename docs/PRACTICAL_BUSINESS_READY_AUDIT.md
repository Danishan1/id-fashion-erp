# Fashion ERP — Practical Business-Ready Audit (Avoid CRUD & Avoid Over-Engineering)

**Analysis-only document. No code was modified while producing this.**

Scope: Sampling, Sampling BOM, Sales Order, Purchase Order, Production, Production BOM, Packaging, Dispatch.
Every finding below traces to a real file/model/function citation gathered via direct code research — not
guessed, not carried over from documentation. Where a claim needed re-verification against the live
codebase, it was re-verified.

---

## 1. Audit Philosophy — how every finding below was filtered

Every feature discussed in this document was passed through:
1. Does a real fashion manufacturing company need this daily?
2. If missing, does the business fall back to Excel/WhatsApp/a register?
3. Is making this dynamic genuinely useful, or does it just add complexity?

Findings that fail question 1 are not recommended, even if a "mature ERP" would have them.

---

## 2. CRUD vs. Business Feature — the headline finding, stated once up front

**This system is not a basic CRUD ERP.** Across every module audited, real enforced business logic was
found: explicit state-machine transition maps (not free-form status fields), self-approval-guarded approval
gates, atomic guarded accumulators preventing over-issue/over-receipt/over-production, a DB-level CHECK
constraint backing a quantity cap, and a real append-only stage-transition ledger for production movement.

**But it is inconsistent.** Some modules (Dispatch, Production's quantity guards, Sales Order's sample-approval
gate) are genuinely well-engineered. One module — **BOM** — is a striking exception: it is currently closer
to pure CRUD (create/edit/delete a mutable spec, no version history, no approval) despite BOM being the
single most consequential document for costing and material planning. This inconsistency, not a uniform
weakness, is the real story of this audit.

---

## 3–4. Sampling & Sampling BOM

### Sampling — real business workflow, not CRUD
| Feature | Status | Evidence |
|---|---|---|
| Sample Request state machine | ✅ Real | 12-state `SampleStatus` enum, explicit `ALLOWED_TRANSITIONS` map enforced in `transitionSampleStatus()` (`sample.service.ts`) — not a free-form field |
| Sample Types | ✅ Deliberately a fixed enum, not a master | 8 hardcoded values, explicitly commented as intentional |
| Sample Versions | ✅ Real append-only versioning | Prior version flips `SUPERSEDED` before a new one is created; a superseded/locked version's costing is guarded by a conditional `updateMany`, not just app-layer convention |
| Sample Approval | ✅ Real gate, one gap | Self-approval blocked via `PermissionService`; decision only legal from `SUBMITTED_TO_CUSTOMER`. Gap: rejection reason (`decisionNotes`) is optional, not enforced |
| Rejection & Resubmission | ✅ Real | `REJECTED` is terminal (no reopen path); revision always mints a new version, never reuses/edits the old one |
| Target Date / Delay Tracking | ❌ Field exists, zero enforcement | `targetSubmissionDate` is stored and displayed raw — no days-elapsed/overdue computation exists (Job Work Orders have this exact computation; Sampling doesn't) |
| Material Requirement (SampleMaterial) | ✅ Real quantity+cost model | Not free text — quantity/UOM/color/dye/rate/GST%, with a real duplicate-merge key |
| Sample Cost | ✅ Real, lockable roll-up | material cost → subtotal → margin% → commission% → freight → final total, race-free lock/unlock |
| Attachments / Comments / Approval History | ✅ Real relational records | Not text blobs — queryable, with context snapshots |

### Sampling BOM / BOM — the weak link
| Feature (per the user's minimum list) | Status | Evidence |
|---|---|---|
| Material, Quantity, UOM, Wastage% | ✅ Real | `BomItem.quantityPerUnit/wastagePercentage/uomId/materialId` |
| Rate/Cost on the line | ❌ Absent | Cost is pulled live from `Product.unitCost` at MRP-calculation time — never stored on the BOM line itself |
| Total Cost | ❌ Absent on this branch | (Note: a separate `feature/bom-cost-sheet` branch already adds a Material Cost roll-up — not yet merged into main at the time of this audit) |
| Supplier/reference | ❌ Absent on the line | Only reachable indirectly via the material's own `defaultSupplierId` |
| **Revision / Version / Approval / Effective Version** | ❌ **Entirely absent** | `upsertWithItems()` **deletes and recreates every line on every edit** — the code's own comment says "a BOM is a mutable spec, not a versioned document." The audit log stores only `{itemCount}`, not the actual old/new line data — **prior BOM content is genuinely, permanently lost on every edit.** No approval gate exists at all — MRP and Production consume whatever the BOM currently says, with zero review step. |
| Does BOM actually drive requirements? | ✅ Yes, genuinely | `getMaterialRequirements()` and `generateMaterialRequestForOrder()` both explode live `BomItem` rows — this is real, not decorative |
| Wastage actual-vs-planned reconciliation | ❌ Absent | Confirmed via grep — no code anywhere compares actual consumption against `wastagePercentage` |

**This is the single most important finding in this entire audit.** The user's own example ("Version 1 →
Fabric 10m, Version 2 → Fabric 10.5m — system should know which version was approved/used") **cannot happen
today** — there is no version 1 to compare against once version 2 is saved. This is especially notable
because the *exact* pattern needed (`SampleVersion`'s append-only versioning) already exists one module over
in the same codebase, proven and working — closing this gap is replication, not invention.

### Dynamic requirement check
Sample Types (fixed enum) and BOM material/color choices (already fully dynamic via master-data FKs) match
the "only genuinely company-specific things should be configurable" principle correctly today. No
over-engineering found here.

---

## 5. Sales Order

| Feature | Status | Evidence |
|---|---|---|
| Customer/Buyer, Style, Color/Size, Quantity, Price | ✅ Real, enforced | Style is gated to real STYLE-type products (`assertItemsAreStyles`); breakdown quantities drive all downstream math |
| Delivery Date | ❌ Field exists, zero enforcement | Never compared against production/dispatch dates anywhere |
| Currency / Payment Terms | 🟡 Present but not enforced at this layer | Currency is forced to company base currency (multi-currency deliberately inert project-wide); payment terms are read elsewhere (Invoice), never by Sales Order itself |
| Order Status (9-state enum) | ✅ Real transition map | Several values (`IN_PRODUCTION`, `PARTIALLY_DISPATCHED`, `DISPATCHED`) are referenced defensively by Dispatch but **never actually produced by Sales Order's own code** — dead states in practice |
| Approval | ✅ Real, self-approval-guarded | Sample-approval gate blocks `CONFIRMED`; override requires the `approve` permission and cannot be self-granted |
| Amendment | 🟡 Real but incomplete | Blocked once an active Invoice or **any** Dispatch exists — but **not blocked when an active Production Order exists**. A confirmed order with production already underway can still have its entire item list replaced with no warning |
| Cancellation | 🟡 Real for Dispatch, missing for Production | `CANCELLED` is a true terminal state for dispatch purposes — but **`createProductionOrder()` never checks the Sales Order's own status at all**, only the ordered-quantity cap. **A cancelled order can still have a brand-new Production Order raised against it today.** |
| Partial Delivery / Remaining Quantity | ✅ Real, race-safe | `dispatchedQuantity` accumulator, guarded conditional update |

### Quantity Control — the critical gap
The requested chain **Ordered → Planned → Produced → Packed → Dispatched → Remaining** is only half real:
- **Ordered → Planned**: ✅ real cap (`OVER_PRODUCTION_NOT_ALLOWED`)
- **Planned → Produced**: ❌ **absent** — `SalesOrderItem` has zero field capturing actual production output; `ProductionOrder`/`Lot`/`JobOrder` never roll a "produced quantity" back up to the Sales Order at all
- **Produced → Packed → Dispatched**: 🟡 real, but validated against a **company-wide Finished-Goods stock pool**, not against this specific order's own production output — dispatch cannot distinguish "stock this order's own production made" from "stock some other order's production made"

**Practical consequence**: nobody can look at a Sales Order and see "how much has actually been produced for
this order so far" — that requires manually cross-referencing the Production Register report. This is the
single biggest reason an Excel tracker would still be needed (see Section 16).

### Business protection checks
| Question | Answer |
|---|---|
| Can a confirmed order be freely edited? | Blocked by Invoice/Dispatch — **not** blocked by an active Production Order |
| Can a cancelled order be produced? | **Yes — this is a real, confirmed gap** |
| Can dispatch exceed available quantity? | No — double-guarded (order remaining AND real FG stock) |
| Is there any production/dispatch tolerance? | No — zero-tolerance hard caps everywhere, no configurable overage % |

---

## 6. Purchase Order

| Feature | Status | Evidence |
|---|---|---|
| Supplier, Material, Quantity, Rate, Delivery Date | ✅ Real | All present and validated |
| **Tax** | ❌ **Absent entirely** | No tax field anywhere on `PurchaseOrder`/`PurchaseOrderItem` — `unitPrice × quantity` only. Every other financial document in this ERP (Sales Invoice, Purchase Invoice, Expense) has real tax handling; the Purchase Order itself does not, meaning its own "total" understates real committed spend |
| Warehouse | 🟡 Only at receipt time, not order time | Decided per-line on `GoodsReceiptItem`, absent from the PO itself |
| Approval | ✅ Real, self-approval-guarded, actually unlocks the next step | Approval is a genuine prerequisite for sending to supplier and receiving — not cosmetic |
| Partial Receipt | ✅ Real, atomic accumulator | `guardedIncrementReceived`, race-safe |
| Over/Under Receipt | ✅ Hard guard, exact error code | `OVER_RECEIPT_NOT_ALLOWED`; under-receipt fully tracked as `PARTIALLY_RECEIVED` |
| QC at receipt | ❌ Absent | `QcInspection` only ever attaches to production, never to a Goods Receipt — goods enter stock immediately on receipt with zero inspection gate |
| Rejection (quality-driven) | ❌ Absent as a distinct concept | Only a generic administrative "reversal" exists (framed explicitly as a data-entry correction, not a quality rejection) |
| Remaining Quantity | ✅ Computed live, shown where actionable | On the receive-goods screen and in the Pending Purchase Order report |
| PO Closure | 🟡 Correctly gated, but has a real dead-end | `closePurchaseOrder()` correctly requires `FULLY_RECEIVED` — **but once any receipt exists, the PO also cannot be cancelled** (cancellation is blocked whenever active receipts exist). **A permanently short-delivered PO (supplier will never send the rest) has no valid terminal state at all** — it sits in `PARTIALLY_RECEIVED` forever. |

### Overall verdict
Purchase Order is genuinely integration-complete for the happy path — real approval, real inventory
posting, real invoicing linkage, real guards. The gaps (tax, QC, and the stuck-PO dead-end) are specific and
fixable, not systemic.

---

## 7–9. Production & Production BOM

Production is the **best-engineered module in this audit.**

| Feature | Status | Evidence |
|---|---|---|
| Production Order + Sales Order reference | ✅ Real, nullable for Make-to-Stock | `salesOrderItemId` |
| Over-production guard | ✅ Real | Sums existing commitments across other non-cancelled Production Orders on the same line before allowing a new one |
| Production BOM | ✅ Same shared `Bom`/`BomItem` model as Sampling BOM — genuinely consumed | `generateMaterialRequestForOrder()` explodes it for real: `quantityPerUnit × (1+wastage%) × plannedQuantity`, netted against live stock |
| Material Issue | ✅ Real, guarded | Capped at the Material Request line, itself capped by BOM-derived need |
| Production Stages | ✅ Real, company-configurable master — **exactly the "reasonably configurable, not a BPM engine" shape the user asked for** | `sequence`, `isFinal`, `allowRework` fields; movement via a real append-only `ProductionStageTransaction` ledger, not a status label |
| Produced/Rejected/Damaged quantities | ✅ Real, double-enforced | App-layer guard **and** a DB-level CHECK constraint (`completed+rejected+damaged <= planned`) |
| Rework | ✅ Real loop, not a dead end | Rejected/damaged quantity routes back to an earlier stage via the same ledger mechanism, gated by `allowRework` |
| QC gate | 🟡 **Real model, but optional/bypassable** | `isQcRecommended` is explicitly documented as "advisory only" — a Job Order can reach a final stage and post to Finished Goods stock **without ever passing QC** |
| FG posting / double-post guard | ✅ Confirmed fixed and still in place | The exact bug this session already found and fixed (`computeWritableJobOrderStatus`) is verified present in the current code |
| Lot (batch tracking) | ✅ Real, with split/merge | `LotRelation` genealogy, exact-quantity-sum enforcement |
| External Job Work | ✅ Zero special-casing, confirmed | Feeds the *same* completed-quantity accumulator internal progress does — Forward/QC "just work" on it |
| Wastage actual-vs-planned | ❌ **Absent** | No field or report compares real consumption against `BomItem.wastagePercentage` after the fact |

### Production Process — is it over-engineered?
**No.** `ProductionStage` is exactly the "simple, company-wise configurable master" the user asked for, not
a generic BPM/workflow engine. Adding Embroidery or Washing between existing stages needs zero code
change — just a new master row with the right `sequence`. This is a genuine architectural success worth
protecting, not simplifying further.

---

## 10. Packaging

**There is no standalone Packaging module — confirmed via exhaustive grep.** Everything lives inside
Dispatch's `Carton`/`CartonItem`. This is worth stating plainly rather than pretending a separate module
exists.

| Feature | Status |
|---|---|
| Packing instructions / packing-material master / polybag-inner-master-carton hierarchy | ❌ Absent entirely |
| Quantity per carton, size/color/SKU distribution | ✅ Real — `CartonItem.productVariantId` is a genuine FK, not a flat number |
| Carton number | ✅ Real, unique per dispatch |
| Weight / Dimensions / Barcode | ❌ **Absent — not even as unenforced fields** |
| Packing List document | 🟡 Data exists, no formatted document | Only raw tabular reports (Carton Summary, Color/Size-wise Packing) — no printable packing-list artifact |
| Produced → Packed → Remaining reconciliation | 🟡 Real, but against a shared stock pool, not this order's own production (same nuance as Sales Order Section 5) |

### Dynamic requirement check
No universal logistics engine exists or is recommended — Carton's flat structure is appropriate for now.
Adding weight/dimensions as plain optional fields (not a new hierarchy) would close the most-missed gap
cheaply.

---

## 11. Dispatch

**The second-best-engineered module in this audit** — and a genuine model for how the "avoid the status-label
bug class" lesson should be applied everywhere else.

| Feature | Status | Evidence |
|---|---|---|
| Sales Order / Warehouse / Customer / Transport fields | ✅ Real | All present |
| Partial dispatch / remaining quantity | ✅ Real, race-safe | Guarded conditional update, explicitly safe because order-edit is blocked while a Dispatch references it |
| Dispatch Qty ≤ Available Stock | ✅ Real, against actual `StockBalance` | `INSUFFICIENT_FG_STOCK` |
| Total Dispatch Qty ≤ Order Qty | ✅ Real, zero-tolerance hard cap | No configurable overage exists (matches the Sales Order finding — consistent, not accidental) |
| Cancellation guard | ✅ **Checks real state, not the status label** | Blocks cancellation whenever `dispatchedAt` is actually set, independent of the status-transition map — explicitly built to avoid the exact bug class this project has hit twice before elsewhere |

No material gaps found in Dispatch itself.

---

## 12. Company-to-Company Differences — is the configurable/fixed split correct today?

| Item | Current state | Correct per the user's own philosophy? |
|---|---|---|
| Numbering format | Real per-document-type sequence, company-scoped | ✅ Correct |
| Sample Types | Fixed enum | ✅ Correct — genuinely universal across garment companies |
| Production Operations (stages) | Real company-configurable master | ✅ Correct, and well-built |
| Approval levels | Single-level everywhere (Sample, Sales Order, PO) | ✅ Correct for this business size — a multi-level approval chain would be over-engineering with no evidence of need |
| Quantity validation, stock integrity, order-to-production linkage, dispatch validation | Hardcoded, non-configurable | ✅ Correct — these are exactly the "core business logic that should stay fixed" items the user named |
| Company/tenant isolation | `companyId`-scoped everywhere, independently contract-tested project-wide | ✅ Correct and verified |

**No instance was found of a fundamental rule being made configurable when it shouldn't be**, and no instance
of a genuinely company-specific thing being hardcoded when it should be configurable (BOM's missing
versioning/approval is a completeness gap, not a wrongly-fixed-vs-configurable decision).

---

## 13. Over-Engineering Audit

**Honest finding: very little over-engineering exists in the 8 audited modules.** No generic workflow/rules
engine, no excessive abstraction layers, no microservices, no dynamic form builder, no plugin system, and no
generic event system were found anywhere in this scope. Every state machine is a small, explicit, hardcoded
transition map per module — the opposite of a generic engine.

The one piece of real, non-trivial complexity is the **`ProductionStageTransaction` ledger +
`computeJobOrderStatus`/`computeWritableJobOrderStatus` split** in Production:

**Current complexity** → a dedicated append-only ledger plus a status-computation function deliberately split
in two (one for display, one for what's safe to persist), which has already required one real bug fix
(`ERP-BUG-Q10-0001`) to get right.
**Business benefit** → this exact mechanism is what let External Job Work integrate with zero special-casing
(a concretely cited, real win) and what makes Lot split/merge and multi-stage rework possible at all.
**Is it required?** → Yes — a simpler status-only model could not support rework loops, external
contractors, or split/merge without duplicating logic three times.
**Verdict: Keep.** This is justified complexity, not over-engineering — the one prior bug was a bug in the
implementation, not evidence the design itself is wrong.

**No other candidate for simplification was found in this scope.**

---

## 14. Under-Engineering Audit

This is the more consequential half of the audit. Ranked by real business impact:

1. **BOM has no versioning and no approval** (Section 4) — the single biggest gap in the whole audit.
2. **Sales Order ↔ Production status is not cross-checked** — a cancelled order can still be produced against; a confirmed order with active production can still be silently replaced.
3. **A permanently short-delivered Purchase Order has no terminal state** — stuck in `PARTIALLY_RECEIVED` forever with no "accept the shortfall and close" path.
4. **No wastage-actual-vs-planned reconciliation anywhere** — the 3% (or whatever %) promised at BOM time is never checked against reality.
5. **QC is optional at the final production stage** — finished goods can reach dispatchable stock without ever being inspected.
6. **No QC/inspection gate on incoming goods** (Purchase/Goods Receipt) at all.
7. **Purchase Order has no tax field** — its own total is not the real committed spend.
8. **No Ordered → Produced roll-up on Sales Order** — the most commonly-needed "how's my order doing" question has no single answer in the system.
9. **Sample delay/overdue tracking exists as a raw date field only** — no computed "days late" anywhere, despite the identical pattern already existing for Job Work Orders.
10. **No packing-list document, no carton weight/dimensions** — data exists for the packing content, not for the physical shipment description a transporter would want.

---

## 15. Real Company Scenario Testing

**Scenario 1 (10,000-garment full flow)**: mechanically, yes — every individual link in the chain works and
is guarded. But there is **no single screen or report** showing the full Ordered→Produced→Packed→Dispatched
picture together for one order; a manager must manually cross-reference three separate reports. And because
BOM has no approval gate, all 10,000 units could be planned against an unreviewed, freshly-edited BOM with
no one having signed off on it.

**Scenario 2 (customer changes order after BOM approval)**: this scenario's own premise cannot literally
happen — **there is no BOM approval concept to have occurred in the first place.** More directly: editing a
CONFIRMED Sales Order that already has an active Production Order against it is currently allowed with zero
warning, a real risk of the order and the in-progress production silently diverging.

**Scenario 3 (PO for 5,000m, 4,800m delivered)**: partial receipt itself is handled correctly and safely.
But if the supplier will never deliver the remaining 200m, **the PO has no valid way to be closed or
cancelled** — it is permanently stuck at `PARTIALLY_RECEIVED`. This is a concrete, realistic business
situation (a short-shipped order accepted as final) with no system answer today.

**Scenario 4 (10,000 planned, 9,700 good, 200 rejected, 100 unaccounted)**: the 9,700+200 accounting itself
is correctly enforced by the CHECK constraint. The remaining 100 simply sits as "not yet processed" —
correct if work is still ongoing, but **if the business decides to accept the shortfall and move on, there
is no explicit "close this Job Order/Lot with an accepted shortfall" action** — the same "no terminal state
for an accepted partial outcome" pattern found in Scenario 3, now confirmed in a second module. **This is a
real, recurring architectural gap worth fixing once, not module-by-module.**

**Scenario 5 (3% fabric wastage)**: calculated correctly at planning time, exactly as specified — but never
verified against what was actually consumed (see Section 14, item 4).

**Scenario 6 (partial shipment of 4,000 of 10,000)**: works correctly — the best-tested scenario in this
audit, with real double guards (order remaining + real stock).

**Scenario 7 (company changes production sequence)**: works correctly, with zero code change — `ProductionStage`
is a real, working, company-scoped configurable master exactly as required.

**Scenario 8 (two companies, different processes, no interference)**: confirmed correct — `companyId`
scoping is universal and independently contract-tested across this project's history.

---

## 16. Excel Replacement Test

| Module | What an employee would STILL need Excel/WhatsApp/a register for |
|---|---|
| Sampling | A manual "days overdue" tracker (the system stores the target date but never computes lateness) |
| Sampling BOM / BOM | A manual BOM-version-history log ("what did we change and when") — the system genuinely cannot answer this; a BOM Cost Sheet (material cost only, on a separate not-yet-merged branch; processing/labour/overhead cost entirely absent) |
| Sales Order | An order-status tracker showing Ordered vs. actually Produced so far — the system has no field for this at all |
| Purchase Order | A landed-cost/tax calculator (PO totals exclude tax entirely); a "PO that will never be fully received" log, since the system can't close these |
| Production | An actual-wastage-vs-planned tracker; a "what didn't pass QC" register (since QC isn't mandatory, nothing forces this to be recorded in-system) |
| Packaging | A physical packing list / shipping document (weight, dimensions, carton contents in a printable form) — the system has the raw data but no document |
| Dispatch | None identified — this module would not need an Excel workaround for anything audited here |

This test is the clearest evidence of where real business pain would still exist despite the sophisticated
code already in place: **not in the transactional guards (which are strong), but in traceability/reconciliation
views and a small number of missing terminal states.**

---

## 17. Feature Classification

### MUST HAVE
- BOM versioning (append-only, same pattern as `SampleVersion`) + a real approval gate before MRP/Production can consume it
- Sales Order status check in `createProductionOrder()` (block producing against a CANCELLED order)
- A guard on editing a CONFIRMED Sales Order with an active Production Order against it
- A terminal "accept shortfall and close" path for a permanently under-delivered Purchase Order
- Tax field on Purchase Order

### SHOULD HAVE
- Ordered→Produced quantity roll-up visible on the Sales Order itself
- Wastage actual-vs-planned reconciliation report
- Mandatory-QC-before-final-stage option (configurable per company, default off to preserve current behavior)
- QC/inspection step at Goods Receipt
- Days-overdue computation for Sample target dates (mirroring Job Work Order's existing pattern)

### NICE TO HAVE
- Carton weight/dimensions fields
- A formatted, printable packing-list document
- A single consolidated "order lifecycle" reconciliation view (Ordered/Produced/Packed/Dispatched together) — note: `/reports/order-lifecycle` already exists project-wide as a multi-section trace; extending it to include a Produced-quantity section would close much of this

### NOT NEEDED NOW
- Multi-level approval chains (no evidence this business needs more than one level anywhere)
- A generic workflow/BPM engine for production stages — the current configurable-master approach is correct and should not be replaced
- A packing-material hierarchy (polybag/inner-pack/master-carton) beyond the current flat Carton — no evidence of need yet
- Configurable wastage-rule engines — a simple actual-vs-planned percentage comparison is sufficient; a rules engine would be over-engineering

---

## 18. Final Score

| Module | Business Completeness | CRUD Risk | Production Readiness | Main Gap |
|---|---:|---:|---:|---|
| Sampling | 80/100 | Low | High | No delay/overdue tracking |
| Sampling BOM / BOM | **35/100** | **High** | Low | **No versioning, no approval — the weakest module** |
| Sales Order | 70/100 | Low | Medium-High | No Ordered→Produced link; Production doesn't check order status |
| Purchase Order | 75/100 | Low | High | No tax field; no terminal state for a short-delivered PO |
| Production | 88/100 | Low | High | QC not mandatory; no wastage reconciliation |
| Production BOM | *(same model as Sampling BOM, scored together above)* | — | — | — |
| Packaging | 55/100 | Medium | Medium | No packing-list document, no weight/dimensions |
| Dispatch | 90/100 | Low | High | None material |

### Overall Practical ERP Readiness: **72 / 100**

---

## 19. Final Decision

### C. Business Ready but needs important upgrades

This is not "too basic" — the evidence throughout this audit shows extensive real, enforced business logic:
self-approval-guarded approvals, atomic guarded accumulators, a DB-level CHECK constraint, a real
append-only production ledger, and race-safe dispatch validation against actual stock. It is also not
"over-engineered" — Section 13 found essentially no wasteful abstraction anywhere in this scope, and the one
piece of real complexity (the production ledger) is justified by concrete, cited reuse (External Job Work
working with zero special-casing).

What keeps it from "practically ready with no upgrades" is a small number of specific, well-evidenced gaps —
overwhelmingly concentrated in **traceability and terminal states** rather than in day-to-day transactional
correctness: BOM's complete absence of versioning/approval, two independent instances of "no way to close
out an accepted partial outcome" (Purchase Order, Production), and cross-module status checks that exist in
some places (Dispatch↔Sales Order) but not others (Production↔Sales Order). None of these are architectural
flaws requiring a redesign — every one is a targeted, scoped fix on top of patterns that already exist and
work elsewhere in this same codebase.

---

## 20. Final Recommended Roadmap

### Phase 1 — Must Fix Before Real Company Usage
1. BOM versioning (reuse `SampleVersion`'s exact pattern) + a real approval gate
2. Block `createProductionOrder()` against a non-CONFIRMED/CANCELLED Sales Order
3. Guard editing a CONFIRMED Sales Order once an active Production Order references it
4. A terminal "close with accepted shortfall" action for Purchase Order (and the equivalent for Production Order/Lot)
5. Tax field on Purchase Order

### Phase 2 — Important Business Improvements
6. Ordered→Produced quantity visibility on the Sales Order (even a simple computed field/section is enough — no schema redesign needed)
7. Wastage actual-vs-planned reconciliation report
8. Optional mandatory-QC-before-final-stage toggle (company-configurable, default preserves current behavior)
9. Sample target-date overdue computation (mirror the existing Job Work Order pattern)
10. QC/inspection step at Goods Receipt

### Phase 3 — Scaling Improvements
11. Carton weight/dimensions fields + a printable packing-list document
12. Extend the existing `/reports/order-lifecycle` view with a Produced-quantity section
13. Vendor delivery-performance tracking (on-time %, short-delivery %) once enough real PO history exists to make it meaningful

### Don't Build Yet
- A generic workflow/BPM engine for production stages — the current company-configurable `ProductionStage` master is correct and sufficient
- Multi-level approval chains anywhere — no evidence this business needs more than the current single-level, self-approval-guarded model
- A packing-material hierarchy (polybag/inner-pack/master-carton) beyond the current flat Carton structure
- A configurable wastage-rules engine — a plain actual-vs-planned percentage is enough; a rules engine would solve a problem that doesn't exist yet
- Multi-currency, WhatsApp notifications, a dynamic form builder, or any generic rules/plugin system — none are evidenced as needed by anything found in this audit
