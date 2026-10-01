import type { Prisma } from "@prisma/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { CrmActor } from "../core/crm-actor";
import type { CrmMutationContext } from "../core/crm-mutation";
import { emailKey, fullNameOf, phoneKey, uniqueKeys } from "../core/crm-normalize";
import { crmOwnerWhere, getCrmRecordScope } from "../core/crm-visibility";
import { CrmContactRepository } from "./crm-contact.repository";

/**
 * Phase 02 surface of CRM Contacts: lookup for linking and creation during
 * lead conversion. Pages, DND, merge come in Phase 04.
 */
export async function searchCrmContacts(actor: CrmActor, term: string | undefined) {
  const scope = await getCrmRecordScope(actor);
  const t = term?.trim();
  const where: Prisma.CrmContactWhereInput = {
    AND: [
      { companyId: actor.companyId, archivedAt: null },
      crmOwnerWhere(scope) as Prisma.CrmContactWhereInput,
      ...(t ? [{ OR: [{ fullName: { contains: t, mode: "insensitive" as const } }, { email: { contains: t, mode: "insensitive" as const } }] }] : []),
    ],
  };
  return CrmContactRepository.search(where);
}

export function contactKeys(c: { email?: string | null; phone?: string | null; mobile?: string | null; whatsapp?: string | null; alternateEmail?: string | null }) {
  return {
    emailKeys: uniqueKeys([emailKey(c.email), emailKey(c.alternateEmail)]),
    phoneKeys: uniqueKeys([phoneKey(c.phone), phoneKey(c.mobile), phoneKey(c.whatsapp)]),
  };
}

/** Existing contacts sharing an email or phone with the given details. */
export async function findContactMatches(actor: CrmActor, details: Parameters<typeof contactKeys>[0]) {
  const keys = contactKeys(details);
  return CrmContactRepository.findMatches(actor.companyId, keys.emailKeys, keys.phoneKeys);
}

export async function getCrmContactForActor(actor: CrmActor, id: string, db?: Prisma.TransactionClient) {
  const scope = await getCrmRecordScope(actor);
  const contact = await CrmContactRepository.findById({ AND: [{ id, companyId: actor.companyId, archivedAt: null }, crmOwnerWhere(scope) as Prisma.CrmContactWhereInput] }, db);
  if (!contact) throw new BusinessRuleError("NOT_FOUND", "Contact not found.", { id });
  return contact;
}

export async function createCrmContactInMutation(
  ctx: CrmMutationContext,
  actor: CrmActor,
  data: {
    firstName: string;
    lastName?: string | null;
    designation?: string | null;
    email?: string | null;
    alternateEmail?: string | null;
    phone?: string | null;
    mobile?: string | null;
    whatsapp?: string | null;
    crmCompanyId?: string | null;
    ownerUserId?: string | null;
  },
  { allowDuplicate = false, sourceLeadId }: { allowDuplicate?: boolean; sourceLeadId?: string } = {}
) {
  const keys = contactKeys(data);
  if (!allowDuplicate) {
    const existing = await CrmContactRepository.findMatches(actor.companyId, keys.emailKeys, keys.phoneKeys);
    if (existing.length) {
      throw new BusinessRuleError("CRM_DUPLICATE_RECORD", `A contact with the same email or phone already exists (${existing[0].fullName}). Link it instead, or confirm to create another.`, {
        entityType: "CONTACT",
        matches: existing,
      });
    }
  }
  const contact = await CrmContactRepository.create(
    {
      companyId: actor.companyId,
      firstName: data.firstName.trim(),
      lastName: data.lastName?.trim() || null,
      fullName: fullNameOf(data.firstName, data.lastName),
      designation: data.designation || null,
      email: data.email || null,
      phone: data.phone || null,
      mobile: data.mobile || null,
      whatsapp: data.whatsapp || null,
      emailKeys: keys.emailKeys,
      phoneKeys: keys.phoneKeys,
      crmCompanyId: data.crmCompanyId || null,
      ownerUserId: data.ownerUserId ?? actor.userId,
      createdByUserId: actor.userId,
    },
    ctx.tx
  );
  await ctx.audit({ tableName: "crm_contacts", recordId: contact.id, action: "CREATE", newValues: contact });
  ctx.emit({ entityType: "CONTACT", entityId: contact.id, eventType: "contact.created", summary: contact.fullName, payload: sourceLeadId ? { fromLeadId: sourceLeadId } : undefined });
  return contact;
}
