import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { campaignOverview } from "@/modules/sales-marketing/campaigns/campaign-results.service";

export const GET = salesMarketingRoute({ module: "marketing_campaigns", action: "view" }, async ({ actor }) => NextResponse.json({ data: await campaignOverview(actor) }));
