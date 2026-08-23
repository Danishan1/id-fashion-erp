import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

export const GoodsReceiptRepository = {
  findMany: (where: Prisma.GoodsReceiptWhereInput, args: Omit<Prisma.GoodsReceiptFindManyArgs, "where">) =>
    prisma.goodsReceipt.findMany({
      where,
      include: {
        purchaseOrder: { select: { id: true, orderNumber: true, supplier: { select: { name: true } } } },
        receivedBy: { select: { id: true, fullName: true } },
      },
      ...args,
    }),

  count: (where: Prisma.GoodsReceiptWhereInput) => prisma.goodsReceipt.count({ where }),

  findByIdWithDetails: (companyId: string, id: string) =>
    prisma.goodsReceipt.findFirst({
      where: { id, companyId },
      include: {
        purchaseOrder: { select: { id: true, orderNumber: true, supplier: { select: { name: true } } } },
        receivedBy: { select: { id: true, fullName: true } },
        items: {
          include: {
            product: { select: { id: true, styleName: true, styleCode: true, materialCategory: true } },
            uom: { select: { id: true, code: true, name: true } },
            warehouse: { select: { id: true, name: true, code: true } },
            warehouseLocation: { select: { id: true, code: true } },
            rolls: {
              include: {
                gsm: { select: { id: true, name: true } },
                dye: { select: { id: true, name: true } },
                weaveType: { select: { id: true, name: true } },
                width: { select: { id: true, name: true } },
                composition: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    }),

  findAnyById: (companyId: string, id: string) => prisma.goodsReceipt.findFirst({ where: { id, companyId } }),

  createWithItemsAndRolls: (tx: Prisma.TransactionClient, data: Prisma.GoodsReceiptUncheckedCreateInput) =>
    tx.goodsReceipt.create({
      data,
      include: { items: { include: { rolls: true } } },
    }),

  updateStatusInTx: (tx: Prisma.TransactionClient, id: string, status: "COMPLETED" | "PARTIALLY_REVERSED" | "CANCELLED") =>
    tx.goodsReceipt.update({ where: { id }, data: { status } }),
};

export const GoodsReceiptItemRepository = {
  /** Company-scoped via the parent receipt, matching the project's
   * established tenant-scoping convention for every by-id lookup. */
  findByIdWithContext: (companyId: string, id: string) =>
    prisma.goodsReceiptItem.findFirst({
      where: { id, goodsReceipt: { companyId } },
      include: {
        rolls: true,
        goodsReceipt: true,
        // Expanded to reach the linked MaterialRequestItem (if any) and its
        // own uom — needed to convert a received quantity into that line's
        // unit before rolling it up (see goods-receipt.service.ts).
        purchaseOrderItem: {
          include: {
            materialRequestItem: { include: { uom: true } },
          },
        },
        uom: { select: { id: true, name: true, baseUnitId: true, conversionFactor: true } },
        product: {
          select: {
            styleName: true,
            baseUom: { select: { id: true, name: true, baseUnitId: true, conversionFactor: true } },
          },
        },
      },
    }),

  /** Atomic guard — the "already-reversed" cap expressed directly in the
   * `where` clause, never a separate read-then-write. */
  guardedIncrementReversed: (tx: Prisma.TransactionClient, id: string, receivedQuantity: number, incrementBy: number) =>
    tx.goodsReceiptItem.updateMany({
      where: { id, reversedQuantity: { lte: receivedQuantity - incrementBy } },
      data: { reversedQuantity: { increment: incrementBy } },
    }),

  findManyByReceiptIdInTx: (tx: Prisma.TransactionClient, goodsReceiptId: string) =>
    tx.goodsReceiptItem.findMany({
      where: { goodsReceiptId },
      select: { receivedQuantity: true, reversedQuantity: true },
    }),
};
