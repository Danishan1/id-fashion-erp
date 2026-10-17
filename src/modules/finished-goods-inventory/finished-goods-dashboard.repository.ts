import { prisma } from "@/core/db/client";

export const FinishedGoodsDashboardRepository = {
  sumSaleable: (companyId: string) =>
    prisma.finishedGoodsStockBalance.aggregate({ where: { companyId, stockStatus: "SALEABLE" }, _sum: { quantityOnHand: true } }),

  sumRejected: (companyId: string) =>
    prisma.finishedGoodsStockBalance.aggregate({ where: { companyId, stockStatus: "REJECTED" }, _sum: { quantityOnHand: true } }),

  countDistinctStyles: (companyId: string) =>
    prisma.finishedGoodsStockBalance.findMany({
      where: { companyId, quantityOnHand: { gt: 0 } },
      select: { productId: true },
      distinct: ["productId"],
    }),

  countFinishedGoodsWarehouses: (companyId: string) => prisma.warehouse.count({ where: { companyId, type: { has: "FINISHED_GOODS" } } }),

  findManyUnallocatedLegacyStock: (companyId: string) =>
    prisma.finishedGoodsStockBalance.findMany({
      where: { companyId, productVariantId: null, quantityOnHand: { gt: 0 } },
      include: {
        product: { select: { id: true, styleCode: true, styleName: true } },
        warehouse: { select: { id: true, code: true, name: true } },
      },
      orderBy: { quantityOnHand: "desc" },
    }),
};
