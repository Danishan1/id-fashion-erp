import { prisma } from "@/core/db/client";

export const FinishedGoodsStyleStockDetailsRepository = {
  sumSaleableForProduct: (companyId: string, productId: string) =>
    prisma.finishedGoodsStockBalance.aggregate({
      where: { companyId, productId, stockStatus: "SALEABLE" },
      _sum: { quantityOnHand: true },
    }),

  sumRejectedForProduct: (companyId: string, productId: string) =>
    prisma.finishedGoodsStockBalance.aggregate({
      where: { companyId, productId, stockStatus: "REJECTED" },
      _sum: { quantityOnHand: true },
    }),

  countDistinctVariantsForProduct: (companyId: string, productId: string) =>
    prisma.finishedGoodsStockBalance.findMany({
      where: { companyId, productId, productVariantId: { not: null }, quantityOnHand: { gt: 0 } },
      select: { productVariantId: true },
      distinct: ["productVariantId"],
    }),

  countDistinctWarehousesForProduct: (companyId: string, productId: string) =>
    prisma.finishedGoodsStockBalance.findMany({
      where: { companyId, productId, quantityOnHand: { gt: 0 } },
      select: { warehouseId: true },
      distinct: ["warehouseId"],
    }),

  /**
   * Every Sales Order line for this style that still represents a genuine,
   * active commercial commitment against company-wide FG stock — process-
   * flow clarity fix (2026-10-16), spec §2 ("unallocated Finished Goods
   * stock"). DRAFT (not yet a real commitment) and the terminal statuses
   * (DISPATCHED/CLOSED/CANCELLED — nothing left for the order to still
   * claim) are excluded; ON_HOLD is kept, since pausing an order doesn't
   * free up the stock it still legitimately needs once resumed.
   */
  findActiveOrderLinesForProduct: (companyId: string, productId: string) =>
    prisma.salesOrderItem.findMany({
      where: {
        productId,
        salesOrder: {
          companyId,
          status: { in: ["CONFIRMED", "IN_PRODUCTION", "PARTIALLY_DISPATCHED", "INVOICED", "ON_HOLD"] },
        },
      },
      select: { regularDispatchedQuantity: true, breakdown: { select: { orderedQuantity: true } } },
    }),
};
