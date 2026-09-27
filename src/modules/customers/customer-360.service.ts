import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { CustomerRepository } from "./customer.repository";

/**
 * A genuine cross-module aggregation, same shape as `getMarketingDashboard()`
 * (campaign.service.ts) and MRP's `getMaterialRequirements()` — a 360 view
 * inherently crosses vertical slices, so this reads Deal/SampleRequest/
 * SalesOrder/CrmActivity/CrmFollowup/CampaignAttribution directly rather than
 * inventing a repository indirection five other modules would need to keep
 * in sync for one read-only screen.
 *
 * Deliberately omits Quotations/Invoices/Payments/Outstanding/Returns/
 * Complaints — none of these exist anywhere in the schema yet (Phase 7
 * Accounts and Phase 8 Dispatch haven't started, confirmed by the
 * CRM/Marketing enhancement audit), so showing an empty section for them
 * would misrepresent "no data yet" as "feature broken."
 */
export async function getCustomer360(companyId: string, customerId: string) {
  const customer = await CustomerRepository.findByIdWithBuyers(companyId, customerId);
  if (!customer) throw new BusinessRuleError("NOT_FOUND", "Customer not found.", { id: customerId });

  const [deals, sampleRequests, salesOrders, activities, followups] = await Promise.all([
    prisma.deal.findMany({
      where: { companyId, customerId },
      select: {
        id: true,
        dealNumber: true,
        title: true,
        stage: true,
        value: true,
        probabilityPercent: true,
        expectedCloseDate: true,
        createdAt: true,
        lead: { select: { id: true, leadNumber: true, name: true, source: { select: { name: true } } } },
        assignedTo: { select: { id: true, fullName: true } },
        salesAgent: { select: { id: true, name: true } },
        resultingSalesOrders: { select: { id: true, orderNumber: true, status: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.sampleRequest.findMany({
      where: { companyId, customerId },
      select: { id: true, requestNumber: true, styleName: true, status: true, requestDate: true },
      orderBy: { requestDate: "desc" },
      take: 20,
    }),
    prisma.salesOrder.findMany({
      where: { companyId, customerId },
      select: { id: true, orderNumber: true, status: true, orderDate: true, totalAmount: true, currencyCode: true },
      orderBy: { orderDate: "desc" },
      take: 20,
    }),
    prisma.crmActivity.findMany({
      where: { companyId, relatedModule: "CUSTOMER", relatedRecordId: customerId },
      select: { id: true, activityType: true, subject: true, body: true, activityAt: true, performedBy: { select: { fullName: true } } },
      orderBy: { activityAt: "desc" },
      take: 20,
    }),
    prisma.crmFollowup.findMany({
      where: { companyId, relatedModule: "CUSTOMER", relatedRecordId: customerId },
      select: { id: true, followupDate: true, type: true, status: true, notes: true },
      orderBy: { followupDate: "desc" },
      take: 20,
    }),
  ]);

  // Campaigns don't link to a Customer directly — only to a Lead. The only
  // real path from "this Customer" back to "which campaigns touched them" is
  // via the Leads that became this customer's own Deals (Deal.leadId).
  const leadIds = [...new Set(deals.map((d) => d.lead?.id).filter((id): id is string => !!id))];
  const campaignTouchpoints = leadIds.length
    ? await prisma.campaignAttribution.findMany({
        where: { companyId, leadId: { in: leadIds } },
        select: {
          id: true,
          isFirstTouch: true,
          isLastTouch: true,
          attributedRevenue: true,
          source: true,
          medium: true,
          campaign: { select: { id: true, campaignNumber: true, name: true, channel: true } },
        },
      })
    : [];

  const leads = [...new Map(deals.map((d) => d.lead).filter((l): l is NonNullable<typeof l> => !!l).map((l) => [l.id, l])).values()];

  return { customer, deals, leads, sampleRequests, salesOrders, activities, followups, campaignTouchpoints };
}
