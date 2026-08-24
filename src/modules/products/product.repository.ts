import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

export const ProductRepository = {
  findManyStyles: (where: Prisma.ProductWhereInput, args: Omit<Prisma.ProductFindManyArgs, "where">) =>
    prisma.product.findMany({
      where,
      include: { category: true, season: true, brand: true, productType: true, productFitting: true, _count: { select: { variants: true } } },
      ...args,
    }),

  findManyMaterials: (where: Prisma.ProductWhereInput, args: Omit<Prisma.ProductFindManyArgs, "where">) =>
    prisma.product.findMany({ where, include: { baseUom: true, defaultSupplier: true }, ...args }),

  count: (where: Prisma.ProductWhereInput) => prisma.product.count({ where }),

  findStyleById: (companyId: string, id: string) =>
    prisma.product.findFirst({
      where: { id, companyId, itemType: "STYLE", deletedAt: null },
      include: {
        category: true,
        season: true,
        brand: true,
        productType: true,
        productFitting: true,
        variants: {
          include: { color: true, size: true },
          orderBy: [{ color: { name: "asc" } }, { size: { sortOrder: "asc" } }],
        },
      },
    }),

  findMaterialById: (companyId: string, id: string) =>
    prisma.product.findFirst({
      where: { id, companyId, itemType: "RAW_MATERIAL", deletedAt: null },
      include: { baseUom: true, defaultSupplier: true },
    }),

  findAnyById: (companyId: string, id: string) => prisma.product.findFirst({ where: { id, companyId, deletedAt: null } }),

  findByStyleCode: (companyId: string, styleCode: string, excludeId?: string) =>
    prisma.product.findFirst({
      where: { companyId, styleCode, deletedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
    }),

  create: (data: Prisma.ProductUncheckedCreateInput) => prisma.product.create({ data }),

  update: (id: string, data: Prisma.ProductUncheckedUpdateInput) => prisma.product.update({ where: { id }, data }),
};

export const ProductVariantRepository = {
  findColorsByIds: (companyId: string, colorIds: string[]) =>
    prisma.color.findMany({ where: { id: { in: colorIds }, companyId } }),

  findSizesByIds: (companyId: string, sizeIds: string[]) =>
    prisma.size.findMany({ where: { id: { in: sizeIds }, companyId } }),

  findExistingKeys: async (productId: string) => {
    const existing = await prisma.productVariant.findMany({ where: { productId }, select: { colorId: true, sizeId: true } });
    return new Set(existing.map((v) => `${v.colorId}:${v.sizeId}`));
  },

  createMany: (data: Prisma.ProductVariantCreateManyInput[]) =>
    prisma.productVariant.createMany({ data, skipDuplicates: true }),
};
