import { FinishedGoodsDashboardRepository } from "./finished-goods-dashboard.repository";

/**
 * Finished Goods Inventory module (FGI-050) — the Dashboard's own read-only
 * aggregation. Reads EXCLUSIVELY from FinishedGoodsStockBalance (the new
 * cache this whole module exists to maintain) — never re-derives from the
 * InventoryTransaction ledger at request time, matching StockBalance's own
 * long-established "derived cache, not summed live" discipline (the common
 * acceptance criterion stated once for every FGI-05x screen task).
 */
export async function getFinishedGoodsDashboard(companyId: string) {
  const [saleableAgg, rejectedAgg, distinctStyleRows, finishedGoodsWarehouseCount, unallocatedRows] = await Promise.all([
    FinishedGoodsDashboardRepository.sumSaleable(companyId),
    FinishedGoodsDashboardRepository.sumRejected(companyId),
    FinishedGoodsDashboardRepository.countDistinctStyles(companyId),
    FinishedGoodsDashboardRepository.countFinishedGoodsWarehouses(companyId),
    // Finished Goods Inventory module (§4.7) — every row still sitting in
    // the "unallocated legacy stock" bucket (productVariantId = null),
    // deliberately never merged into any real variant's own number.
    FinishedGoodsDashboardRepository.findManyUnallocatedLegacyStock(companyId),
  ]);

  return {
    totalSaleableQuantity: Number(saleableAgg._sum.quantityOnHand ?? 0),
    totalRejectedQuantity: Number(rejectedAgg._sum.quantityOnHand ?? 0),
    distinctStyleCount: distinctStyleRows.length,
    finishedGoodsWarehouseCount,
    unallocatedLegacyStock: unallocatedRows.map((row) => ({
      productId: row.product.id,
      styleCode: row.product.styleCode,
      styleName: row.product.styleName,
      warehouseId: row.warehouse.id,
      warehouseCode: row.warehouse.code,
      warehouseName: row.warehouse.name,
      quantity: Number(row.quantityOnHand),
    })),
  };
}

export type FinishedGoodsDashboard = Awaited<ReturnType<typeof getFinishedGoodsDashboard>>;
