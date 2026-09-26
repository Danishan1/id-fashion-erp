import type { Prisma } from "@prisma/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { advanceMasterCodeSequence } from "@/core/numbering/DocumentNumberingService";
import type { ListQuery } from "@/lib/list-query";
import type { ContractorInput, ContractorUpdateInput } from "./contractor.schema";
import { ContractorRepository } from "./contractor.repository";

interface ActorContext {
  companyId: string;
  userId: string;
}

export async function listContractors(companyId: string, query: ListQuery) {
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
    ContractorRepository.findMany(where, {
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
    }),
    ContractorRepository.count(where),
  ]);

  return { data, totalCount };
}

export async function getContractorById(companyId: string, id: string) {
  const contractor = await ContractorRepository.findById(companyId, id);
  if (!contractor) {
    throw new BusinessRuleError("NOT_FOUND", "Contractor not found.", { id });
  }
  return contractor;
}

function toData(input: ContractorInput) {
  return {
    code: input.code,
    name: input.name,
    contactPerson: input.contactPerson || null,
    phone: input.phone || null,
    email: input.email || null,
    address: input.address || null,
    isActive: input.isActive,
  };
}

/**
 * Only includes keys actually present in a partial PATCH body — omitted
 * fields are left untouched in the DB. `code` is deliberately never included
 * here — auto-generated at creation and immutable from then on, matching
 * Supplier's own established convention (2026-09-15).
 */
function toUpdateData(input: ContractorUpdateInput): Prisma.ContractorUncheckedUpdateInput {
  const data: Prisma.ContractorUncheckedUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.contactPerson !== undefined) data.contactPerson = input.contactPerson || null;
  if (input.phone !== undefined) data.phone = input.phone || null;
  if (input.email !== undefined) data.email = input.email || null;
  if (input.address !== undefined) data.address = input.address || null;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  return data;
}

export async function createContractor(actor: ActorContext, input: ContractorInput) {
  const existing = await ContractorRepository.findByCode(actor.companyId, input.code);
  if (existing) {
    throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Contractor code "${input.code}" is already in use.`, {
      code: input.code,
    });
  }

  const contractor = await ContractorRepository.create({ companyId: actor.companyId, ...toData(input) });

  await advanceMasterCodeSequence(actor.companyId, "CONTRACTOR");

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "contractors",
    recordId: contractor.id,
    action: "CREATE",
    newValues: contractor,
  });

  return contractor;
}

export async function updateContractor(actor: ActorContext, id: string, input: ContractorUpdateInput) {
  const before = await getContractorById(actor.companyId, id);

  const updated = await ContractorRepository.update(id, toUpdateData(input));

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "contractors",
    recordId: id,
    action: "UPDATE",
    oldValues: before,
    newValues: updated,
  });

  return updated;
}

export async function setContractorActiveStatus(actor: ActorContext, id: string, isActive: boolean) {
  const before = await getContractorById(actor.companyId, id);
  const updated = await ContractorRepository.update(id, { isActive });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "contractors",
    recordId: id,
    action: "UPDATE",
    oldValues: before,
    newValues: updated,
  });

  return updated;
}

export async function deactivateContractor(actor: ActorContext, id: string) {
  const before = await getContractorById(actor.companyId, id);
  const updated = await ContractorRepository.update(id, { isActive: false, deletedAt: new Date() });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "contractors",
    recordId: id,
    action: "DELETE",
    oldValues: before,
  });

  return updated;
}
