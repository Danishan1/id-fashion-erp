import type { Prisma } from "@prisma/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { FinishedGoodsStockBalanceRepository } from "@/modules/inventory/inventory.repository";
import { FinishedGoodsReservationRepository } from "./finished-goods-reservation.repository";

interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

/**
 * Finished Goods Inventory (FGI-011) — the reserve/consume/release lifecycle
 * described in §4.2/§8 of
 * docs/FINISHED_GOODS_INVENTORY_IMPLEMENTATION_PLAN.md.
 *
 * Deliberately NOT yet wired into confirmSalesOrder() / confirmDispatch() /
 * transitionSalesOrderStatus() — the approved plan assigns the consumption
 * wiring to a dedicated later task (FGI-041, "Reservation consumption wired
 * into confirmDispatch()"), but has no equivalent dedicated task for wiring
 * reservation *creation* into confirmSalesOrder(), or release into Sales
 * Order cancellation, even though both are named as this service's purpose
 * in §3's module list. This is a genuine gap in the approved plan, flagged
 * here and in the FGI-011 evidence section rather than silently assumed —
 * every function below is complete, fully tested, and ready to be called
 * from those sites once that wiring is explicitly scoped as its own task.
 */

/**
 * STILL UNWIRED (confirmed, 2026-10-16) — and now deliberately so, not just
 * by omission: the business rule decided for Process-Flow Phase 1 is "only
 * ACTUAL completed Packing quantity may ever create a reservation; ordered-
 * but-unproduced quantity must never reserve or hide existing stock." This
 * function reserves the FULL ordered quantity immediately, with zero
 * production having happened yet — wiring it into confirmSalesOrder() as
 * originally planned would violate that rule directly (it would make an
 * order's own unproduced demand suppress visibility of real, already-
 * existing stock the moment the order is confirmed). The real, rule-
 * compliant creation trigger is `applyPackingCompletionReservationsInTx`
 * below, called from Packing completion, not Sales-Order confirm. This
 * function is kept, unmodified and still fully tested, only because nothing
 * in Phase 1's authorized scope calls for removing it — it remains available
 * for Phase 3's own, separately-scoped work if a different trigger point is
 * ever genuinely wanted there.
 *
 * Creates one ACTIVE FinishedGoodsReservation per (salesOrderLineId,
 * productVariantId) pair found in the order's own SalesOrderItem/Breakdown
 * rows, at reservedQuantity = the summed orderedQuantity for that pair
 * (summed defensively in case more than one item row on the same line ever
 * carries the same variant — not expected today, but safe either way).
 * Items with no salesOrderLineId (legacy/test rows predating the Effective
 * BOM column, per that column's own schema comment) are skipped, never
 * crashed on.
 *
 * Must be called from inside the same transaction as the caller's own
 * company-scoped load of the Sales Order (e.g. confirmSalesOrder()) — this
 * function does not re-validate company scoping itself, trusting the
 * caller's own already-performed check, the same assumption every other
 * `...InTx` helper in this codebase makes of its caller.
 */
export async function createReservationsForSalesOrderInTx(tx: Prisma.TransactionClient, actor: ActorContext, salesOrderId: string) {
  const items = await tx.salesOrderItem.findMany({
    where: { salesOrderId },
    select: {
      salesOrderLineId: true,
      breakdown: { select: { productVariantId: true, orderedQuantity: true } },
    },
  });

  const grouped = new Map<string, number>();
  for (const item of items) {
    if (!item.salesOrderLineId) continue;
    for (const row of item.breakdown) {
      const key = `${item.salesOrderLineId}::${row.productVariantId}`;
      grouped.set(key, (grouped.get(key) ?? 0) + row.orderedQuantity);
    }
  }

  if (grouped.size === 0) return [];

  const rows = Array.from(grouped.entries()).map(([key, quantity]) => {
    const [salesOrderLineId, productVariantId] = key.split("::");
    return {
      companyId: actor.companyId,
      branchId: actor.branchId ?? null,
      salesOrderLineId,
      productVariantId,
      warehouseId: null,
      reservedQuantity: quantity,
    };
  });

  await FinishedGoodsReservationRepository.createMany(tx, rows);
  return rows;
}

