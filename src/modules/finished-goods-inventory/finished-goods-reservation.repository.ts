import type { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";

export interface FinishedGoodsReservationRow {
  companyId: string;
  branchId: string | null;
  salesOrderLineId: string;
  productVariantId: string;
  warehouseId: string | null;
  reservedQuantity: number;
}

export const FinishedGoodsReservationRepository = {
  createMany: (tx: Prisma.TransactionClient, rows: FinishedGoodsReservationRow[]) =>
    tx.finishedGoodsReservation.createMany({ data: rows }),

  findById: (id: string) => prisma.finishedGoodsReservation.findUnique({ where: { id } }),

  findByIdInTx: (tx: Prisma.TransactionClient, id: string) => tx.finishedGoodsReservation.findUnique({ where: { id } }),

  findActiveForSalesOrderLineIds: (companyId: string, salesOrderLineIds: string[]) =>
    prisma.finishedGoodsReservation.findMany({
      where: { companyId, salesOrderLineId: { in: salesOrderLineIds }, status: "ACTIVE" },
    }),

  /**
   * The courtesy pre-check behind the "Available" formula (§4.2 of the
   * implementation plan) — sums every ACTIVE reservation's own unconsumed
   * remainder (reservedQuantity - consumedQuantity) for one variant,
   * optionally scoped to one warehouse. Never trusted as the real gate —
   * guardedConsume() below is the actual atomic protection.
   */
  sumActiveUnconsumedForVariant: async (
    companyId: string,
    productVariantId: string,
    warehouseId?: string | null
  ): Promise<number> => {
    const rows = await prisma.finishedGoodsReservation.findMany({
      where: {
        companyId,
        productVariantId,
        status: "ACTIVE",
        ...(warehouseId !== undefined ? { warehouseId } : {}),
      },
      select: { reservedQuantity: true, consumedQuantity: true },
    });
    return rows.reduce((sum, row) => sum + (Number(row.reservedQuantity) - Number(row.consumedQuantity)), 0);
  },

  /**
   * The real atomic guard (§4.2) — a single raw-SQL UPDATE comparing the
   * LIVE consumed_quantity/reserved_quantity columns against each other at
   * execution time (a column-to-column comparison with an added literal,
   * which Prisma's `updateMany` `where` clause cannot express — the same
   * reasoning already established in this codebase for Purchase Invoice's
   * `guardedDecrementReceived`/`guardedIncrementInvoiced`). Flips status to
   * FULFILLED in the SAME statement when the increment exactly exhausts the
   * reservation, so there is no separate, non-atomic follow-up write — and
   * no race window for a second concurrent call to slip through between a
   * guarded increment and a status flip, since both happen in one
   * statement. Returns the affected-row count; 0 means the guard failed (an
   * over-consumption attempt, a genuine concurrent race, or the reservation
   * isn't currently ACTIVE).
   */
  guardedConsume: (tx: Prisma.TransactionClient, reservationId: string, incrementBy: number): Promise<number> =>
    tx.$executeRaw`
      UPDATE finished_goods_reservations
      SET consumed_quantity = consumed_quantity + ${incrementBy},
          status = CASE
            WHEN consumed_quantity + ${incrementBy} = reserved_quantity THEN 'FULFILLED'::"FinishedGoodsReservationStatus"
            ELSE status
          END,
          updated_at = now()
      WHERE id = ${reservationId}::uuid
        AND status = 'ACTIVE'
        AND consumed_quantity + ${incrementBy} <= reserved_quantity
    `,

  /** A plain status-transition guard (ACTIVE -> RELEASED) — no column-to-column
   * comparison is needed here, so a plain Prisma `updateMany` is sufficient;
   * only the raw-SQL consumption guard above needs raw SQL. */
  guardedRelease: (tx: Prisma.TransactionClient, reservationId: string) =>
    tx.finishedGoodsReservation.updateMany({
      where: { id: reservationId, status: "ACTIVE" },
      data: { status: "RELEASED" },
    }),

  releaseAllActiveForSalesOrderLineIdsInTx: (tx: Prisma.TransactionClient, salesOrderLineIds: string[]) =>
    tx.finishedGoodsReservation.updateMany({
      where: { salesOrderLineId: { in: salesOrderLineIds }, status: "ACTIVE" },
      data: { status: "RELEASED" },
    }),
};
