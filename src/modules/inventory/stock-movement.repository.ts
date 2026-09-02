import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

const DETAIL_INCLUDE = {
  warehouse: { select: { id: true, name: true, code: true } },
  toWarehouse: { select: { id: true, name: true, code: true } },
  supplier: { select: { id: true, name: true, code: true } },
  performedBy: { select: { id: true, fullName: true } },
  items: {
    include: {
      product: { select: { id: true, styleName: true, styleCode: true, materialCategory: true } },
      uom: { select: { id: true, code: true } },
      warehouseLocation: { select: { id: true, code: true, materialCategory: true } },
    },
  },
} satisfies Prisma.StockMovementInclude;

export const StockMovementRepository = {
  createWithItems: (
    tx: Prisma.TransactionClient,
    header: Omit<Prisma.StockMovementUncheckedCreateInput, "items">,
    items: Omit<Prisma.StockMovementItemUncheckedCreateInput, "stockMovementId">[]
  ) =>
    tx.stockMovement.create({
      data: { ...header, items: { create: items } },
      include: DETAIL_INCLUDE,
    }),

  findByIdWithDetails: (companyId: string, id: string) =>
    prisma.stockMovement.findFirst({ where: { id, companyId }, include: DETAIL_INCLUDE }),

  /** CF-5 idempotent-replay lookup — same include shape as createWithItems's own return value. */
  findByIdempotencyKey: (companyId: string, idempotencyKey: string) =>
    prisma.stockMovement.findUnique({
      where: { companyId_idempotencyKey: { companyId, idempotencyKey } },
      include: DETAIL_INCLUDE,
    }),

  findMany: (where: Prisma.StockMovementWhereInput, args: Omit<Prisma.StockMovementFindManyArgs, "where">) =>
    prisma.stockMovement.findMany({
      where,
      include: {
        warehouse: { select: { id: true, name: true, code: true } },
        toWarehouse: { select: { id: true, name: true, code: true } },
        supplier: { select: { id: true, name: true } },
        performedBy: { select: { id: true, fullName: true } },
        _count: { select: { items: true } },
      },
      ...args,
    }),

  count: (where: Prisma.StockMovementWhereInput) => prisma.stockMovement.count({ where }),
};
