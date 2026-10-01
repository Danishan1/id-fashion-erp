import type { Prisma } from "@prisma/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { CrmActor } from "../core/crm-actor";
import type { CrmMutationContext } from "../core/crm-mutation";
import { nameKey } from "../core/crm-normalize";
import { crmOwnerWhere, getCrmRecordScope } from "../core/crm-visibility";
import { CrmCompanyRepository } from "./crm-company.repository";

/**
 * Phase 02 surface of CRM Companies: lookup for linking and creation during
 * lead conversion. Pages, edit, merge and the Customer link UI come in Phase 05.
 */
export async function searchCrmCompanies(actor: CrmActor, term: string | undefined) {
  const scope = await getCrmRecordScope(actor);
  const where: Prisma.CrmCompanyWhereInput = {
    AND: [
      { companyId: actor.companyId, archivedAt: null },
      crmOwnerWhere(scope) as Prisma.CrmCompanyWhereInput,
      ...(term?.trim() ? [{ name: { contains: term.trim(), mode: "insensitive" as const } }] : []),
    ],
  };
  return CrmCompanyRepository.search(where);
}

/** Existing (visible) companies with the same normalised name — shown before creating a new one. */
export async function findCompanyNameMatches(actor: CrmActor, name: string) {
  const key = nameKey(name);
  return key ? CrmCompanyRepository.findByNameKey(actor.companyId, key) : [];
}

export async function getCrmCompanyForActor(actor: CrmActor, id: string, db?: Prisma.TransactionClient) {
  const scope = await getCrmRecordScope(actor);
  const company = await CrmCompanyRepository.findById({ AND: [{ id, companyId: actor.companyId, archivedAt: null }, crmOwnerWhere(scope) as Prisma.CrmCompanyWhereInput] }, db);
  if (!company) throw new BusinessRuleError("NOT_FOUND", "Company not found.", { id });
  return company;
}

export async function createCrmCompanyInMutation(
  ctx: CrmMutationContext,
  actor: CrmActor,
  data: { name: string; email?: string | null; phone?: string | null; industry?: string | null; city?: string | null; state?: string | null; country?: string | null; ownerUserId?: string | null },
  { allowDuplicate = false, sourceLeadId }: { allowDuplicate?: boolean; sourceLeadId?: string } = {}
) {
  const key = nameKey(data.name);
  if (!allowDuplicate) {
    const existing = await CrmCompanyRepository.findByNameKey(actor.companyId, key);
    if (existing.length) {
      throw new BusinessRuleError("CRM_DUPLICATE_RECORD", `A company named "${existing[0].name}" already exists. Link it instead, or confirm to create another.`, {
        entityType: "COMPANY",
        matches: existing,
      });
    }
  }
  const company = await CrmCompanyRepository.create(
    {
      companyId: actor.companyId,
      name: data.name.trim(),
      nameKey: key,
      email: data.email || null,
      phone: data.phone || null,
      industry: data.industry || null,
      city: data.city || null,
      state: data.state || null,
      country: data.country || null,
      ownerUserId: data.ownerUserId ?? actor.userId,
      createdByUserId: actor.userId,
    },
    ctx.tx
  );
  await ctx.audit({ tableName: "crm_companies", recordId: company.id, action: "CREATE", newValues: company });
  ctx.emit({ entityType: "COMPANY", entityId: company.id, eventType: "company.created", summary: company.name, payload: sourceLeadId ? { fromLeadId: sourceLeadId } : undefined });
  return company;
}
