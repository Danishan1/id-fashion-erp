import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { loadCampaign } from "@/modules/sales-marketing/campaigns/campaign-common";
import { promotionsForCampaign } from "@/modules/sales-marketing/promotions/promotion.service";

/** GET: promotions whose approved terms are limited to this campaign (null without promotions access). */
export const GET = salesMarketingRoute<{ id: string }>({ module: "marketing_campaigns", action: "view" }, async ({ actor, params }) => {
  await loadCampaign(actor, params.id);
  return NextResponse.json({ data: await promotionsForCampaign(actor, params.id) });
});
