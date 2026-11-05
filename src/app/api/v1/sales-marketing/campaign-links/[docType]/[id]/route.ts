import { NextResponse } from "next/server";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getCampaignLink, setCampaignLink, type CampaignDocType } from "@/modules/sales-marketing/campaigns/campaign-link.service";

type P = { docType: string; id: string };
const DOC: Record<string, CampaignDocType> = { lead: "LEAD", enquiry: "ENQUIRY", quotation: "QUOTATION", order: "SALES_ORDER" };
const VIEW: Record<CampaignDocType, [Parameters<typeof PermissionService.assert>[1], "view"][]> = {
  LEAD: [["crm", "view"]],
  ENQUIRY: [["sales_marketing", "view"]],
  QUOTATION: [["sales_quotations", "view"]],
  SALES_ORDER: [["sales_orders", "view"], ["sales_performance", "view"]],
};

async function docOf(userId: string, raw: string) {
  const doc = DOC[raw];
  if (!doc) throw new BusinessRuleError("NOT_FOUND", "Unknown record type.");
  for (const [m, a] of VIEW[doc]) await PermissionService.assert(userId, m, a);
  return doc;
}

const ANY = [
  { module: "sales_marketing", action: "view" },
  { module: "sales_quotations", action: "view" },
  { module: "sales_performance", action: "view" },
  { module: "marketing_campaigns", action: "view" },
] as const;

/** GET: the record's campaign (orders: with change history). PATCH { campaignId, reason }: change it — the service checks the record's edit permission. */
export const GET = salesMarketingRoute<P>([...ANY], async ({ actor, params }) => NextResponse.json({ data: await getCampaignLink(actor, await docOf(actor.userId, params.docType), params.id) }));

export const PATCH = salesMarketingRoute<P>([...ANY], async ({ req, actor, params }) =>
  NextResponse.json({ data: await setCampaignLink(actor, await docOf(actor.userId, params.docType), params.id, await req.json()) })
);
