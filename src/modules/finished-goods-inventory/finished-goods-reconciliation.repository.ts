import { prisma } from "@/core/db/client";

export interface GroupedFinishedGoodsBalance {
  productId: string;
  warehouseId: string;
  sumQuantityOnHand: number;
}

export const FinishedGoodsReconciliationRepository = {
  /**
   * Every FG-tracked (productId, warehouseId) pair this company has, each
   * with the SUM of every FinishedGoodsStockBalance row under it — across
   * every variant/location/status dimension, including the nullable-variant
   * "unallocated" bucket from §4.7 (a plain `groupBy` with no further filter
   * naturally includes it, since it's just another row with the same
   * productId/warehouseId).
   */
  groupByProductWarehouse: async (companyId: string): Promise<GroupedFinishedGoodsBalance[]> => {
    const rows = await prisma.finishedGoodsStockBalance.groupBy({
      by: ["productId", "warehouseId"],
      where: { companyId },
      _sum: { quantityOnHand: true },
    });
    return rows.map((row) => ({
      productId: row.productId,
      warehouseId: row.warehouseId,
      sumQuantityOnHand: Number(row._sum.quantityOnHand ?? 0),
    }));
  },

  /** The matching flat StockBalance rows for a known set of (productId,
   * warehouseId) pairs — fetched in one batch query, not one per pair. */
  findManyStockBalances: (companyId: string, productIds: string[], warehouseIds: string[]) =>
    prisma.stockBalance.findMany({
      where: { companyId, productId: { in: productIds }, warehouseId: { in: warehouseIds } },
      select: { productId: true, warehouseId: true, quantityOnHand: true },
    }),
};
