import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getCampaignContent } from "@/modules/sales-marketing/content/campaign-content.service";

export const GET = salesMarketingRoute<{ id: string }>({ module: "marketing_content", action: "view" }, async ({ actor, params }) => {
  return NextResponse.json({ data: await getCampaignContent(actor, params.id) });
});
