import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import type { CrmActor } from "../core/crm-actor";
import type { CrmMutationContext } from "../core/crm-mutation";
import { CrmOpportunityRepository } from "./crm-opportunity.repository";

/**
 * Phase 02 surface of CRM Opportunities: creation from a lead. This is the
 * single creation path later phases extend (pipeline/stage assignment in
 * Phase 07); pages and editing arrive in Phase 06.
 *
 * The number is reserved before the transaction (numbering runs its own
 * transaction), so a rolled-back conversion can leave a gap in OPP numbers —
 * the same behaviour as every other numbered document in this ERP.
 */
export async function reserveOpportunityNumber(actor: CrmActor) {
  // Company-wide sequence: opportunity numbers are unique per company.
  return generateDocumentNumber({ companyId: actor.companyId, branchId: null, documentType: "CRM_OPPORTUNITY" });
}

export async function createOpportunityInMutation(
  ctx: CrmMutationContext,
  actor: CrmActor,
  data: {
    opportunityNumber: string;
    name: string;
    leadId?: string | null;
    crmContactId?: string | null;
    crmCompanyId?: string | null;
    sourceId?: string | null;
    ownerUserId?: string | null;
    amount?: number | null;
    currencyCode?: string | null;
    expectedCloseDate?: string | null;
    description?: string | null;
  }
) {
  const opp = await CrmOpportunityRepository.create(
    {
      companyId: actor.companyId,
      opportunityNumber: data.opportunityNumber,
      name: data.name.trim(),
      leadId: data.leadId ?? null,
      crmContactId: data.crmContactId ?? null,
      crmCompanyId: data.crmCompanyId ?? null,
      sourceId: data.sourceId ?? null,
      ownerUserId: data.ownerUserId ?? actor.userId,
      amount: data.amount ?? null,
      currencyCode: data.currencyCode || null,
      expectedCloseDate: data.expectedCloseDate ? new Date(`${data.expectedCloseDate}T00:00:00.000Z`) : null,
      description: data.description || null,
      createdByUserId: actor.userId,
    },
    ctx.tx
  );
  await ctx.audit({ tableName: "crm_opportunities", recordId: opp.id, action: "CREATE", newValues: opp });
  ctx.emit({
    entityType: "OPPORTUNITY",
    entityId: opp.id,
    eventType: "opportunity.created",
    summary: `${opp.opportunityNumber} — ${opp.name}`,
    payload: { leadId: data.leadId ?? null, amount: data.amount ?? null, currencyCode: data.currencyCode ?? null },
  });
  // Company timeline: the opportunity is associated with the account.
  if (opp.crmCompanyId) ctx.emit({ entityType: "COMPANY", entityId: opp.crmCompanyId, eventType: "company.opportunity_linked", summary: `${opp.opportunityNumber} — ${opp.name}`, payload: { opportunityId: opp.id } });
  return opp;
}
