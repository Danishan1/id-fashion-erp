import type { Prisma, StockStatus } from "@prisma/client";
import { prisma } from "@/core/db/client";

export interface FinishedGoodsPutawayItemInput {
  warehouseLocationId: string;
  quantity: number;
  inventoryTransactionId: string;
}

export interface CreateFinishedGoodsPutawayData {
  // Generated client-side (randomUUID()) BEFORE this call, so every ledger
  // posting inside the same transaction can reference it as
  // referenceRecordId -- there is no pre-existing parent document (unlike
  // FinishedGoodsReceipt, which references the Lot) for a standalone Putaway
  // action to point at instead.
  id: string;
  companyId: string;
  branchId: string | null;
  putawayNumber: string;
  productId: string;
  productVariantId: string;
  warehouseId: string;
  stockStatus: StockStatus;
  totalQuantity: number;
  performedByUserId: string;
  items: FinishedGoodsPutawayItemInput[];
}

export const FinishedGoodsPutawayRepository = {
  createWithItemsInTx: (tx: Prisma.TransactionClient, data: CreateFinishedGoodsPutawayData) =>
    tx.finishedGoodsPutaway.create({
      data: {
        id: data.id,
        companyId: data.companyId,
        branchId: data.branchId,
        putawayNumber: data.putawayNumber,
        productId: data.productId,
        productVariantId: data.productVariantId,
        warehouseId: data.warehouseId,
        stockStatus: data.stockStatus,
        totalQuantity: data.totalQuantity,
        performedByUserId: data.performedByUserId,
        items: {
          createMany: {
            data: data.items.map((item) => ({
              warehouseLocationId: item.warehouseLocationId,
              quantity: item.quantity,
              inventoryTransactionId: item.inventoryTransactionId,
            })),
          },
        },
      },
      include: { items: true },
    }),

  /** Every staging (warehouseLocationId = null) balance row with a REAL
   * variant and a genuinely positive quantity -- deliberately excludes the
   * §4.7 "unallocated legacy" bucket (productVariantId = null), which is
   * the separate, not-yet-built Reconciliation/Opening Variant Allocation
   * action, not plain Putaway. */
  findManyStaging: (companyId: string, filters: { warehouseId?: string } = {}) =>
    prisma.finishedGoodsStockBalance.findMany({
      where: {
        companyId,
        warehouseLocationId: null,
        productVariantId: { not: null },
        quantityOnHand: { gt: 0 },
        ...(filters.warehouseId ? { warehouseId: filters.warehouseId } : {}),
      },
      include: {
        product: { select: { id: true, styleCode: true, styleName: true } },
        productVariant: { include: { color: true, size: true } },
        warehouse: { select: { id: true, name: true } },
      },
      orderBy: [{ warehouseId: "asc" }, { productId: "asc" }],
    }),
};
