import type { CrmEntityType, Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { CrmContactRepository } from "./contacts/crm-contact.repository";
import type { CrmActor } from "./core/crm-actor";
import { crmOwnerWhere, getCrmRecordScope } from "./core/crm-visibility";

/**
 * "Can this user see this CRM record?" for any entity type — used by the
 * shared timeline, notes and tags so a record's history is only reachable by
 * people who can see the record itself. Outside the company or the user's
 * visibility scope behaves as not found.
 */
export async function assertCrmEntityAccess(actor: CrmActor, entityType: CrmEntityType, entityId: string): Promise<void> {
  const scope = await getCrmRecordScope(actor);
  const where = { AND: [{ id: entityId, companyId: actor.companyId }, crmOwnerWhere(scope)] };
  const select = { id: true } as const;
  const found =
    entityType === "LEAD"
      ? await prisma.crmLead.findFirst({ where: where as Prisma.CrmLeadWhereInput, select })
      : entityType === "CONTACT"
        ? await prisma.crmContact.findFirst({ where: where as Prisma.CrmContactWhereInput, select })
        : entityType === "COMPANY"
          ? await prisma.crmCompany.findFirst({ where: where as Prisma.CrmCompanyWhereInput, select })
          : await prisma.crmOpportunity.findFirst({ where: where as Prisma.CrmOpportunityWhereInput, select });
  if (!found) throw new BusinessRuleError("NOT_FOUND", "Record not found.", { entityType, entityId });
}

/** Contacts merged (directly or via a chain) into this contact — their history belongs to it. */
export function mergedContactIds(companyId: string, contactId: string): Promise<string[]> {
  return CrmContactRepository.mergedIdsInto(companyId, contactId);
}
