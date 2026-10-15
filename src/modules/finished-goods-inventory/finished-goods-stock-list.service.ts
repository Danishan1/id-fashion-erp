import { StockStatus, type Prisma } from "@prisma/client";
import type { ListQuery } from "@/lib/list-query";
import { FinishedGoodsStockListRepository } from "./finished-goods-stock-list.repository";

export interface FinishedGoodsStockListFilters {
  productId?: string;
  colorId?: string;
  sizeId?: string;
  warehouseId?: string;
  warehouseLocationId?: string;
}

/**
 * Finished Goods Inventory module (FGI-051) — the Stock List's own read,
 * straight off FinishedGoodsStockBalance (every filterable dimension —
 * variant, location, stock status — already lives as a real column on this
 * one table, unlike the raw-material Stock Balances sibling, which has to
 * derive its own location breakdown from the ledger because StockBalance
 * itself has no location dimension at all). Never touches
 * InventoryTransaction, matching every FGI-05x task's own common acceptance
 * criterion.
 *
 * Deliberately does NOT offer a "Lot" filter, despite §8's own FGI-051 task
 * description listing one — found and flagged before building (not silently
 * dropped): FinishedGoodsStockBalance has no lotId column at all (confirmed
 * by reading the schema), matching this plan's own already-stated design
 * decision that Finished-Goods stock is pooled at (productId, warehouseId)
 * with no lot dimension on the consumption side. Lot traceability for a
 * specific receipt event belongs to FGI-053's own Receipts screen
 * (FinishedGoodsReceipt DOES carry a real lotId), not this list.
 */
export async function listFinishedGoodsStockBalances(companyId: string, query: ListQuery, filters: FinishedGoodsStockListFilters = {}) {
  const where: Prisma.FinishedGoodsStockBalanceWhereInput = {
    companyId,
    ...(query.search
      ? {
          product: {
            OR: [
              { styleName: { contains: query.search, mode: "insensitive" as const } },
              { styleCode: { contains: query.search, mode: "insensitive" as const } },
            ],
          },
        }
      : {}),
    ...(filters.productId ? { productId: filters.productId } : {}),
    ...(filters.colorId || filters.sizeId
      ? {
          productVariant: {
            ...(filters.colorId ? { colorId: filters.colorId } : {}),
            ...(filters.sizeId ? { sizeId: filters.sizeId } : {}),
          },
        }
      : {}),
    ...(filters.warehouseId ? { warehouseId: filters.warehouseId } : {}),
    ...(filters.warehouseLocationId ? { warehouseLocationId: filters.warehouseLocationId } : {}),
    // Status is only ever trusted after validating it against the real
    // runtime enum object — the same "server validates, never trusts the
    // raw query param" discipline list-query.ts's own doc comment requires
    // of every caller of its generic `?status=` field.
    ...(query.status && (Object.values(StockStatus) as string[]).includes(query.status) ? { stockStatus: query.status as StockStatus } : {}),
  };

  const [rows, totalCount] = await Promise.all([
    FinishedGoodsStockListRepository.findMany(where, {
      orderBy: { [query.sortBy]: query.sortOrder } as Prisma.FinishedGoodsStockBalanceOrderByWithRelationInput,
      skip: query.skip,
      take: query.take,
    }),
    FinishedGoodsStockListRepository.count(where),
  ]);

  return { data: rows, totalCount };
}
