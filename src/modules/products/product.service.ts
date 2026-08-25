import type { Prisma } from "@prisma/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { advanceMasterCodeSequence } from "@/core/numbering/DocumentNumberingService";
import type { ListQuery } from "@/lib/list-query";
import type {
  GenerateVariantsInput,
  MaterialInput,
  MaterialUpdateInput,
  ProductInput,
  ProductUpdateInput,
} from "./product.schema";
import { ProductRepository, ProductVariantRepository } from "./product.repository";

interface ActorContext {
  companyId: string;
  userId: string;
}

export interface ProductListFilters {
  categoryId?: string;
  seasonId?: string;
  brandId?: string;
  productTypeId?: string;
  productFittingId?: string;
  isActive?: boolean;
}

export async function listProducts(companyId: string, query: ListQuery, filters: ProductListFilters = {}) {
  const where: Prisma.ProductWhereInput = {
    companyId,
    itemType: "STYLE" as const,
    deletedAt: null,
    ...(query.search
      ? {
          OR: [
            { styleName: { contains: query.search, mode: "insensitive" as const } },
            { styleCode: { contains: query.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.seasonId ? { seasonId: filters.seasonId } : {}),
    ...(filters.brandId ? { brandId: filters.brandId } : {}),
    ...(filters.productTypeId ? { productTypeId: filters.productTypeId } : {}),
    ...(filters.productFittingId ? { productFittingId: filters.productFittingId } : {}),
    ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
  };

  const [data, totalCount] = await Promise.all([
    ProductRepository.findManyStyles(where, { orderBy: { [query.sortBy]: query.sortOrder }, skip: query.skip, take: query.take }),
    ProductRepository.count(where),
  ]);

  return { data, totalCount };
}

export async function getProductById(companyId: string, id: string) {
  const product = await ProductRepository.findStyleById(companyId, id);
  if (!product) throw new BusinessRuleError("NOT_FOUND", "Style not found.", { id });
  return product;
}

function toData(input: ProductInput) {
  return {
    itemType: "STYLE" as const,
    styleCode: input.styleCode,
    styleName: input.styleName,
    designNumber: input.designNumber || null,
    categoryId: input.categoryId || null,
    seasonId: input.seasonId || null,
    brandId: input.brandId || null,
    productTypeId: input.productTypeId || null,
    productFittingId: input.productFittingId || null,
    gender: input.gender || null,
    description: input.description || null,
    hsnSacCode: input.hsnSacCode || null,
    customerId: input.customerId || null,
    isActive: input.isActive,
  };
}

function toMaterialData(input: MaterialInput) {
  return {
    itemType: "RAW_MATERIAL" as const,
    styleCode: input.styleCode,
    styleName: input.styleName,
    materialCategory: input.materialCategory,
    baseUomId: input.baseUomId || null,
    defaultSupplierId: input.defaultSupplierId || null,
    reorderLevel: input.reorderLevel ?? null,
    unitCost: input.unitCost ?? null,
    description: input.description || null,
    hsnSacCode: input.hsnSacCode || null,
    isActive: input.isActive,
  };
}

/** Only includes keys actually present in a partial PATCH body — omitted fields are left untouched in the DB. */
function toUpdateData(input: ProductUpdateInput): Prisma.ProductUncheckedUpdateInput {
  const data: Prisma.ProductUncheckedUpdateInput = {};
  if (input.styleCode !== undefined) data.styleCode = input.styleCode;
  if (input.styleName !== undefined) data.styleName = input.styleName;
  if (input.designNumber !== undefined) data.designNumber = input.designNumber || null;
  if (input.categoryId !== undefined) data.categoryId = input.categoryId || null;
  if (input.seasonId !== undefined) data.seasonId = input.seasonId || null;
  if (input.brandId !== undefined) data.brandId = input.brandId || null;
  if (input.productTypeId !== undefined) data.productTypeId = input.productTypeId || null;
  if (input.productFittingId !== undefined) data.productFittingId = input.productFittingId || null;
  if (input.gender !== undefined) data.gender = input.gender || null;
  if (input.description !== undefined) data.description = input.description || null;
  if (input.hsnSacCode !== undefined) data.hsnSacCode = input.hsnSacCode || null;
  if (input.customerId !== undefined) data.customerId = input.customerId || null;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  return data;
}

/** Only includes keys actually present in a partial PATCH body — omitted fields are left untouched in the DB. */
function toMaterialUpdateData(input: MaterialUpdateInput): Prisma.ProductUncheckedUpdateInput {
  const data: Prisma.ProductUncheckedUpdateInput = {};
  if (input.styleCode !== undefined) data.styleCode = input.styleCode;
  if (input.styleName !== undefined) data.styleName = input.styleName;
  if (input.materialCategory !== undefined) data.materialCategory = input.materialCategory;
  if (input.baseUomId !== undefined) data.baseUomId = input.baseUomId || null;
  if (input.defaultSupplierId !== undefined) data.defaultSupplierId = input.defaultSupplierId || null;
  if (input.reorderLevel !== undefined) data.reorderLevel = input.reorderLevel ?? null;
  if (input.unitCost !== undefined) data.unitCost = input.unitCost ?? null;
  if (input.description !== undefined) data.description = input.description || null;
  if (input.hsnSacCode !== undefined) data.hsnSacCode = input.hsnSacCode || null;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  return data;
}

export async function createProduct(actor: ActorContext, input: ProductInput) {
  const existing = await ProductRepository.findByStyleCode(actor.companyId, input.styleCode);
  if (existing) {
    throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Style code "${input.styleCode}" is already in use.`);
  }

  const product = await ProductRepository.create({ companyId: actor.companyId, ...toData(input) });

  await advanceMasterCodeSequence(actor.companyId, "STYLE");

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "products",
    recordId: product.id,
    action: "CREATE",
    newValues: product,
  });

  return product;
}

export async function updateProduct(actor: ActorContext, id: string, input: ProductUpdateInput) {
  const before = await getProductById(actor.companyId, id);

  if (input.styleCode !== undefined && input.styleCode !== before.styleCode) {
    const codeInUse = await ProductRepository.findByStyleCode(actor.companyId, input.styleCode, id);
    if (codeInUse) {
      throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Style code "${input.styleCode}" is already in use.`);
    }
  }

  const updated = await ProductRepository.update(id, toUpdateData(input));

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "products",
    recordId: id,
    action: "UPDATE",
    oldValues: before,
    newValues: updated,
  });

  return updated;
}

