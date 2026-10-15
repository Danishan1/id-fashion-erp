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
export async function getStyleStockSummary(companyId: string, productId: string) {
  const product = await getProductById(companyId, productId);

  const [saleable, rejected, variants, warehouses] = await Promise.all([
    FinishedGoodsStyleStockDetailsRepository.sumSaleableForProduct(companyId, productId),
    FinishedGoodsStyleStockDetailsRepository.sumRejectedForProduct(companyId, productId),
    FinishedGoodsStyleStockDetailsRepository.countDistinctVariantsForProduct(companyId, productId),
    FinishedGoodsStyleStockDetailsRepository.countDistinctWarehousesForProduct(companyId, productId),
  ]);

  return {
    product: { id: product.id, styleCode: product.styleCode, styleName: product.styleName },
    saleableQuantity: Number(saleable._sum.quantityOnHand ?? 0),
    rejectedQuantity: Number(rejected._sum.quantityOnHand ?? 0),
    distinctVariantCount: variants.length,
    distinctWarehouseCount: warehouses.length,
  };
}
