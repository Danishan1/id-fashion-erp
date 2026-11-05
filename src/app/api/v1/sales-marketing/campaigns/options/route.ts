import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { listLinkableCampaigns } from "@/modules/sales-marketing/campaigns/campaign.service";

/** Approved / running / completed campaigns (code + name) for the campaign pickers on leads, enquiries, quotations and orders. */
export const GET = salesMarketingRoute(
  [
    { module: "marketing_campaigns", action: "view" },
    { module: "sales_marketing", action: "view" },
    { module: "sales_quotations", action: "view" },
    { module: "sales_performance", action: "view" },
  ],
  async ({ req, actor }) => NextResponse.json({ data: await listLinkableCampaigns(actor, req.nextUrl.searchParams.get("search") ?? undefined) })
);
