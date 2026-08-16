import { prisma } from "@/core/db/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { ListQuery } from "@/lib/list-query";
import type { SupplierInput } from "./supplier.schema";

interface ActorContext {
  companyId: string;
  userId: string;
}

export async function listSuppliers(companyId: string, query: ListQuery) {
  const where = {
    companyId,
    deletedAt: null,
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: "insensitive" as const } },
            { code: { contains: query.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [data, totalCount] = await Promise.all([
    prisma.supplier.findMany({
      where,
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
    }),
    prisma.supplier.count({ where }),
  ]);

  return { data, totalCount };
}

export async function getSupplierById(companyId: string, id: string) {
  const supplier = await prisma.supplier.findFirst({ where: { id, companyId, deletedAt: null } });
  if (!supplier) {
    throw new BusinessRuleError("NOT_FOUND", "Supplier not found.", { id });
  }
  return supplier;
}

function toData(input: SupplierInput) {
  return {
    code: input.code,
    name: input.name,
    category: input.category,
    contactPerson: input.contactPerson || null,
    email: input.email || null,
    phone: input.phone || null,
    address: input.address || null,
    taxRegistrationNo: input.taxRegistrationNo || null,
    paymentTermsDays: input.paymentTermsDays ?? null,
    defaultCurrencyCode: input.defaultCurrencyCode || null,
    isActive: input.isActive,
  };
}

export async function createSupplier(actor: ActorContext, input: SupplierInput) {
  const existing = await prisma.supplier.findFirst({
    where: { companyId: actor.companyId, code: input.code, deletedAt: null },
  });
  if (existing) {
    throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Supplier code "${input.code}" is already in use.`, {
      code: input.code,
    });
  }

  const supplier = await prisma.supplier.create({ data: { companyId: actor.companyId, ...toData(input) } });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "suppliers",
    recordId: supplier.id,
    action: "CREATE",
    newValues: supplier,
  });

  return supplier;
}

export async function updateSupplier(actor: ActorContext, id: string, input: SupplierInput) {
  const before = await getSupplierById(actor.companyId, id);

  if (input.code !== before.code) {
    const codeInUse = await prisma.supplier.findFirst({
      where: { companyId: actor.companyId, code: input.code, deletedAt: null, id: { not: id } },
    });
    if (codeInUse) {
      throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Supplier code "${input.code}" is already in use.`);
    }
  }

  const updated = await prisma.supplier.update({ where: { id }, data: toData(input) });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "suppliers",
    recordId: id,
    action: "UPDATE",
    oldValues: before,
    newValues: updated,
  });

  return updated;
}

export async function deactivateSupplier(actor: ActorContext, id: string) {
  const before = await getSupplierById(actor.companyId, id);
  const updated = await prisma.supplier.update({ where: { id }, data: { isActive: false, deletedAt: new Date() } });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "suppliers",
    recordId: id,
    action: "DELETE",
    oldValues: before,
  });

  return updated;
}
