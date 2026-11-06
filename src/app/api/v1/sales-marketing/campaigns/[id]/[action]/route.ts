import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { campaignAction } from "@/modules/sales-marketing/campaigns/campaign.service";
import { getCampaign } from "@/modules/sales-marketing/campaigns/campaign-results.service";

/** POST submit | return-to-draft | send-back | approve | activate | pause | resume | complete | cancel — the service checks each action's permission. */
export const POST = salesMarketingRoute<{ id: string; action: string }>({ module: "marketing_campaigns", action: "view" }, async ({ req, actor, params }) => {
  await campaignAction(actor, params.id, params.action, await req.json().catch(() => ({})));
  return NextResponse.json({ data: await getCampaign(actor, params.id) });
});
