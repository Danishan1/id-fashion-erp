import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

export const ProductRepository = {
  findManyStyles: (where: Prisma.ProductWhereInput, args: Omit<Prisma.ProductFindManyArgs, "where">) =>
    prisma.product.findMany({
      where,
      include: {
        category: true,
        season: true,
        brand: true,
        productType: true,
        productFitting: true,
        // The "Designs" count shown on the Styles list is scoped to
        // APPROVED samples only, matching the Designs page's own listing —
        // a style's Designs badge should reflect real, confirmed designs,
        // not every draft/rejected sample ever raised against it.
        _count: { select: { variants: true, sampleRequests: { where: { status: "APPROVED" } } } },
      },
      ...args,
    }),

  findManyMaterials: (where: Prisma.ProductWhereInput, args: Omit<Prisma.ProductFindManyArgs, "where">) =>
    prisma.product.findMany({ where, include: { baseUom: true, defaultSupplier: true }, ...args }),

  count: (where: Prisma.ProductWhereInput) => prisma.product.count({ where }),

  /** Finished Goods Inventory module (FGI-014) -- a batch id-to-itemType
   * lookup, scoped to this company, used by Stock Movement's real
   * item-type-family assertion (the service-layer half of the two-layer
   * defense -- Zod has no DB access, so this is where a forged/wrong
   * itemFamily actually gets caught). */
  findManyItemTypesByIds: (companyId: string, ids: string[]) =>
    prisma.product.findMany({ where: { id: { in: ids }, companyId }, select: { id: true, itemType: true } }),

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

  /** Called just before deleting an attachment — if it's currently a style's
   * designated main image, clears the pointer first so it never dangles. */
  clearMainImageIfMatches: (companyId: string, attachmentId: string) =>
    prisma.product.updateMany({ where: { companyId, mainImageAttachmentId: attachmentId }, data: { mainImageAttachmentId: null } }),
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

  /** Finished Goods Inventory module (FGI-014) -- a batch lookup used to
   * confirm each Stock Movement line's own productVariantId genuinely
   * belongs to that same line's productId, not a different style's variant. */
  findManyByIds: (ids: string[]) =>
    prisma.productVariant.findMany({ where: { id: { in: ids } }, select: { id: true, productId: true } }),

  create: (data: Prisma.ProductVariantUncheckedCreateInput) => prisma.productVariant.create({ data }),

  setActiveStatus: (id: string, isActive: boolean) => prisma.productVariant.update({ where: { id }, data: { isActive } }),
};
