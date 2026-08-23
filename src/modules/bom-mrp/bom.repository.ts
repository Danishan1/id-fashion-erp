import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

const ITEMS_INCLUDE = {
  material: {
    select: {
      id: true,
      styleName: true,
      styleCode: true,
      baseUomId: true,
      baseUom: { select: { id: true, name: true, code: true, baseUnitId: true, conversionFactor: true } },
      defaultSupplierId: true,
      unitCost: true,
    },
  },
  color: { select: { id: true, name: true, hexValue: true } },
  uom: { select: { id: true, code: true, name: true, baseUnitId: true, conversionFactor: true } },
} as const;

export const BomRepository = {
  findByProductId: (companyId: string, productId: string) =>
    prisma.bom.findFirst({
      where: { productId, companyId },
      include: { items: { include: ITEMS_INCLUDE } },
    }),

  /**
   * Full replace of a BOM's items — same reasoning as Sales/Purchase Orders'
   * replaceItems(): simplest correct way to apply an edit without
   * hand-diffing which lines changed. Creates the Bom row on first save
   * (it's 1:1 with the Style and doesn't exist until a BOM is authored).
   */
  upsertWithItems: (
    companyId: string,
    productId: string,
    notes: string | null,
    items: Array<{
      materialId: string;
      colorId: string | null;
      quantityPerUnit: number;
      wastagePercentage: number;
      uomId: string;
      notes: string | null;
    }>
  ) =>
    prisma.$transaction(async (tx) => {
      const existing = await tx.bom.findFirst({ where: { productId, companyId } });

      const bom = existing
        ? await tx.bom.update({ where: { id: existing.id }, data: { notes } })
        : await tx.bom.create({ data: { companyId, productId, notes } });

      if (existing) {
        await tx.bomItem.deleteMany({ where: { bomId: existing.id } });
      }

      if (items.length > 0) {
        await tx.bomItem.createMany({ data: items.map((item) => ({ ...item, bomId: bom.id })) });
      }

      return tx.bom.findFirstOrThrow({
        where: { id: bom.id },
        include: { items: { include: ITEMS_INCLUDE } },
      });
    }),

  countItemsByProductIds: (companyId: string, productIds: string[]) =>
    prisma.bom.findMany({
      where: { companyId, productId: { in: productIds } },
      select: { productId: true, _count: { select: { items: true } } },
    }),

  /** Used by the MRP calculator to look up several styles' BOMs at once. */
  findManyByProductIds: (companyId: string, productIds: string[]) =>
    prisma.bom.findMany({
      where: { companyId, productId: { in: productIds } },
      include: { items: { include: ITEMS_INCLUDE } },
    }),

  /** Styles with their BOM line count, for the /bom-mrp landing list. Takes
   * explicit orderBy/skip/take (not a spread `...args`) so Prisma's payload
   * type inference for the `include` below isn't erased by a generically
   * typed args object. */
  findStylesWithBomStatus: (
    where: Prisma.ProductWhereInput,
    args: { orderBy: Prisma.ProductOrderByWithRelationInput; skip: number; take: number }
  ) =>
    prisma.product.findMany({
      where,
      include: { bom: { select: { id: true, _count: { select: { items: true } } } } },
      orderBy: args.orderBy,
      skip: args.skip,
      take: args.take,
    }),

  countStyles: (where: Prisma.ProductWhereInput) => prisma.product.count({ where }),
};
