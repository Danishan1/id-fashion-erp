import { getProductById } from "@/modules/products/product.service";
import { FinishedGoodsStyleStockDetailsRepository } from "./finished-goods-style-stock-details.repository";

/**
 * Finished Goods Inventory module (FGI-052) — a per-style "Stock Details"
 * summary (Total Saleable, Total Rejected, Variants Tracked, Warehouses),
 * sitting on top of FGI-051's own already-built/verified row-level list:
 * this screen's own full breakdown table is just FGI-051's existing
 * `/api/v1/finished-goods-inventory/stock-list?productId=...` endpoint,
 * reused unchanged with the style fixed — this function supplies only the
 * four summary numbers FGI-051's own list view has no reason to compute.
 *
 * Reads **exclusively** from `FinishedGoodsStockBalance` — never the
 * `InventoryTransaction` ledger at request time — the common acceptance
 * criterion shared by every FGI-05x task.
 *
 * `getProductById` already enforces company-scoping and restricts to real
 * Styles (`itemType: STYLE`), throwing `NOT_FOUND` otherwise — reused as-is
 * rather than re-implementing a second company-scoped product lookup.
 */
/**
 * Process-flow clarity fix (2026-10-16), spec §2: the "100 ordered / 150
 * packed" example — once a line's own ordered quantity has been produced and
 * dispatched, any further genuine Packing output for that style becomes
 * general, unallocated FG stock rather than vanishing or double-counting.
 * Derived live from real, already-existing data — no new table, no new
 * write, nothing stored — the same "derive, never persist a figure that can
 * drift" discipline this project already applies everywhere else.
 *
 * `claim` mirrors dispatch.service.ts's own `remainingToDispatch()` exactly
 * (`max(0, orderedTotal - regularDispatchedQuantity)`) — kept as a small,
 * explicit duplicate here rather than exporting that private helper, since
 * this is a read-only reporting figure with no bearing on Dispatch's own
 * actual gating logic; if the two ever need to diverge, that's a sign this
 * duplication should finally be unified, not evidence it was wrong to begin
 * with. Extra Dispatch Quantity is deliberately excluded from `claim` — an
 * Extra piece is never counted toward a line's own ordered-quantity
 * fulfillment, so it never "frees up" stock for this purpose either; only
 * Regular dispatch reduces what a line still needs.
 */
function sumActiveOrderClaims(lines: Array<{ regularDispatchedQuantity: number; breakdown: Array<{ orderedQuantity: number }> }>): number {
  return lines.reduce((total, line) => {
    const orderedTotal = line.breakdown.reduce((sum, b) => sum + b.orderedQuantity, 0);
    const claim = Math.max(0, orderedTotal - line.regularDispatchedQuantity);
    return total + claim;
  }, 0);
}

export async function getStyleStockSummary(companyId: string, productId: string) {
  const product = await getProductById(companyId, productId);

  const [saleable, rejected, variants, warehouses, activeOrderLines] = await Promise.all([
    FinishedGoodsStyleStockDetailsRepository.sumSaleableForProduct(companyId, productId),
    FinishedGoodsStyleStockDetailsRepository.sumRejectedForProduct(companyId, productId),
    FinishedGoodsStyleStockDetailsRepository.countDistinctVariantsForProduct(companyId, productId),
    FinishedGoodsStyleStockDetailsRepository.countDistinctWarehousesForProduct(companyId, productId),
    FinishedGoodsStyleStockDetailsRepository.findActiveOrderLinesForProduct(companyId, productId),
  ]);

  const saleableQuantity = Number(saleable._sum.quantityOnHand ?? 0);
  const allocatedQuantity = sumActiveOrderClaims(activeOrderLines);

  return {
    product: { id: product.id, styleCode: product.styleCode, styleName: product.styleName },
    saleableQuantity,
    rejectedQuantity: Number(rejected._sum.quantityOnHand ?? 0),
    distinctVariantCount: variants.length,
    distinctWarehouseCount: warehouses.length,
    // Company-wide, not per-warehouse — a Sales Order line isn't tied to a
    // specific warehouse until a Dispatch against it actually picks one, so
    // "allocated"/"unallocated" can only be meaningfully computed at the
    // style level, same granularity as saleableQuantity's own company-wide
    // total above.
    allocatedQuantity,
    unallocatedQuantity: Math.max(0, saleableQuantity - allocatedQuantity),
  };
}