/**
 * Process-Flow Phase 1 (2026-10-16) — the REAL reservation-creation trigger:
 * called from job-order.service.ts's `completeAtFinalStageInTx()`, inside the
 * exact same transaction as the Finished-Goods receipt that same completion
 * posts, immediately after it. Only ever reached for a variant-bearing style
 * (a no-variant style has no `productVariantId` to key a reservation on at
 * all — `FinishedGoodsReservation.productVariantId` is a required column, and
 * inventing a pseudo-variant was explicitly ruled out; no-variant styles use
 * the separate, already-existing production-capped style-level formula in
 * finished-goods-style-stock-details.service.ts instead, with no reservation
 * of any kind).
 *
 * The business rule this enforces (confirmed, Phase 0 corrected plan): a
 * reservation may only ever grow by quantity that has ACTUALLY completed
 * Packing, and is capped per exact matching `productVariantId` at that
 * line's own `SalesOrderItemBreakdown.orderedQuantity` — never a style-level
 * substitute, never the raw ordered total regardless of variant. Two
 * documented fail-safes, both deliberate, neither an oversight:
 *   - A completed variant with NO matching breakdown row on the linked order
 *     line (the floor worker's own entered variantBreakdown is never cross-
 *     validated against the order's own breakdown, only against the style's
 *     real ProductVariant set — see resolveFinalStageVariantBreakdown) gets
 *     NO reservation at all. The quantity is not lost — it was already
 *     posted to real Finished-Goods stock by the caller, just before this
 *     function runs — it simply becomes genuinely unallocated stock rather
 *     than being misattributed to a variant that was never actually ordered.
 *   - Duplicate rows for the same productVariantId in one completion's own
 *     variantBreakdown are aggregated (summed) BEFORE any increment is
 *     applied, so a duplicate input can never apply two separate increments
 *     or silently drop one.
 *
 * Make-to-Stock production (ProductionOrder.salesOrderItemId null) and a
 * legacy SalesOrderItem predating the Effective BOM column (salesOrderLineId
 * null) are both silently skipped — never crashed on — matching
 * createReservationsForSalesOrderInTx's own established precedent for the
 * identical column.
 *
 * KNOWN, DOCUMENTED, INHERITED RISK (confirmed via direct investigation,
 * 2026-10-16 — not introduced by this function): forwardJobOrder() and
 * recordQcInspection() (this function's only two real callers, via
 * completeAtFinalStageInTx) have no idempotency-key protection of their own
 * against a genuine request retry creating a second, duplicate completion
 * event for a quantity that still has legitimate forwarding/QC headroom —
 * confirmed by reading forwardJobOrderSchema/createQcInspectionSchema
 * directly, neither has an idempotencyKey field (unlike receiveJobWork's own
 * existing "CF-5" pattern for external Job Work receipts). This function
 * does not make that pre-existing exposure worse: because it runs from the
 * exact same `variantBreakdown` input, in the exact same transaction, as the
 * Finished-Goods receipt a duplicate completion would also double-post, a
 * reservation created here can only ever drift from real posted stock in
 * lockstep with that already-accepted exposure — never as an independent,
 * additional source of drift. A proper fix (an idempotency key on
 * forwardJobOrder/recordQcInspection, mirroring receiveJobWork's own CF-5
 * pattern) is recommended as a separate, dedicated follow-up — explicitly
 * out of Phase 1's own scope.
 */
export async function applyPackingCompletionReservationsInTx(
  tx: Prisma.TransactionClient,
  actor: ActorContext,
  params: {
    productionOrderId: string;
    warehouseId: string;
    variantBreakdown: { productVariantId: string; quantity: number }[];
  }
): Promise<void> {
  const order = await tx.productionOrder.findUnique({
    where: { id: params.productionOrderId },
    select: { salesOrderItemId: true },
  });
  if (!order?.salesOrderItemId) return; // Make-to-Stock — nothing to reserve against.

  const item = await tx.salesOrderItem.findUnique({
    where: { id: order.salesOrderItemId },
    select: { salesOrderLineId: true, breakdown: { select: { productVariantId: true, orderedQuantity: true } } },
  });
  if (!item?.salesOrderLineId) return; // Legacy row predating the Effective BOM column — skip, never crash.

  const orderedByVariant = new Map(item.breakdown.map((b) => [b.productVariantId, b.orderedQuantity]));

  // Aggregate duplicate variant rows in the completion's own breakdown before
  // applying any increment — never two separate increments for the same
  // variant, never a silently dropped one.
  const completedByVariant = new Map<string, number>();
  for (const row of params.variantBreakdown) {
    completedByVariant.set(row.productVariantId, (completedByVariant.get(row.productVariantId) ?? 0) + row.quantity);
  }

  for (const [productVariantId, completedQuantity] of completedByVariant) {
    const capAt = orderedByVariant.get(productVariantId);
    // Produced a variant this specific order line never ordered — no
    // reservation, fails safely (see this function's own doc comment).
    if (capAt === undefined) continue;

    await FinishedGoodsReservationRepository.upsertIncrementCappedInTx(tx, {
      companyId: actor.companyId,
      branchId: actor.branchId ?? null,
      salesOrderLineId: item.salesOrderLineId,
      productVariantId,
      warehouseId: params.warehouseId,
      capAt,
      incrementBy: completedQuantity,
    });
  }
}

