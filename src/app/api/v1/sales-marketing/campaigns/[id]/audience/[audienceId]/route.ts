import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { pinCampaignAudience, removeCampaignAudience } from "@/modules/sales-marketing/segments/campaign-audience.service";

/** PATCH { evaluationId | null }: pin to a completed snapshot, or follow the latest. */
export const PATCH = salesMarketingRoute<{ id: string; audienceId: string }>({ module: "marketing_campaigns", action: "edit" }, async ({ req, actor, params }) => {
  return NextResponse.json({ data: await pinCampaignAudience(actor, params.id, params.audienceId, await req.json()) });
});

export const DELETE = salesMarketingRoute<{ id: string; audienceId: string }>({ module: "marketing_campaigns", action: "edit" }, async ({ actor, params }) => {
  return NextResponse.json({ data: await removeCampaignAudience(actor, params.id, params.audienceId) });
});
