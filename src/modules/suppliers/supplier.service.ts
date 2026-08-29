import type { Prisma } from "@prisma/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { advanceMasterCodeSequence } from "@/core/numbering/DocumentNumberingService";
import { GarmentAttributeRepository } from "@/modules/garment-attributes/garment-attributes.repository";
import type { ListQuery } from "@/lib/list-query";
import type { SupplierInput, SupplierUpdateInput } from "./supplier.schema";
import { SupplierRepository } from "./supplier.repository";

interface ActorContext {
  companyId: string;
  userId: string;
}

/** Tenant-scope check on a categoryId before it's ever written — same
 * discipline as employee.service.ts's assertDesignationBelongsToCompany. */
async function assertSupplierCategoryBelongsToCompany(companyId: string, categoryId: string) {
  const category = await GarmentAttributeRepository.supplierCategory.findFirst({ where: { id: categoryId, companyId } });
  if (!category) throw new BusinessRuleError("NOT_FOUND", "Supplier category not found.", { id: categoryId });
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
    categoryId: input.categoryId,
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

/** Only includes keys actually present in a partial PATCH body — omitted fields are left untouched in the DB. */
function toUpdateData(input: SupplierUpdateInput): Prisma.SupplierUncheckedUpdateInput {
  const data: Prisma.SupplierUncheckedUpdateInput = {};
  if (input.code !== undefined) data.code = input.code;
  if (input.name !== undefined) data.name = input.name;
  if (input.categoryId !== undefined) data.categoryId = input.categoryId;
  if (input.contactPerson !== undefined) data.contactPerson = input.contactPerson || null;
  if (input.email !== undefined) data.email = input.email || null;
  if (input.phone !== undefined) data.phone = input.phone || null;
  if (input.address !== undefined) data.address = input.address || null;
  if (input.taxRegistrationNo !== undefined) data.taxRegistrationNo = input.taxRegistrationNo || null;
  if (input.paymentTermsDays !== undefined) data.paymentTermsDays = input.paymentTermsDays ?? null;
  if (input.defaultCurrencyCode !== undefined) data.defaultCurrencyCode = input.defaultCurrencyCode || null;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  return data;
}

export async function createSupplier(actor: ActorContext, input: SupplierInput) {
  const existing = await SupplierRepository.findByCode(actor.companyId, input.code);
  if (existing) {
    throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Supplier code "${input.code}" is already in use.`, {
      code: input.code,
    });
  }
  await assertSupplierCategoryBelongsToCompany(actor.companyId, input.categoryId);

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

export async function updateSupplier(actor: ActorContext, id: string, input: SupplierUpdateInput) {
  const before = await getSupplierById(actor.companyId, id);

  if (input.code !== undefined && input.code !== before.code) {
    const codeInUse = await SupplierRepository.findByCode(actor.companyId, input.code, id);
    if (codeInUse) {
      throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Supplier code "${input.code}" is already in use.`);
    }
  }
  if (input.categoryId !== undefined) {
    await assertSupplierCategoryBelongsToCompany(actor.companyId, input.categoryId);
  }

  const updated = await SupplierRepository.update(id, toUpdateData(input));

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