/**
 * Consumes `incrementBy` of a reservation's remaining unconsumed quantity
 * (reservedQuantity - consumedQuantity), via the atomic guarded raw-SQL
 * update in the repository — never a read-then-write. Flips the reservation
 * to FULFILLED automatically, in the same statement, the moment it's fully
 * consumed.
 */
export async function consumeReservation(tx: Prisma.TransactionClient, reservationId: string, incrementBy: number): Promise<void> {
  const affected = await FinishedGoodsReservationRepository.guardedConsume(tx, reservationId, incrementBy);
  if (affected > 0) return;

  const reservation = await FinishedGoodsReservationRepository.findByIdInTx(tx, reservationId);
  if (!reservation) {
    throw new BusinessRuleError("NOT_FOUND", "Reservation not found.", { reservationId });
  }
  if (reservation.status !== "ACTIVE") {
    throw new BusinessRuleError("RESERVATION_NOT_ACTIVE", `Cannot consume a reservation in "${reservation.status}" status.`, {
      reservationId,
      status: reservation.status,
    });
  }
  const remaining = Number(reservation.reservedQuantity) - Number(reservation.consumedQuantity);
  throw new BusinessRuleError(
    "OVER_CONSUMPTION_NOT_ALLOWED",
    `Cannot consume ${incrementBy} against this reservation — only ${remaining} remains unconsumed.`,
    { reservationId, requested: incrementBy, remaining }
  );
}

/**
 * Releases a single ACTIVE reservation (an explicit correction/admin
 * action). Already-consumed quantity is never touched or "un-consumed" —
 * only the status flips, so the Available formula (which sums only ACTIVE
 * rows' unconsumed remainder) stops counting the rest of this reservation's
 * commitment, freeing exactly the unconsumed remainder, while the
 * already-consumed portion stays correctly accounted for as real,
 * already-shipped stock.
 */
export async function releaseReservation(tx: Prisma.TransactionClient, reservationId: string): Promise<void> {
  const { count } = await FinishedGoodsReservationRepository.guardedRelease(tx, reservationId);
  if (count > 0) return;

  const reservation = await FinishedGoodsReservationRepository.findByIdInTx(tx, reservationId);
  if (!reservation) {
    throw new BusinessRuleError("NOT_FOUND", "Reservation not found.", { reservationId });
  }
  throw new BusinessRuleError("RESERVATION_NOT_ACTIVE", `Cannot release a reservation in "${reservation.status}" status.`, {
    reservationId,
    status: reservation.status,
  });
}

/**
 * Bulk release for Sales-Order-level cancellation. Idempotent by
 * construction: only rows genuinely still ACTIVE are touched (via the
 * repository's own `status: "ACTIVE"` filter), so calling this twice, or on
 * an order with zero reservations, is a safe no-op, never an error.
 */
export async function releaseActiveReservationsForSalesOrderInTx(tx: Prisma.TransactionClient, salesOrderId: string): Promise<number> {
  const lines = await tx.salesOrderLine.findMany({ where: { salesOrderId }, select: { id: true } });
  if (lines.length === 0) return 0;

  const { count } = await FinishedGoodsReservationRepository.releaseAllActiveForSalesOrderLineIdsInTx(
    tx,
    lines.map((line) => line.id)
  );
  return count;
}

/**
 * The "committed" term in the Available formula (§4.2): `Available =
 * Saleable − sum(ACTIVE reservations' unconsumed remainder)`. A read-only
 * helper for future Available-stock callers — never itself the gate against
 * overselling (that's always the guarded write, consumeReservation() above).
 */
export async function getCommittedReservationQuantity(
  companyId: string,
  productVariantId: string,
  warehouseId?: string | null
): Promise<number> {
  return FinishedGoodsReservationRepository.sumActiveUnconsumedForVariant(companyId, productVariantId, warehouseId);
}

/**
 * Finished Goods Inventory module (FGI-041) — the full §4.2 "Available"
 * formula: Saleable (across every location, real + staging, for this
 * specific variant at this warehouse) minus every ACTIVE reservation's own
 * unconsumed remainder for that same variant+warehouse. This is the
 * figure confirmDispatch()'s own new variant-level pre-check (§7 point 1)
 * compares a dispatch's picked quantity against — never the real, atomic
 * gate (that is always the guarded decrement inside
 * recordInventoryTransaction(), per §4.2's own "protection is always at the
 * write side" rule), just the friendly, pre-transaction courtesy check.
 */
