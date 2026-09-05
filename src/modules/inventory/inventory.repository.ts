import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

export const InventoryTransactionRepository = {
  create: (tx: Prisma.TransactionClient, data: Prisma.InventoryTransactionUncheckedCreateInput) =>
    tx.inventoryTransaction.create({ data }),

  findMany: (
    where: Prisma.InventoryTransactionWhereInput,
    args: Omit<Prisma.InventoryTransactionFindManyArgs, "where">
  ) => prisma.inventoryTransaction.findMany({ where, ...args }),

  /**
   * Real per-location net quantity for one product+warehouse — sums every
   * ledger entry's signed quantity grouped by warehouseLocationId (a
   * receipt/issue/transfer that never named a location is excluded from
   * this breakdown, since there's no location to attribute it to; it still
   * counts in StockBalance's own total, so the two can legitimately not sum
   * to the same figure). Replaces the earlier "most recent location" guess
   * (2026-09-05) with the real thing, per direct user feedback — a product
   * genuinely split across several locations now shows every one of them,
   * not just wherever it was last touched.
   */
  findLocationBreakdownForPair: async (companyId: string, productId: string, warehouseId: string) => {
    const grouped = await prisma.inventoryTransaction.groupBy({
      by: ["warehouseLocationId"],
      where: { companyId, productId, warehouseId, warehouseLocationId: { not: null } },
      _sum: { quantity: true },
    });
    const positiveLocationIds = grouped
      .filter((g) => Number(g._sum.quantity ?? 0) > 0.0001)
      .map((g) => g.warehouseLocationId)
      .filter((id): id is string => id !== null);
    if (positiveLocationIds.length === 0) return [];

    const locations = await prisma.warehouseLocation.findMany({
      where: { id: { in: positiveLocationIds } },
      select: { id: true, code: true, zone: true, rack: true, bin: true },
    });
    const locationById = new Map(locations.map((l) => [l.id, l]));

    return grouped
      .filter((g) => g.warehouseLocationId && locationById.has(g.warehouseLocationId))
      .map((g) => ({ ...locationById.get(g.warehouseLocationId!)!, quantity: Number(g._sum.quantity ?? 0) }))
      .sort((a, b) => a.code.localeCompare(b.code));
  },
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

  /**
   * Atomic floor guard for any stock decrement — the cap (a balance row must
   * already exist with at least `minimumRequiredBalance`) is expressed in the
   * WHERE clause, not read-then-written, so it's safe under concurrency: two
   * racing decrements against the same balance can't both succeed and drive
   * `quantityOnHand` negative. `count === 0` means either no balance row
   * exists yet (implicitly zero stock) or the existing balance is
   * insufficient — both are correctly rejected by the caller.
   */
  guardedDecrement: (
    tx: Prisma.TransactionClient,
    companyId: string,
    productId: string,
    warehouseId: string,
    decrementAmount: number,
    minimumRequiredBalance: number
  ) =>
    tx.stockBalance.updateMany({
      where: { companyId, productId, warehouseId, quantityOnHand: { gte: minimumRequiredBalance } },
      data: { quantityOnHand: { decrement: decrementAmount } },
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
        // baseUom included so the on-screen list can label a quantity with
        // its real unit (e.g. "509.144 MTR") instead of a bare, ambiguous
        // number — a material's own base UOM, not per-transaction (this
        // schema has no per-StockBalance unit column; every ledger write for
        // a given product is already converted to this same base UOM).
        product: { select: { id: true, styleName: true, styleCode: true, baseUom: { select: { code: true } } } },
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
