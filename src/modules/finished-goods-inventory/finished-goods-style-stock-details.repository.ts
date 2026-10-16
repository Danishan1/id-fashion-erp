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
   *
   * `id` is selected (2026-10-16, Phase 1 correction) so the no-variant-style
   * formula can look up each line's own real Packing-stage production via
   * getSalesOrderItemProductionSummary — see finished-goods-style-stock-
   * details.service.ts's own doc comment for why this is required by the
   * confirmed business rule ("only actual completed Packing quantity may
   * claim stock") and why it's deliberately scoped to no-variant styles only.
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
      select: { id: true, regularDispatchedQuantity: true, breakdown: { select: { orderedQuantity: true } } },
    }),

  /**
   * Every ACTIVE FinishedGoodsReservation whose SalesOrderLine has at least
   * one item for this style — process-flow Phase 1 correction (2026-10-16).
   * Deliberately NOT scoped to "lines belonging to a currently-active order"
   * the way findActiveOrderLinesForProduct above is: a reservation can
   * legitimately remain ACTIVE even after its own order's status changes
   * (releasing on cancel is Phase 3's own, separately-scoped work — see the
   * corrected Phase 0 plan), so scoping this query to active-order-only
   * would silently hide a real, still-committed reservation from a since-
   * cancelled order rather than honestly reflecting it. Summed in the
   * service layer as reservedQuantity - consumedQuantity per row, never
   * re-aggregated here, so a caller can see the real row-level data if ever
   * needed for a future, richer per-variant breakdown.
   */
  findActiveReservationsForProduct: (companyId: string, productId: string) =>
    prisma.finishedGoodsReservation.findMany({
      where: {
        companyId,
        status: "ACTIVE",
        salesOrderLine: { items: { some: { productId } } },
      },
      select: { productVariantId: true, reservedQuantity: true, consumedQuantity: true },
    }),
};