export async function getFinishedGoodsAvailableQuantity(
  companyId: string,
  productId: string,
  productVariantId: string,
  warehouseId: string
): Promise<number> {
  const [saleable, committed] = await Promise.all([
    FinishedGoodsStockBalanceRepository.sumSaleableAcrossLocations(companyId, productId, productVariantId, warehouseId),
    getCommittedReservationQuantity(companyId, productVariantId, warehouseId),
  ]);
  return saleable - committed;
}

/**
 * Available for one sales order line's own dispatch (2026-10-22): stock
 * reserved for THAT line is available to it — only other orders'
 * reservations are subtracted. Without this, an order's own reservation made
 * its own stock look unavailable to its own dispatch.
 */
export async function getFinishedGoodsAvailableForOrderLine(
  companyId: string,
  productId: string,
  productVariantId: string,
  warehouseId: string,
  salesOrderLineId: string | null
): Promise<number> {
  const available = await getFinishedGoodsAvailableQuantity(companyId, productId, productVariantId, warehouseId);
  if (!salesOrderLineId) return available;
  const own = await FinishedGoodsReservationRepository.sumActiveUnconsumedForLineVariant(companyId, salesOrderLineId, productVariantId, warehouseId);
  return available + own;
}

/**
 * Finished Goods Inventory module (FGI-041) — reservation consumption as
 * called from confirmDispatch(), one call per pick line, inside the same
 * transaction as that pick line's own recordInventoryTransaction() post
 * (§7 point 5). Deliberately NOT a thin wrapper around consumeReservation()
 * above: that function's own OVER_CONSUMPTION_NOT_ALLOWED throw is correct
 * for its own caller (an explicit, standalone "consume exactly this much"
 * admin-style action), but would be WRONG here — Extra Dispatch Quantity
 * (2026-09-30) deliberately allows shipping MORE of a variant than was ever
 * reserved for its sales order line (FOC/replacement/promotional), and nothing
 * about that legitimate, pre-existing feature should ever be blocked by this
 * new, purely-additive reservation bookkeeping. So this function caps the
 * amount it attempts to consume at whatever genuinely remains unconsumed on
 * the matching reservation (if one even exists — in practice, today, none
 * ever will, since nothing in the approved plan wires reservation CREATION
 * into confirmSalesOrder() yet; this is a deliberately scoped, flagged gap,
 * see finished-goods-reservation.service.ts's own module-level doc comment
 * and the Phase 4 evidence section) — a shortfall is silently a no-op, never
 * an error, and the real "don't oversell" protection is entirely the
 * variant-level Available check + guarded FinishedGoodsStockBalance decrement
 * above, not this bookkeeping step.
 *
 * salesOrderLineId may be null — a DispatchItem's own SalesOrderItem row
 * can predate the Effective BOM column (2026-09-24), the same "legacy/test
 * row, skipped, never crashed on" discipline createReservationsForSalesOrderInTx()
 * already applies to the identical column.
 */
export async function consumeReservationForDispatchInTx(
  tx: Prisma.TransactionClient,
  companyId: string,
  salesOrderLineId: string | null,
  productVariantId: string,
  quantityPicked: number
): Promise<void> {
  if (!salesOrderLineId) return;

  const reservation = await FinishedGoodsReservationRepository.findActiveForLineAndVariantInTx(tx, companyId, salesOrderLineId, productVariantId);
  if (!reservation) return;

  const remaining = Number(reservation.reservedQuantity) - Number(reservation.consumedQuantity);
  if (remaining <= 0) return;

  const toConsume = Math.min(quantityPicked, remaining);
  const affected = await FinishedGoodsReservationRepository.guardedConsume(tx, reservation.id, toConsume);
  if (affected === 0) {
    // A genuine concurrent race — another in-flight dispatch consumed part
    // of this same reservation between our read above and this write. The
    // whole confirmDispatch() transaction rolls back, same "the guarded
    // write is the real gate, a prior read is only ever a courtesy" rule
    // this reservation module already documents everywhere else.
    throw new BusinessRuleError(
      "OVER_CONSUMPTION_NOT_ALLOWED",
      "This reservation changed while confirming this dispatch — reload and try again.",
      { reservationId: reservation.id, salesOrderLineId, productVariantId }
    );
  }
}
