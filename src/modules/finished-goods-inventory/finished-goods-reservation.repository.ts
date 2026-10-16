import { randomUUID } from "node:crypto";
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

  /**
   * Finished Goods Inventory module (FGI-041) — resolves the one ACTIVE
   * reservation (if any) for a specific (salesOrderLineId, productVariantId)
   * pair, inside the caller's own transaction. createReservationsForSalesOrderInTx()'s
   * own grouping key guarantees at most one such row exists at a time — this
   * is a plain findFirst, not an aggregate, for exactly that reason.
   */
  findActiveForLineAndVariantInTx: (tx: Prisma.TransactionClient, companyId: string, salesOrderLineId: string, productVariantId: string) =>
    tx.finishedGoodsReservation.findFirst({ where: { companyId, salesOrderLineId, productVariantId, status: "ACTIVE" } }),

  /**
   * Process-flow Phase 1 (2026-10-16) — the real atomic primitive behind
   * applyPackingCompletionReservationsInTx (finished-goods-reservation.
   * service.ts): creates the one ACTIVE reservation for this
   * (salesOrderLineId, productVariantId) pair if none exists yet, or
   * increments its existing reservedQuantity, in both cases capping the
   * RESULT at `capAt` (the exact variant's own SalesOrderItemBreakdown.
   * orderedQuantity — never a style-level substitute, enforced entirely by
   * the caller, this function just applies whatever cap it's given).
   *
   * A single atomic `INSERT ... ON CONFLICT (...) WHERE status = 'ACTIVE' DO
   * UPDATE ...` — not a read-then-write — targeting the partial unique index
   * added in migration 20261016120000_add_finished_goods_reservation_active_
   * unique_index. Two concurrent completions for the same line+variant
   * therefore serialize at the database row-lock level: the second call's
   * own `LEAST(...)` recomputes against whatever the first call already
   * wrote, so the result is always correctly capped regardless of call
   * order — there is no window where a race could push reservedQuantity
   * past `capAt`.
   *
   * `id` is generated here, not by a database default — confirmed from this
   * project's own migrations that every table's `id` column has no SQL-level
   * DEFAULT (Prisma generates it client-side for every other write path);
   * matching that convention here keeps a raw-SQL-inserted row
   * indistinguishable from an ordinary Prisma-created one.
   */
  upsertIncrementCappedInTx: (
    tx: Prisma.TransactionClient,
    params: {
      companyId: string;
      branchId: string | null;
      salesOrderLineId: string;
      productVariantId: string;
      warehouseId: string;
      capAt: number;
      incrementBy: number;
    }
  ): Promise<{ id: string; reservedQuantity: Prisma.Decimal }[]> =>
    tx.$queryRaw`
      INSERT INTO finished_goods_reservations
        (id, company_id, branch_id, sales_order_line_id, product_variant_id, warehouse_id, reserved_quantity, consumed_quantity, status, created_at, updated_at)
      VALUES
        (${randomUUID()}::uuid, ${params.companyId}::uuid, ${params.branchId}::uuid, ${params.salesOrderLineId}::uuid, ${params.productVariantId}::uuid, ${params.warehouseId}::uuid, LEAST(${params.capAt}::decimal, ${params.incrementBy}::decimal), 0, 'ACTIVE'::"FinishedGoodsReservationStatus", now(), now())
      ON CONFLICT (sales_order_line_id, product_variant_id) WHERE status = 'ACTIVE'
      DO UPDATE SET
        reserved_quantity = LEAST(${params.capAt}::decimal, finished_goods_reservations.reserved_quantity + ${params.incrementBy}::decimal),
        updated_at = now()
      RETURNING id, reserved_quantity
    `,
};
