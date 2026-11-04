import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { revisionAction } from "@/modules/sales-marketing/campaigns/campaign.service";
import { getCampaign } from "@/modules/sales-marketing/campaigns/campaign-results.service";

/** POST approve | send-back | withdraw. */
export const POST = salesMarketingRoute<{ id: string; revisionId: string; action: string }>({ module: "marketing_campaigns", action: "view" }, async ({ req, actor, params }) => {
  await revisionAction(actor, params.id, params.revisionId, params.action, await req.json().catch(() => ({})));
  return NextResponse.json({ data: await getCampaign(actor, params.id) });
});
