import type { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";

/**
 * Which Material Requests count as "this production order's material".
 *
 * A request can reach the store two ways: raised from the production order
 * itself (productionOrderId set), or raised earlier from BOM/MRP against the
 * order's Sales Order (salesOrderId set, productionOrderId null). Both are real
 * requests for the same goods, so both count. A Sales-Order-level request that
 * was later tied to a different production order is excluded by the
 * `productionOrderId: null` condition.
 *
 * Known limit: if one Sales Order has several production orders using the same
 * material, a Sales-Order-level request is visible to each of them. Raising the
 * request from the production order avoids that.
 */
export async function materialRequestScopeForOrder(
  companyId: string,
  productionOrderId: string,
  salesOrderItemId: string | null
): Promise<Prisma.MaterialRequestWhereInput> {
  const salesOrderId = salesOrderItemId
    ? (await prisma.salesOrderItem.findUnique({ where: { id: salesOrderItemId }, select: { salesOrderId: true } }))?.salesOrderId ?? null
    : null;

  return {
    companyId,
    OR: [
      { productionOrderId },
      ...(salesOrderId ? [{ productionOrderId: null, salesOrderId }] : []),
    ],
  };
}
