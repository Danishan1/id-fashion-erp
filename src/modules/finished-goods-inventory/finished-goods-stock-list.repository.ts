import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

export const FinishedGoodsStockListRepository = {
  findMany: (where: Prisma.FinishedGoodsStockBalanceWhereInput, args: { orderBy: Prisma.FinishedGoodsStockBalanceOrderByWithRelationInput; skip: number; take: number }) =>
    prisma.finishedGoodsStockBalance.findMany({
      where,
      include: {
        product: { select: { id: true, styleCode: true, styleName: true } },
        productVariant: { include: { color: true, size: true } },
        warehouse: { select: { id: true, code: true, name: true } },
        warehouseLocation: { select: { id: true, code: true } },
      },
      ...args,
    }),

  count: (where: Prisma.FinishedGoodsStockBalanceWhereInput) => prisma.finishedGoodsStockBalance.count({ where }),
};
