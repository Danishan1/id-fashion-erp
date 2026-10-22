import type { FinishedGoodsReceiptSource, FinishedGoodsReceiptStatus, Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";

export interface FinishedGoodsReceiptItemInput {
  productVariantId: string | null;
  quantity: number;
  /** Only for a receipt posted to stock immediately (none today — kept for older rows). */
  inventoryTransactionId?: string | null;
  /** Suggested location to receive into (a customer return's pick location). */
  suggestedLocationId?: string | null;
}

export interface CreateFinishedGoodsReceiptData {
  companyId: string;
  branchId: string | null;
  receiptNumber: string;
  productId: string;
  lotId?: string | null;
  jobOrderId?: string | null;
  productionOrderId?: string | null;
  dispatchId?: string | null;
  dispatchReturnId?: string | null;
  warehouseId: string;
  totalQuantity: number;
  source: FinishedGoodsReceiptSource;
  status: FinishedGoodsReceiptStatus;
  remarks?: string | null;
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
        lotId: data.lotId ?? null,
        jobOrderId: data.jobOrderId ?? null,
        productionOrderId: data.productionOrderId ?? null,
        dispatchId: data.dispatchId ?? null,
        dispatchReturnId: data.dispatchReturnId ?? null,
        warehouseId: data.warehouseId,
        totalQuantity: data.totalQuantity,
        source: data.source,
        status: data.status,
        remarks: data.remarks ?? null,
        postedByUserId: data.postedByUserId,
        items: {
          createMany: {
            data: data.items.map((item) => ({
              productVariantId: item.productVariantId,
              quantity: item.quantity,
              inventoryTransactionId: item.inventoryTransactionId ?? null,
              suggestedLocationId: item.suggestedLocationId ?? null,
            })),
          },
        },
      },
      include: { items: true },
    }),

  findByLotId: (companyId: string, lotId: string) =>
    prisma.finishedGoodsReceipt.findMany({ where: { companyId, lotId }, include: { items: true } }),
};
