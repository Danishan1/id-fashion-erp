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

  /** Top N styleName/styleCode matches among this company's real Styles —
   * backs the Topbar Global Search's Products/Styles group. */
  searchTopStyles: (companyId: string, term: string, limit: number) =>
    prisma.product.findMany({
      where: {
        companyId,
        itemType: "STYLE",
        deletedAt: null,
        OR: [
          { styleName: { contains: term, mode: "insensitive" as const } },
          { styleCode: { contains: term, mode: "insensitive" as const } },
        ],
      },
      select: { id: true, styleName: true, styleCode: true },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),

  /** Same shape as searchTopStyles, scoped to Raw Materials instead — backs
   * the Topbar Global Search's Raw Materials group. */
  searchTopMaterials: (companyId: string, term: string, limit: number) =>
    prisma.product.findMany({
      where: {
        companyId,
        itemType: "RAW_MATERIAL",
        deletedAt: null,
        OR: [
          { styleName: { contains: term, mode: "insensitive" as const } },
          { styleCode: { contains: term, mode: "insensitive" as const } },
        ],
      },
      select: { id: true, styleName: true, styleCode: true },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),

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

  /** Case-insensitive duplicate-name check, scoped to raw materials only
   * (not the shared Style/Material `styleCode` namespace) -- a Style and a
   * Material coincidentally sharing a name is fine, two materials sharing
   * one isn't. */
  findMaterialByName: (companyId: string, styleName: string, excludeId?: string) =>
    prisma.product.findFirst({
      where: {
        companyId,
        itemType: "RAW_MATERIAL",
        styleName: { equals: styleName, mode: "insensitive" },
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
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

  /** Global uniqueness (ProductVariant.skuCode has no companyId scoping) --
   * used by the Bulk Master Data Import portal's explicit-SKU variant rows. */
  findBySkuCode: (skuCode: string) => prisma.productVariant.findUnique({ where: { skuCode } }),

  findByProductColorSize: (productId: string, colorId: string, sizeId: string) =>
    prisma.productVariant.findUnique({ where: { productId_colorId_sizeId: { productId, colorId, sizeId } } }),

  create: (data: Prisma.ProductVariantUncheckedCreateInput) => prisma.productVariant.create({ data }),

  setActiveStatus: (id: string, isActive: boolean) => prisma.productVariant.update({ where: { id }, data: { isActive } }),
};
