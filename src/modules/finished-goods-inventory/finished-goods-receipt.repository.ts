import type { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";

export interface FinishedGoodsReceiptItemInput {
  productVariantId: string;
  quantity: number;
  inventoryTransactionId: string;
}

export interface CreateFinishedGoodsReceiptData {
  companyId: string;
  branchId: string | null;
  receiptNumber: string;
  productId: string;
  lotId: string;
  jobOrderId: string;
  productionOrderId: string;
  warehouseId: string;
  totalQuantity: number;
  postedByUserId: string;
  items: FinishedGoodsReceiptItemInput[];
}

export const FinishedGoodsReceiptRepository = {
  createWithItemsInTx: (tx: Prisma.TransactionClient, data: CreateFinishedGoodsReceiptData) =>
    tx.finishedGoodsReceipt.create({
      data: {
        companyId: data.companyId,
        branchId: data.branchId,
        receiptNumber: data.receiptNumber,
        productId: data.productId,
        lotId: data.lotId,
        jobOrderId: data.jobOrderId,
        productionOrderId: data.productionOrderId,
        warehouseId: data.warehouseId,
        totalQuantity: data.totalQuantity,
        postedByUserId: data.postedByUserId,
        items: {
          createMany: {
            data: data.items.map((item) => ({
              productVariantId: item.productVariantId,
              quantity: item.quantity,
              inventoryTransactionId: item.inventoryTransactionId,
            })),
          },
        },
      },
      include: { items: true },
    }),

  findByLotId: (companyId: string, lotId: string) =>
    prisma.finishedGoodsReceipt.findMany({ where: { companyId, lotId }, include: { items: true } }),
};
