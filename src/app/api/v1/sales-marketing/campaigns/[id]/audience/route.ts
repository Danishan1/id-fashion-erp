import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { addCampaignAudience, getCampaignAudience } from "@/modules/sales-marketing/segments/campaign-audience.service";

/** GET: the campaign's include / exclude segments, snapshots in use and the combined audience count. */
export const GET = salesMarketingRoute<{ id: string }>({ module: "marketing_campaigns", action: "view" }, async ({ actor, params }) => {
  return NextResponse.json({ data: await getCampaignAudience(actor, params.id) });
});

/** POST { segmentId, role, pinLatest? }: needs campaign edit + segment view. Never sends anything. */
export const POST = salesMarketingRoute<{ id: string }>({ module: "marketing_campaigns", action: "edit" }, async ({ req, actor, params }) => {
  await addCampaignAudience(actor, params.id, await req.json());
  return NextResponse.json({ data: await getCampaignAudience(actor, params.id) }, { status: 201 });
});
