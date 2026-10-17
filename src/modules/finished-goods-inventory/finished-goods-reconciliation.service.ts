import { FinishedGoodsReconciliationRepository } from "./finished-goods-reconciliation.repository";

const EPSILON = 0.0001; // matches this project's own established tolerance everywhere else

export interface FinishedGoodsReconciliationRow {
  productId: string;
  warehouseId: string;
  /** StockBalance.quantityOnHand for this (productId, warehouseId) — 0 if no row exists at all. */
  stockBalanceQuantity: number;
  /** sum(FinishedGoodsStockBalance.quantityOnHand) across every variant/location/status row
   * under this same (productId, warehouseId), including the nullable-variant "unallocated" bucket. */
  finishedGoodsSumQuantity: number;
  /** stockBalanceQuantity - finishedGoodsSumQuantity. Zero (within EPSILON) means no drift. */
  drift: number;
  hasMismatch: boolean;
}

/**
 * Finished Goods Inventory module (FGI-013) — the reconciliation report
 * described in §4.5 point 4 / §4.7 of the implementation plan: "defense in
 * depth against a future coding mistake, not a tacit admission the design
 * above can drift under correct usage." For every (companyId, productId,
 * warehouseId) this company has at least one FinishedGoodsStockBalance row
 * for, compares the flat StockBalance total against the sum of every
 * FinishedGoodsStockBalance row under that same key — the two caches should
 * always agree exactly, by construction (§4.5 point 1), under correct
 * operation; this report is what catches it if a future code change ever
 * breaks that invariant.
 *
 * Read-only — this function never corrects a drift it finds (per §4.7, a
 * detected mismatch requires a human-reviewed correction, never an automatic
 * silent rewrite of either cache). Deliberately scoped to the computation
 * itself for this task — a scheduled job and a dedicated report screen are
 * later, separate concerns (Phase 5/6), not built here.
 */
export async function getFinishedGoodsReconciliationReport(companyId: string): Promise<FinishedGoodsReconciliationRow[]> {
  const grouped = await FinishedGoodsReconciliationRepository.groupByProductWarehouse(companyId);
  if (grouped.length === 0) return [];

  const productIds = Array.from(new Set(grouped.map((row) => row.productId)));
  const warehouseIds = Array.from(new Set(grouped.map((row) => row.warehouseId)));
  const stockBalances = await FinishedGoodsReconciliationRepository.findManyStockBalances(companyId, productIds, warehouseIds);

  const stockBalanceMap = new Map<string, number>();
  for (const row of stockBalances) {
    stockBalanceMap.set(`${row.productId}::${row.warehouseId}`, Number(row.quantityOnHand));
  }

  return grouped.map((row) => {
    const stockBalanceQuantity = stockBalanceMap.get(`${row.productId}::${row.warehouseId}`) ?? 0;
    const drift = stockBalanceQuantity - row.sumQuantityOnHand;
    return {
      productId: row.productId,
      warehouseId: row.warehouseId,
      stockBalanceQuantity,
      finishedGoodsSumQuantity: row.sumQuantityOnHand,
      drift,
      hasMismatch: Math.abs(drift) > EPSILON,
    };
  });
}
