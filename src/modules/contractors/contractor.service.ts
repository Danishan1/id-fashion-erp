import type { Prisma } from "@prisma/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { advanceMasterCodeSequence } from "@/core/numbering/DocumentNumberingService";
import type { ListQuery } from "@/lib/list-query";
import type { ContractorInput, ContractorUpdateInput } from "./contractor.schema";
import { CONTRACTOR_STAGES_INCLUDE, ContractorRepository } from "./contractor.repository";

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
      include: CONTRACTOR_STAGES_INCLUDE,
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

/**
 * Every stage id must be one of THIS company's own production stages (never
 * trust a client-supplied id). Newly-added stages must be active; an
 * already-linked stage that was later deactivated may stay on the list so an
 * unrelated edit doesn't fail.
 */
async function assertValidStageIds(companyId: string, stageIds: string[], existingStageIds: string[] = []) {
  if (!stageIds.length) return;
  const found = await ContractorRepository.findStagesByIds(companyId, stageIds);
  const byId = new Map(found.map((s) => [s.id, s]));
  for (const id of stageIds) {
    const stage = byId.get(id);
    if (!stage) throw new BusinessRuleError("NOT_FOUND", "Production stage not found.", { id });
    if (!stage.isActive && !existingStageIds.includes(id)) {
      throw new BusinessRuleError("VALIDATION_ERROR", `Stage "${stage.name}" is inactive and cannot be assigned to a contractor.`, { id });
    }
  }
}

export async function createContractor(actor: ActorContext, input: ContractorInput) {
  const existing = await ContractorRepository.findByCode(actor.companyId, input.code);
  if (existing) {
    throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Contractor code "${input.code}" is already in use.`, {
      code: input.code,
    });
  }

  const stageIds = input.stageIds ?? [];
  await assertValidStageIds(actor.companyId, stageIds);

  const created = await prisma.$transaction(async (tx) => {
    const row = await ContractorRepository.createInTx(tx, { companyId: actor.companyId, ...toData(input) });
    await ContractorRepository.replaceStagesInTx(tx, row.id, stageIds);
    return row;
  });
  const contractor = await getContractorById(actor.companyId, created.id);

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

  if (input.stageIds !== undefined) {
    await assertValidStageIds(
      actor.companyId,
      input.stageIds,
      before.stages.map((s) => s.productionStageId),
    );
  }

  await prisma.$transaction(async (tx) => {
    await ContractorRepository.updateInTx(tx, id, toUpdateData(input));
    if (input.stageIds !== undefined) await ContractorRepository.replaceStagesInTx(tx, id, input.stageIds);
  });
  const updated = await getContractorById(actor.companyId, id);

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