export async function setProductActiveStatus(actor: ActorContext, id: string, isActive: boolean) {
  const before = await ProductRepository.findAnyById(actor.companyId, id);
  if (!before) throw new BusinessRuleError("NOT_FOUND", "Record not found.", { id });

  const updated = await ProductRepository.update(id, { isActive });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "products",
    recordId: id,
    action: "UPDATE",
    oldValues: before,
    newValues: updated,
  });

  return updated;
}

export async function listMaterials(companyId: string, query: ListQuery) {
  const where = {
    companyId,
    itemType: "RAW_MATERIAL" as const,
    deletedAt: null,
    ...(query.search
      ? {
          OR: [
            { styleName: { contains: query.search, mode: "insensitive" as const } },
            { styleCode: { contains: query.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [data, totalCount] = await Promise.all([
    ProductRepository.findManyMaterials(where, {
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
    }),
    ProductRepository.count(where),
  ]);

  return { data, totalCount };
}

export async function getMaterialById(companyId: string, id: string) {
  const material = await ProductRepository.findMaterialById(companyId, id);
  if (!material) throw new BusinessRuleError("NOT_FOUND", "Material not found.", { id });
  return material;
}

export async function createMaterial(actor: ActorContext, input: MaterialInput) {
  const existing = await ProductRepository.findByStyleCode(actor.companyId, input.styleCode);
  if (existing) {
    throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Item code "${input.styleCode}" is already in use.`);
  }

  const material = await ProductRepository.create({ companyId: actor.companyId, ...toMaterialData(input) });

  await advanceMasterCodeSequence(actor.companyId, "MATERIAL");

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "products",
    recordId: material.id,
    action: "CREATE",
    newValues: material,
  });

  return material;
}

export async function updateMaterial(actor: ActorContext, id: string, input: MaterialUpdateInput) {
  const before = await getMaterialById(actor.companyId, id);

  if (input.styleCode !== undefined && input.styleCode !== before.styleCode) {
    const codeInUse = await ProductRepository.findByStyleCode(actor.companyId, input.styleCode, id);
    if (codeInUse) {
      throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Item code "${input.styleCode}" is already in use.`);
    }
  }

  const updated = await ProductRepository.update(id, toMaterialUpdateData(input));

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "products",
    recordId: id,
    action: "UPDATE",
    oldValues: before,
    newValues: updated,
  });

  return updated;
}

export async function generateVariants(actor: ActorContext, productId: string, input: GenerateVariantsInput) {
  const product = await getProductById(actor.companyId, productId);

  const [colors, sizes] = await Promise.all([
    ProductVariantRepository.findColorsByIds(actor.companyId, input.colorIds),
    ProductVariantRepository.findSizesByIds(actor.companyId, input.sizeIds),
  ]);

  // A deactivated master shouldn't be usable in a new transaction — the same
  // "inactive masters can't be picked for new business" pattern already
  // enforced elsewhere (e.g. Expense's COGS/inactive-account exclusion).
  // Rejecting outright, rather than silently skipping the inactive ones,
  // avoids silently generating fewer variants than the caller asked for.
  const inactiveColors = colors.filter((c) => !c.isActive);
  const inactiveSizes = sizes.filter((s) => !s.isActive);
  if (inactiveColors.length > 0 || inactiveSizes.length > 0) {
    const names = [...inactiveColors.map((c) => c.name), ...inactiveSizes.map((s) => s.name)];
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      `Cannot generate variants using inactive master(s): ${names.join(", ")}.`,
      { inactiveColorIds: inactiveColors.map((c) => c.id), inactiveSizeIds: inactiveSizes.map((s) => s.id) }
    );
  }

  const existingKeys = await ProductVariantRepository.findExistingKeys(productId);

  const toCreate = [];
  for (const color of colors) {
    for (const size of sizes) {
      const key = `${color.id}:${size.id}`;
      if (existingKeys.has(key)) continue;
      toCreate.push({
        productId,
        colorId: color.id,
        sizeId: size.id,
        skuCode: `${product.styleCode}-${color.code}-${size.code}`,
      });
    }
  }

  if (toCreate.length === 0) {
    return { created: 0 };
  }

  await ProductVariantRepository.createMany(toCreate);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "product_variants",
    recordId: productId,
    action: "CREATE",
    newValues: { generated: toCreate.length },
  });

  return { created: toCreate.length };
}
