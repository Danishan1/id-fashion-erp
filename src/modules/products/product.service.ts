import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { advanceMasterCodeSequence } from "@/core/numbering/DocumentNumberingService";
import type { ListQuery } from "@/lib/list-query";
import type { GenerateVariantsInput, MaterialInput, ProductInput } from "./product.schema";
import { ProductRepository, ProductVariantRepository } from "./product.repository";

interface ActorContext {
  companyId: string;
  userId: string;
}

export async function listProducts(companyId: string, query: ListQuery) {
  const where = {
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
    categoryId: input.categoryId || null,
    seasonId: input.seasonId || null,
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

export async function updateProduct(actor: ActorContext, id: string, input: ProductInput) {
  const before = await getProductById(actor.companyId, id);

  if (input.styleCode !== before.styleCode) {
    const codeInUse = await ProductRepository.findByStyleCode(actor.companyId, input.styleCode, id);
    if (codeInUse) {
      throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Style code "${input.styleCode}" is already in use.`);
    }
  }

  const updated = await ProductRepository.update(id, toData(input));

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

export async function updateMaterial(actor: ActorContext, id: string, input: MaterialInput) {
  const before = await getMaterialById(actor.companyId, id);

  if (input.styleCode !== before.styleCode) {
    const codeInUse = await ProductRepository.findByStyleCode(actor.companyId, input.styleCode, id);
    if (codeInUse) {
      throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Item code "${input.styleCode}" is already in use.`);
    }
  }

  const updated = await ProductRepository.update(id, toMaterialData(input));

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
