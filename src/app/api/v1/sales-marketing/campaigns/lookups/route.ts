import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { createCampaignLookup, listCampaignLookups } from "@/modules/sales-marketing/campaigns/campaign-lookup.service";

/** GET ?kind=TYPE|OBJECTIVE&includeInactive=true. POST: new list value (sales_marketing_settings.edit). */
export const GET = salesMarketingRoute([{ module: "marketing_campaigns", action: "view" }, { module: "sales_marketing_settings", action: "view" }], async ({ req, actor }) => NextResponse.json({ data: await listCampaignLookups(actor, Object.fromEntries(req.nextUrl.searchParams)) }));

export const POST = salesMarketingRoute({ module: "sales_marketing_settings", action: "edit" }, async ({ req, actor }) => NextResponse.json({ data: await createCampaignLookup(actor, await req.json()) }, { status: 201 }));
