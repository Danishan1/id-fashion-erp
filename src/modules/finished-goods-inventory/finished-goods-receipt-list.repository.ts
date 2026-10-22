import type { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";

export const FinishedGoodsReceiptListRepository = {
  findMany: (
    where: Prisma.FinishedGoodsReceiptWhereInput,
    args: { orderBy: Prisma.FinishedGoodsReceiptOrderByWithRelationInput; skip: number; take: number }
  ) =>
    prisma.finishedGoodsReceipt.findMany({
      where,
      include: {
        product: { select: { id: true, styleCode: true, styleName: true } },
        lot: { select: { id: true, lotNumber: true } },
        productionOrder: { select: { id: true, orderNumber: true } },
        warehouse: { select: { id: true, code: true, name: true } },
        postedBy: { select: { id: true, fullName: true } },
        dispatch: { select: { id: true, dispatchNumber: true } },
        dispatchReturn: { select: { id: true, returnNumber: true } },
      },
      ...args,
    }),

  count: (where: Prisma.FinishedGoodsReceiptWhereInput) => prisma.finishedGoodsReceipt.count({ where }),

  findById: (companyId: string, id: string) =>
    prisma.finishedGoodsReceipt.findFirst({
      where: { companyId, id },
      include: {
        product: { select: { id: true, styleCode: true, styleName: true } },
        lot: { select: { id: true, lotNumber: true } },
        jobOrder: { select: { id: true } },
        productionOrder: { select: { id: true, orderNumber: true } },
        warehouse: { select: { id: true, code: true, name: true } },
        postedBy: { select: { id: true, fullName: true } },
        dispatch: { select: { id: true, dispatchNumber: true } },
        dispatchReturn: { select: { id: true, returnNumber: true, remarks: true } },
        items: { include: { productVariant: { include: { color: true, size: true } } } },
        // Receive log (2026-10-22): every receive action, oldest first.
        postings: {
          orderBy: { createdAt: "asc" },
          include: {
            receivedBy: { select: { fullName: true } },
            warehouseLocation: { select: { code: true } },
            receiptItem: { select: { productVariant: { include: { color: true, size: true } } } },
          },
        },
      },
    }),
};
