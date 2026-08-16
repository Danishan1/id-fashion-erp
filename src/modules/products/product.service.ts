import { prisma } from "@/core/db/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { ListQuery } from "@/lib/list-query";
import type { GenerateVariantsInput, ProductInput } from "./product.schema";

interface ActorContext {
  companyId: string;
  userId: string;
}

export async function listProducts(companyId: string, query: ListQuery) {
  const where = {
    companyId,
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
    prisma.product.findMany({
      where,
      include: { _count: { select: { variants: true } } },
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
    }),
    prisma.product.count({ where }),
  ]);

  return { data, totalCount };
}

export async function getProductById(companyId: string, id: string) {
  const product = await prisma.product.findFirst({
    where: { id, companyId, deletedAt: null },
    include: {
      variants: {
        include: { color: true, size: true },
        orderBy: [{ color: { name: "asc" } }, { size: { sortOrder: "asc" } }],
      },
    },
  });
  if (!product) throw new BusinessRuleError("NOT_FOUND", "Style not found.", { id });
  return product;
}

function toData(input: ProductInput) {
  return {
    styleCode: input.styleCode,
    styleName: input.styleName,
    category: input.category || null,
    season: input.season || null,
    gender: input.gender || null,
    description: input.description || null,
    hsnSacCode: input.hsnSacCode || null,
    customerId: input.customerId || null,
    isActive: input.isActive,
  };
}

export async function createProduct(actor: ActorContext, input: ProductInput) {
  const existing = await prisma.product.findFirst({
    where: { companyId: actor.companyId, styleCode: input.styleCode, deletedAt: null },
  });
  if (existing) {
    throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Style code "${input.styleCode}" is already in use.`);
  }

  const product = await prisma.product.create({ data: { companyId: actor.companyId, ...toData(input) } });

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
    const codeInUse = await prisma.product.findFirst({
      where: { companyId: actor.companyId, styleCode: input.styleCode, deletedAt: null, id: { not: id } },
    });
    if (codeInUse) {
      throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Style code "${input.styleCode}" is already in use.`);
    }
  }

  const updated = await prisma.product.update({ where: { id }, data: toData(input) });

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
    prisma.color.findMany({ where: { id: { in: input.colorIds }, companyId: actor.companyId } }),
    prisma.size.findMany({ where: { id: { in: input.sizeIds }, companyId: actor.companyId } }),
  ]);

  const existing = await prisma.productVariant.findMany({
    where: { productId },
    select: { colorId: true, sizeId: true },
  });
  const existingKeys = new Set(existing.map((v) => `${v.colorId}:${v.sizeId}`));

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

  await prisma.productVariant.createMany({ data: toCreate, skipDuplicates: true });

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
