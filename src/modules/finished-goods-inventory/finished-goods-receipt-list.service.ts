import type { Prisma } from "@prisma/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { ListQuery } from "@/lib/list-query";
import { FinishedGoodsReceiptListRepository } from "./finished-goods-receipt-list.repository";

export interface FinishedGoodsReceiptListFilters {
  productId?: string;
  warehouseId?: string;
}

/**
 * Finished Goods Inventory module (FGI-053) — read-only list/detail over the
 * existing `FinishedGoodsReceipt`/`FinishedGoodsReceiptItem` tables, both
 * already written by `createFinishedGoodsReceiptInTx()` (FGI-012, wired into
 * production's own `completeAtFinalStageInTx()` since FGI-021) — this task
 * adds no new write path, only the list/detail reads a UI needs. A separate
 * repository file from the existing `finished-goods-receipt.repository.ts`
 * (which owns the create action's own transactional write + the internal
 * `findByLotId` lot-traceability helper), matching this module's own
 * established "one repository per UI task" convention (e.g. FGI-050's
 * dashboard repository and FGI-051's stock-list repository both query
 * `FinishedGoodsStockBalance` but live in separate files).
 *
 * Every FinishedGoodsReceipt row is an immutable historical fact (posted
 * once, at production-completion time, never edited or reversed) — so,
 * unlike FGI-051/FGI-052, there is no `InventoryTransaction`-vs-cache
 * distinction to worry about here: this table already IS the receipt
 * document itself, not a derived cache.
 */
export async function listFinishedGoodsReceipts(companyId: string, query: ListQuery, filters: FinishedGoodsReceiptListFilters = {}) {
  const where: Prisma.FinishedGoodsReceiptWhereInput = {
    companyId,
    ...(query.search
      ? {
          OR: [
            { receiptNumber: { contains: query.search, mode: "insensitive" as const } },
            { product: { styleName: { contains: query.search, mode: "insensitive" as const } } },
            { product: { styleCode: { contains: query.search, mode: "insensitive" as const } } },
          ],
        }
      : {}),
    ...(filters.productId ? { productId: filters.productId } : {}),
    ...(filters.warehouseId ? { warehouseId: filters.warehouseId } : {}),
  };

  const [rows, totalCount] = await Promise.all([
    FinishedGoodsReceiptListRepository.findMany(where, {
      orderBy: { [query.sortBy]: query.sortOrder } as Prisma.FinishedGoodsReceiptOrderByWithRelationInput,
      skip: query.skip,
      take: query.take,
    }),
    FinishedGoodsReceiptListRepository.count(where),
  ]);

  return { data: rows, totalCount };
}

export async function getFinishedGoodsReceiptById(companyId: string, id: string) {
  const receipt = await FinishedGoodsReceiptListRepository.findById(companyId, id);
  if (!receipt) throw new BusinessRuleError("NOT_FOUND", "Finished Goods receipt not found.", { id });
  return receipt;
}
