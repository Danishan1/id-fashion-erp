import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { advanceMasterCodeSequence } from "@/core/numbering/DocumentNumberingService";
import type { ListQuery } from "@/lib/list-query";
import type { SupplierInput } from "./supplier.schema";
import { SupplierRepository } from "./supplier.repository";

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
    SupplierRepository.findMany(where, {
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
    }),
    SupplierRepository.count(where),
  ]);

  return { data, totalCount };
}

export async function getSupplierById(companyId: string, id: string) {
  const supplier = await SupplierRepository.findById(companyId, id);
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
  const existing = await SupplierRepository.findByCode(actor.companyId, input.code);
  if (existing) {
    throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Supplier code "${input.code}" is already in use.`, {
      code: input.code,
    });
  }

  const supplier = await SupplierRepository.create({ companyId: actor.companyId, ...toData(input) });

  await advanceMasterCodeSequence(actor.companyId, "SUPPLIER");

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
    const codeInUse = await SupplierRepository.findByCode(actor.companyId, input.code, id);
    if (codeInUse) {
      throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Supplier code "${input.code}" is already in use.`);
    }
  }

  const updated = await SupplierRepository.update(id, toData(input));

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

export async function setSupplierActiveStatus(actor: ActorContext, id: string, isActive: boolean) {
  const before = await getSupplierById(actor.companyId, id);
  const updated = await SupplierRepository.update(id, { isActive });

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
  const updated = await SupplierRepository.update(id, { isActive: false, deletedAt: new Date() });

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
