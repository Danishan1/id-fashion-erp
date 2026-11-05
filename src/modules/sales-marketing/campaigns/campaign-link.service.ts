import { z } from "zod";
import { prisma } from "@/core/db/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { assertCrmEntityAccess } from "@/modules/crm/crm-entity-access";
import { getSalesEnquiryScope, scopedWhere as enquiryScopedWhere, type SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { listPerformanceEvents, optionalText, recordPerformanceEvent } from "@/modules/sales-marketing/performance/performance-common";
import { getQuotationScope, scopedWhere as quotationScopedWhere } from "@/modules/sales-marketing/quotations/quotation.service";

/**
 * The campaign a CRM lead, Sales Enquiry, Quotation or Sales Order came from
 * (Phase 08, PHASE_08_CAMPAIGNS.md §1). Optional, set from each record's page;
 * a quotation from an enquiry and an order from a quotation start with the
 * previous record's campaign. On an order a change needs a reason and is kept
 * in its history (same rule as the Phase 07 channel).
 */

export type CampaignDocType = "LEAD" | "ENQUIRY" | "QUOTATION" | "SALES_ORDER";
export const campaignLinkSchema = z.object({ campaignId: z.string().uuid().optional().or(z.literal("")).nullable(), reason: optionalText(1000) }).strict();

const PERMISSION: Record<CampaignDocType, [Parameters<typeof PermissionService.assert>[1], Parameters<typeof PermissionService.assert>[2]]> = {
  LEAD: ["crm", "edit"],
  ENQUIRY: ["sales_marketing", "edit"],
  QUOTATION: ["sales_quotations", "edit"],
  SALES_ORDER: ["sales_performance", "edit"],
};
const TABLES: Record<CampaignDocType, string> = { LEAD: "crm_leads", ENQUIRY: "buyer_enquiries", QUOTATION: "quotations", SALES_ORDER: "sales_orders" };

async function loadDoc(actor: SalesActor, docType: CampaignDocType, id: string) {
  const select = { id: true, campaignId: true, campaign: { select: { code: true, name: true, status: true } } } as const;
  if (docType === "LEAD") {
    await assertCrmEntityAccess({ companyId: actor.companyId, userId: actor.userId, branchId: actor.branchId ?? null }, "LEAD", id);
    const d = await prisma.crmLead.findFirst({ where: { id, companyId: actor.companyId }, select: { ...select, leadNumber: true } });
    return d ? { ...d, number: d.leadNumber } : null;
  }
  if (docType === "ENQUIRY") {
    const scope = await getSalesEnquiryScope(actor);
    const d = await prisma.buyerEnquiry.findFirst({ where: enquiryScopedWhere(actor, scope, { id }), select: { ...select, enquiryNumber: true } });
    return d ? { ...d, number: d.enquiryNumber } : null;
  }
  if (docType === "QUOTATION") {
    const scope = await getQuotationScope(actor);
    const d = await prisma.quotation.findFirst({ where: quotationScopedWhere(actor, scope, { id }), select: { ...select, quotationNumber: true } });
    return d ? { ...d, number: d.quotationNumber } : null;
  }
  const d = await prisma.salesOrder.findFirst({ where: { id, companyId: actor.companyId }, select: { ...select, orderNumber: true } });
  return d ? { ...d, number: d.orderNumber } : null;
}

export async function getCampaignLink(actor: SalesActor, docType: CampaignDocType, id: string) {
  const d = await loadDoc(actor, docType, id);
  if (!d) throw new BusinessRuleError("NOT_FOUND", "Record not found.", { id });
  const history = docType === "SALES_ORDER" ? (await listPerformanceEvents(prisma, actor.companyId, "SALES_ORDER", id)).filter((e) => e.type === "CAMPAIGN_CHANGED") : [];
  return { campaignId: d.campaignId, campaign: d.campaign ? `${d.campaign.name} (${d.campaign.code})` : null, history };
}

export async function setCampaignLink(actor: SalesActor, docType: CampaignDocType, id: string, raw: unknown) {
  const [module, action] = PERMISSION[docType];
  await PermissionService.assert(actor.userId, module, action);
  const input = campaignLinkSchema.parse(raw);
  const d = await loadDoc(actor, docType, id);
  if (!d) throw new BusinessRuleError("NOT_FOUND", "Record not found.", { id });
  const campaignId = input.campaignId || null;
  if (campaignId === d.campaignId) throw new BusinessRuleError("VALIDATION_ERROR", "Nothing changed.");
  if (docType === "SALES_ORDER" && !input.reason) throw new BusinessRuleError("VALIDATION_ERROR", "Say why — it changes which campaign this sale counts for.", { fieldErrors: { reason: "Required." } });
  let next: { code: string; name: string } | null = null;
  if (campaignId) {
    const c = await prisma.marketingCampaign.findFirst({ where: { id: campaignId, companyId: actor.companyId }, select: { code: true, name: true, status: true } });
    if (!c) throw new BusinessRuleError("VALIDATION_ERROR", "Campaign not found.", { fieldErrors: { campaignId: "Not found." } });
    if (!["APPROVED", "ACTIVE", "PAUSED", "COMPLETED"].includes(c.status)) {
      throw new BusinessRuleError("VALIDATION_ERROR", "Records are linked to an approved, running or completed campaign.", { fieldErrors: { campaignId: "Not approved yet, or cancelled." } });
    }
    next = { code: c.code, name: c.name };
  }
  const where = { id, companyId: actor.companyId, campaignId: d.campaignId };
  const data = { campaignId };
  await prisma.$transaction(async (tx) => {
    const { count } =
      docType === "LEAD"
        ? await tx.crmLead.updateMany({ where, data })
        : docType === "ENQUIRY"
          ? await tx.buyerEnquiry.updateMany({ where, data })
          : docType === "QUOTATION"
            ? await tx.quotation.updateMany({ where, data })
            : await tx.salesOrder.updateMany({ where, data });
    if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This record changed just now. Reload and try again.");
    if (docType === "SALES_ORDER") {
      await recordPerformanceEvent(tx, actor, "SALES_ORDER", id, "CAMPAIGN_CHANGED", input.reason || null, { orderNumber: d.number, before: d.campaign ? `${d.campaign.name} (${d.campaign.code})` : null, after: next ? `${next.name} (${next.code})` : null });
    }
    await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: TABLES[docType], recordId: id, action: "UPDATE", oldValues: { campaignId: d.campaignId }, newValues: { campaignId, reason: input.reason || null } }, tx);
  });
  return getCampaignLink(actor, docType, id);
}
