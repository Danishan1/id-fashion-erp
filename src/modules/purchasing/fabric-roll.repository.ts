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

  /** Atomic guard — the reversal cap is remainingQuantity itself, expressed
   * directly in the `where` clause (never a separate read-then-write). */
  guardedDecrementRemaining: (tx: Prisma.TransactionClient, id: string, decrementBy: number) =>
    tx.fabricRoll.updateMany({
      where: { id, remainingQuantity: { gte: decrementBy } },
      data: { remainingQuantity: { decrement: decrementBy } },
    }),

  findRemainingInTx: (tx: Prisma.TransactionClient, id: string) =>
    tx.fabricRoll.findUnique({ where: { id }, select: { remainingQuantity: true } }),

  updateStatusInTx: (tx: Prisma.TransactionClient, id: string, status: "CANCELLED" | "DAMAGED") =>
    tx.fabricRoll.update({ where: { id }, data: { status } }),
};
