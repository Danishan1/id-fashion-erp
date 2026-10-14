import type { Prisma } from "@prisma/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
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
