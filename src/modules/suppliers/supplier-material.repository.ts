import { prisma } from "@/core/db/client";

const MATERIAL_SELECT = {
  id: true,
  styleCode: true,
  styleName: true,
  materialCategory: true,
  baseUom: { select: { code: true } },
} as const;

export const SupplierMaterialRepository = {
  findMany: (supplierId: string) =>
    prisma.supplierMaterial.findMany({
      where: { supplierId },
      include: { product: { select: MATERIAL_SELECT } },
      orderBy: { createdAt: "asc" },
    }),

  findLink: (supplierId: string, productId: string) => prisma.supplierMaterial.findUnique({ where: { supplierId_productId: { supplierId, productId } } }),

  create: (data: { companyId: string; supplierId: string; productId: string }) =>
    prisma.supplierMaterial.create({ data, include: { product: { select: MATERIAL_SELECT } } }),

  // skipDuplicates makes this safe to call with a mix of already-linked and
  // new material ids in one go — the multi-select "Add Selected" UI doesn't
  // need to pre-filter what's already linked before submitting.
  createMany: (rows: { companyId: string; supplierId: string; productId: string }[]) =>
    prisma.supplierMaterial.createMany({ data: rows, skipDuplicates: true }),

  delete: (id: string) => prisma.supplierMaterial.delete({ where: { id } }),

  findManyByProductIds: (companyId: string, productIds: string[]) =>
    prisma.product.findMany({ where: { id: { in: productIds }, companyId, itemType: "RAW_MATERIAL", deletedAt: null }, select: { id: true } }),
};

export const SupplierMaterialCategoryRepository = {
  findGranted: (supplierId: string) =>
    prisma.supplierMaterialCategory.findMany({ where: { supplierId }, select: { materialCategory: true } }),

  // Full replace, one transaction — same shape as RoleProductionStageAccess's
  // own replaceStageAccessInTx: an empty `categories` array means "supplies
  // no categories broadly" (not a no-op), matching that table's own
  // zero-rows-is-a-real-state contract.
  replaceInTx: (companyId: string, supplierId: string, categories: string[]) =>
    prisma.$transaction([
      prisma.supplierMaterialCategory.deleteMany({ where: { supplierId } }),
      prisma.supplierMaterialCategory.createMany({
        data: categories.map((materialCategory) => ({ companyId, supplierId, materialCategory: materialCategory as never })),
      }),
    ]),
};
