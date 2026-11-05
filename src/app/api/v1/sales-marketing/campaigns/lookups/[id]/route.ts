import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { updateCampaignLookup } from "@/modules/sales-marketing/campaigns/campaign-lookup.service";

export const PATCH = salesMarketingRoute<{ id: string }>({ module: "sales_marketing_settings", action: "edit" }, async ({ req, actor, params }) => NextResponse.json({ data: await updateCampaignLookup(actor, params.id, await req.json()) }));
