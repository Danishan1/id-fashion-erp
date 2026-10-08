import type { CrmEntityType, Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { CrmCompanyRepository } from "./companies/crm-company.repository";
import { CrmContactRepository } from "./contacts/crm-contact.repository";
import { conversationScopeWhere } from "./conversations/conversation-access";
import type { CrmActor } from "./core/crm-actor";
import { crmOwnerWhere, getCrmRecordScope } from "./core/crm-visibility";

/**
 * "Can this user see this CRM record?" for any entity type — used by the
 * shared timeline, notes and tags so a record's history is only reachable by
 * people who can see the record itself. Outside the company or the user's
 * visibility scope behaves as not found.
 */
export async function assertCrmEntityAccess(actor: CrmActor, entityType: CrmEntityType, entityId: string): Promise<void> {
  if (entityType === "ACTIVITY") return assertActivityAccess(actor, entityId);
  const scope = await getCrmRecordScope(actor);
  if (entityType === "CONVERSATION") {
    const conversation = await prisma.crmConversation.findFirst({ where: { AND: [{ id: entityId, companyId: actor.companyId }, conversationScopeWhere(actor, scope)] }, select: { id: true } });
    if (!conversation) throw new BusinessRuleError("NOT_FOUND", "Record not found.", { entityType, entityId });
    return;
  }
  const where = { AND: [{ id: entityId, companyId: actor.companyId }, crmOwnerWhere(scope)] };
  const select = { id: true } as const;
  const found =
    entityType === "LEAD"
      ? await prisma.crmLead.findFirst({ where: where as Prisma.CrmLeadWhereInput, select })
      : entityType === "CONTACT"
        ? await prisma.crmContact.findFirst({ where: where as Prisma.CrmContactWhereInput, select })
        : entityType === "COMPANY"
          ? await prisma.crmCompany.findFirst({ where: where as Prisma.CrmCompanyWhereInput, select })
          : entityType === "OPPORTUNITY"
            ? await prisma.crmOpportunity.findFirst({ where: where as Prisma.CrmOpportunityWhereInput, select })
            : null;
  if (!found) throw new BusinessRuleError("NOT_FOUND", "Record not found.", { entityType, entityId });
}

/**
 * Activities (Phase 09): visible to crm.view_all, to the assignee and the
 * creator, and to anyone who can see the record it was created on. Same rule
 * as crm-activities.service.ts (kept here to avoid an import cycle).
 */
async function assertActivityAccess(actor: CrmActor, activityId: string): Promise<void> {
  const a = await prisma.crmActivity.findFirst({ where: { id: activityId, companyId: actor.companyId, deletedAt: null }, select: { assignedToUserId: true, createdByUserId: true, entityType: true, entityId: true } });
  if (!a) throw new BusinessRuleError("NOT_FOUND", "Record not found.", { entityType: "ACTIVITY", entityId: activityId });
  const scope = await getCrmRecordScope(actor);
  if (scope.mode === "ALL" || a.assignedToUserId === actor.userId || a.createdByUserId === actor.userId) return;
  if (a.entityType === "ACTIVITY") throw new BusinessRuleError("NOT_FOUND", "Record not found.", { entityType: "ACTIVITY", entityId: activityId });
  await assertCrmEntityAccess(actor, a.entityType, a.entityId);
}

/** Contacts merged (directly or via a chain) into this contact — their history belongs to it. */
export function mergedContactIds(companyId: string, contactId: string): Promise<string[]> {
  return CrmContactRepository.mergedIdsInto(companyId, contactId);
}

/**
 * Company timeline scope: companies merged into it, and — when asked — the
 * company's contacts and leads that the viewer can see (newest 500 each).
 */
export async function companyTimelineScope(actor: CrmActor, companyId: string, includeRelated: boolean) {
  const merged = await CrmCompanyRepository.mergedIdsInto(actor.companyId, companyId);
  if (!includeRelated) return { companyIds: merged, contactIds: [] as string[], leadIds: [] as string[] };
  const scope = await getCrmRecordScope(actor);
  const owner = crmOwnerWhere(scope);
  const ids = [companyId, ...merged];
  const [contacts, leads] = await Promise.all([
    prisma.crmContact.findMany({ where: { AND: [{ companyId: actor.companyId, crmCompanyId: { in: ids } }, owner as Prisma.CrmContactWhereInput] }, select: { id: true }, take: 500, orderBy: { createdAt: "desc" } }),
    prisma.crmLead.findMany({ where: { AND: [{ companyId: actor.companyId, crmCompanyId: { in: ids } }, owner as Prisma.CrmLeadWhereInput] }, select: { id: true }, take: 500, orderBy: { createdAt: "desc" } }),
  ]);
  return { companyIds: merged, contactIds: contacts.map((c) => c.id), leadIds: leads.map((l) => l.id) };
}
