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
};
