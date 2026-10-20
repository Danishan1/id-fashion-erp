import type { Prisma } from "@prisma/client";
import type { CrmActor } from "../core/crm-actor";
import { crmOwnerWhere, crmScopeUserFilter, type CrmRecordScope } from "../core/crm-visibility";

/**
 * Who can see a conversation (Phase 11). Kept free of service imports so the
 * shared entity-access check (timeline, notes) can use it without a cycle.
 *
 *   crm.view_all                → every conversation
 *   otherwise (crm.view)        → conversations assigned to them, plus
 *                                 unassigned ones linked to a contact, company
 *                                 or opportunity they can see (their own).
 *
 * Unassigned, unmatched conversations are therefore triaged by managers (or
 * land with a channel's default assignee) — a salesperson never sees
 * another customer's messages just because nobody picked them up yet.
 */
export function conversationScopeWhere(actor: CrmActor, scope: CrmRecordScope): Prisma.CrmConversationWhereInput {
  if (scope.mode === "ALL") return {};
  const owned = crmOwnerWhere(scope);
  return {
    OR: [
      { assignedToUserId: crmScopeUserFilter(scope) },
      {
        assignedToUserId: null,
        OR: [
          { contact: { is: owned as Prisma.CrmContactWhereInput } },
          { crmCompany: { is: owned as Prisma.CrmCompanyWhereInput } },
          { opportunity: { is: owned as Prisma.CrmOpportunityWhereInput } },
        ],
      },
    ],
  };
}
