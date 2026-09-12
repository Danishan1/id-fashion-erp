import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

export const FabricRollRepository = {
  /** Company-scoped via the goods receipt item's own receipt, matching the
   * project's established tenant-scoping convention for every by-id lookup. */
  findByIdWithContext: (companyId: string, id: string) =>
    prisma.fabricRoll.findFirst({
      where: { id, companyId },
      include: { goodsReceiptItem: true },
    }),

  /** Every physically in-stock roll of this material at this warehouse,
   * with real quantity remaining — the color/shade-wise breakdown a Material
   * Request's own Issue action picks from, and the only place this app
   * tracks stock at a finer grain than the flat per-material StockBalance
   * total. Warehouse is resolved via the roll's own GoodsReceiptItem (a
   * FabricRoll has no warehouseId of its own), matching
   * getAvailableQuantityByDye()'s already-established join shape. Ordered by
   * dye name (nulls last) so same-shade rolls group together in the picker. */
  findAvailableForMaterial: (companyId: string, productId: string, warehouseId: string) =>
    prisma.fabricRoll.findMany({
      where: {
        companyId,
        status: "IN_STOCK",
        remainingQuantity: { gt: 0 },
        goodsReceiptItem: { productId, warehouseId },
      },
      include: { dye: { select: { id: true, name: true, pantone: true } } },
      orderBy: [{ dye: { name: "asc" } }, { rollNumber: "asc" }],
    }),

  /** Atomic guard — the reversal cap is remainingQuantity itself, expressed
   * directly in the `where` clause (never a separate read-then-write). */
  guardedDecrementRemaining: (tx: Prisma.TransactionClient, id: string, decrementBy: number) =>
    tx.fabricRoll.updateMany({
      where: { id, remainingQuantity: { gte: decrementBy } },
      data: { remainingQuantity: { decrement: decrementBy } },
    }),

  findRemainingInTx: (tx: Prisma.TransactionClient, id: string) =>
    tx.fabricRoll.findUnique({ where: { id }, select: { remainingQuantity: true } }),

  /** Returns previously-decremented quantity back onto a roll — used when
   * reversing an issuance (e.g. cancelling a Job Work Order before any
   * receipt exists against it). Unconditional by design: unlike the guarded
   * decrement, there is no upper bound a plain increment could violate. */
  incrementRemaining: (tx: Prisma.TransactionClient, id: string, incrementBy: number) =>
    tx.fabricRoll.update({ where: { id }, data: { remainingQuantity: { increment: incrementBy } } }),

  updateStatusInTx: (tx: Prisma.TransactionClient, id: string, status: "CANCELLED" | "DAMAGED") =>
    tx.fabricRoll.update({ where: { id }, data: { status } }),
};
