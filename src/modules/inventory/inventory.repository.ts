import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

export const InventoryTransactionRepository = {
  create: (tx: Prisma.TransactionClient, data: Prisma.InventoryTransactionUncheckedCreateInput) =>
    tx.inventoryTransaction.create({ data }),

  findMany: (
    where: Prisma.InventoryTransactionWhereInput,
    args: Omit<Prisma.InventoryTransactionFindManyArgs, "where">
  ) => prisma.inventoryTransaction.findMany({ where, ...args }),
};

export const StockBalanceRepository = {
  upsertIncrement: (
    tx: Prisma.TransactionClient,
    companyId: string,
    productId: string,
    warehouseId: string,
    deltaQuantity: number
  ) =>
    tx.stockBalance.upsert({
      where: { companyId_productId_warehouseId: { companyId, productId, warehouseId } },
      create: { companyId, productId, warehouseId, quantityOnHand: deltaQuantity },
      update: { quantityOnHand: { increment: deltaQuantity } },
    }),

  /** Single product+warehouse balance — used by Material Request's issue
   * action to check available stock at the specific warehouse it's issuing
   * from (unlike sumByProductIds, which is company-wide/warehouse-agnostic). */
  findOne: (companyId: string, productId: string, warehouseId: string) =>
    prisma.stockBalance.findUnique({
      where: { companyId_productId_warehouseId: { companyId, productId, warehouseId } },
    }),

  findMany: (where: Prisma.StockBalanceWhereInput, args: Omit<Prisma.StockBalanceFindManyArgs, "where">) =>
    prisma.stockBalance.findMany({
      where,
      include: {
        product: { select: { id: true, styleName: true, styleCode: true } },
        warehouse: { select: { id: true, name: true, code: true } },
      },
      ...args,
    }),

  count: (where: Prisma.StockBalanceWhereInput) => prisma.stockBalance.count({ where }),

  /** Company-wide sum across all warehouses per material — MRP planning
   * doesn't care which warehouse; per-warehouse allocation is Production's
   * (5C) job once a Production Order actually reserves stock. */
  sumByProductIds: (companyId: string, productIds: string[]) =>
    prisma.stockBalance.groupBy({
      by: ["productId"],
      where: { companyId, productId: { in: productIds } },
      _sum: { quantityOnHand: true },
    }),
};

/**
 * Scoped lookups the ledger engine uses for its own defensive
 * company-ownership check before writing — a shared low-level chokepoint is
 * exactly where a cheap check like this pays off across every future caller
 * (Production, Dispatch), not just this module's first caller (Goods Receipt).
 */
export const InventoryScopeRepository = {
  findProductCompanyId: (id: string) => prisma.product.findUnique({ where: { id }, select: { companyId: true } }),
  findWarehouseCompanyId: (id: string) => prisma.warehouse.findUnique({ where: { id }, select: { companyId: true } }),
};
