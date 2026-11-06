import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { campaignCalendar } from "@/modules/sales-marketing/campaigns/campaign-results.service";

/** GET ?month=YYYY-MM&ownerUserId&status&typeId */
export const GET = salesMarketingRoute({ module: "marketing_campaigns", action: "view" }, async ({ req, actor }) => NextResponse.json({ data: await campaignCalendar(actor, Object.fromEntries(req.nextUrl.searchParams)) }));
