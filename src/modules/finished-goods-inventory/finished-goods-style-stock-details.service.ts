import type { Prisma } from "@prisma/client";
import { getProductById } from "@/modules/products/product.service";
import { ProductVariantRepository } from "@/modules/products/product.repository";
import { getSalesOrderItemProductionSummary } from "@/modules/production/production-progress.service";
import { round2 } from "@/lib/money";
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
 * Process-flow clarity fix (2026-10-16), corrected per Phase 0's confirmed
 * business rule: "only actual completed Packing quantity may claim stock for
 * a Sales Order — unproduced/unpacked order quantity must not reserve or
 * hide existing Finished Goods stock." The ORIGINAL formula here
 * (`max(0, orderedTotal - regularDispatchedQuantity)`) claimed the full
 * ordered amount regardless of production status — wrong per that rule (a
 * freshly-confirmed order with zero production would have hidden any
 * pre-existing surplus stock of its own style). This no-variant-style
 * formula additionally caps each line's claim at that line's own REAL,
 * Packing-stage-only production (`getSalesOrderItemProductionSummary`'s
 * `totalProduced`, already verified scoped to `ProductionStage.isFinal`
 * JobOrders only — never re-derived here), so an order with no production
 * yet correctly claims nothing.
 *
 * Scoped to no-variant styles ONLY — `FinishedGoodsReservation.
 * productVariantId` is a required column, so a variant-bearing style uses
 * the real reservation lifecycle instead (see getStyleStockSummary below);
 * inventing a pseudo-variant to let a no-variant style use that same table
 * was explicitly ruled out (Phase 0 corrected plan §B.1).
 *
 * Extra Dispatch Quantity is deliberately excluded from `claim`, same as the
 * original formula — an Extra piece is never counted toward a line's own
 * ordered-quantity fulfillment, so it never "frees up" stock for this
 * purpose either; only Regular dispatch reduces what a line still needs.
 *
 * `productions[i]` is fetched once per active line via `Promise.all`
 * (concurrent, not sequential) — the same N-queries-per-reporting-call
 * tradeoff already accepted in dispatch.service.ts's own
 * assertPackingProducedForLines for the identical underlying call, justified
 * the same way here: this is a reporting page, not a hot path.
 */
async function sumNoVariantStyleOrderClaims(
  companyId: string,
  lines: Array<{ id: string; regularDispatchedQuantity: number; breakdown: Array<{ orderedQuantity: number }> }>
): Promise<number> {
  const productions = await Promise.all(lines.map((line) => getSalesOrderItemProductionSummary(companyId, line.id)));
  return lines.reduce((total, line, i) => {
    const orderedTotal = line.breakdown.reduce((sum, b) => sum + b.orderedQuantity, 0);
    const claim = Math.max(0, Math.min(orderedTotal, productions[i].totalProduced) - line.regularDispatchedQuantity);
    return total + claim;
  }, 0);
}

/**
 * Variant-bearing styles: allocated quantity comes from the REAL, now-
 * correctly-populated (process-flow Phase 1) FinishedGoodsReservation
 * lifecycle — each row's own `reservedQuantity - consumedQuantity`, summed
 * across every ACTIVE reservation for this style, never re-derived from
 * SalesOrderItem fields directly (that approximation is what the no-variant
 * formula above still uses, for the one style type that genuinely has no
 * other option). A reservation can only ever exist for quantity that
 * actually completed Packing (see applyPackingCompletionReservationsInTx's
 * own doc comment) and is capped per exact variant — so this sum already
 * satisfies both the "only packed quantity claims stock" rule and the
 * "exact variant, never a style-level substitute" rule with no further
 * capping needed here.
 */
function sumActiveReservationClaims(reservations: Array<{ reservedQuantity: Prisma.Decimal; consumedQuantity: Prisma.Decimal }>): number {
  return reservations.reduce((total, r) => total + Math.max(0, Number(r.reservedQuantity) - Number(r.consumedQuantity)), 0);
}

export async function getStyleStockSummary(companyId: string, productId: string) {
  const product = await getProductById(companyId, productId);

  const [saleable, rejected, variants, warehouses, activeVariants, activeReservations, activeOrderLines] = await Promise.all([
    FinishedGoodsStyleStockDetailsRepository.sumSaleableForProduct(companyId, productId),
    FinishedGoodsStyleStockDetailsRepository.sumRejectedForProduct(companyId, productId),
    FinishedGoodsStyleStockDetailsRepository.countDistinctVariantsForProduct(companyId, productId),
    FinishedGoodsStyleStockDetailsRepository.countDistinctWarehousesForProduct(companyId, productId),
    ProductVariantRepository.findManyActiveByProductId(productId),
    FinishedGoodsStyleStockDetailsRepository.findActiveReservationsForProduct(companyId, productId),
    FinishedGoodsStyleStockDetailsRepository.findActiveOrderLinesForProduct(companyId, productId),
  ]);

  const saleableQuantity = Number(saleable._sum.quantityOnHand ?? 0);
  const hasConfiguredVariants = activeVariants.length > 0;
  const allocatedQuantity = round2(
    hasConfiguredVariants
      ? sumActiveReservationClaims(activeReservations)
      : await sumNoVariantStyleOrderClaims(companyId, activeOrderLines)
  );

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
    unallocatedQuantity: Math.max(0, round2(saleableQuantity - allocatedQuantity)),
  };
}
