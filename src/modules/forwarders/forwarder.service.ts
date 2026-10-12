import type { Prisma } from "@prisma/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { advanceMasterCodeSequence } from "@/core/numbering/DocumentNumberingService";
import type { ListQuery } from "@/lib/list-query";
import type { ForwarderInput, ForwarderUpdateInput } from "./forwarder.schema";
import { ForwarderRepository } from "./forwarder.repository";

interface ActorContext {
  companyId: string;
  userId: string;
}

export async function listForwarders(companyId: string, query: ListQuery) {
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
    ForwarderRepository.findMany(where, {
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
    }),
    ForwarderRepository.count(where),
  ]);

  return { data, totalCount };
}

export async function getForwarderById(companyId: string, id: string) {
  const forwarder = await ForwarderRepository.findById(companyId, id);
  if (!forwarder) {
    throw new BusinessRuleError("NOT_FOUND", "Forwarder not found.", { id });
  }
  return forwarder;
}

function toData(input: ForwarderInput) {
  return {
    code: input.code,
    name: input.name,
    type: input.type,
    contactPerson: input.contactPerson || null,
    phone: input.phone || null,
    altPhone: input.altPhone || null,
    email: input.email || null,
    address: input.address || null,
    city: input.city || null,
    state: input.state || null,
    country: input.country || null,
    postalCode: input.postalCode || null,
    gstin: input.gstin || null,
    remarks: input.remarks || null,
    isActive: input.isActive,
  };
}

/**
 * Only includes keys actually present in a partial PATCH body — omitted
 * fields are left untouched in the DB. `code` is deliberately never included
 * here — auto-generated at creation and immutable from then on, matching
 * Contractor's/Supplier's own established convention.
 */
function toUpdateData(input: ForwarderUpdateInput): Prisma.ForwarderUncheckedUpdateInput {
  const data: Prisma.ForwarderUncheckedUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.type !== undefined) data.type = input.type;
  if (input.contactPerson !== undefined) data.contactPerson = input.contactPerson || null;
  if (input.phone !== undefined) data.phone = input.phone || null;
  if (input.altPhone !== undefined) data.altPhone = input.altPhone || null;
  if (input.email !== undefined) data.email = input.email || null;
  if (input.address !== undefined) data.address = input.address || null;
  if (input.city !== undefined) data.city = input.city || null;
  if (input.state !== undefined) data.state = input.state || null;
  if (input.country !== undefined) data.country = input.country || null;
  if (input.postalCode !== undefined) data.postalCode = input.postalCode || null;
  if (input.gstin !== undefined) data.gstin = input.gstin || null;
  if (input.remarks !== undefined) data.remarks = input.remarks || null;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  return data;
}

export async function createForwarder(actor: ActorContext, input: ForwarderInput) {
  const existing = await ForwarderRepository.findByCode(actor.companyId, input.code);
  if (existing) {
    throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Forwarder code "${input.code}" is already in use.`, {
      code: input.code,
    });
  }

  const created = await ForwarderRepository.create({ companyId: actor.companyId, ...toData(input) });

  await advanceMasterCodeSequence(actor.companyId, "FORWARDER");

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "forwarders",
    recordId: created.id,
    action: "CREATE",
    newValues: created,
  });

  return created;
}

export async function updateForwarder(actor: ActorContext, id: string, input: ForwarderUpdateInput) {
  const before = await getForwarderById(actor.companyId, id);
  const updated = await ForwarderRepository.update(id, toUpdateData(input));

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "forwarders",
    recordId: id,
    action: "UPDATE",
    oldValues: before,
    newValues: updated,
  });

  return updated;
}

export async function setForwarderActiveStatus(actor: ActorContext, id: string, isActive: boolean) {
  const before = await getForwarderById(actor.companyId, id);
  const updated = await ForwarderRepository.update(id, { isActive });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "forwarders",
    recordId: id,
    action: "UPDATE",
    oldValues: before,
    newValues: updated,
  });

  return updated;
}

export async function deactivateForwarder(actor: ActorContext, id: string) {
  const before = await getForwarderById(actor.companyId, id);
  const updated = await ForwarderRepository.update(id, { isActive: false, deletedAt: new Date() });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "forwarders",
    recordId: id,
    action: "DELETE",
    oldValues: before,
  });

  return updated;
}
