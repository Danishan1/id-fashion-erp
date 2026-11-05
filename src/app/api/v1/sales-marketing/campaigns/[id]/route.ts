import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { deleteCampaign, updateCampaign } from "@/modules/sales-marketing/campaigns/campaign.service";
import { getCampaign } from "@/modules/sales-marketing/campaigns/campaign-results.service";

type P = { id: string };

export const GET = salesMarketingRoute<P>({ module: "marketing_campaigns", action: "view" }, async ({ actor, params }) => NextResponse.json({ data: await getCampaign(actor, params.id) }));

export const PATCH = salesMarketingRoute<P>({ module: "marketing_campaigns", action: "edit" }, async ({ req, actor, params }) => {
  await updateCampaign(actor, params.id, await req.json());
  return NextResponse.json({ data: await getCampaign(actor, params.id) });
});

/** DELETE: an empty draft only. */
export const DELETE = salesMarketingRoute<P>({ module: "marketing_campaigns", action: "edit" }, async ({ actor, params }) => NextResponse.json({ data: await deleteCampaign(actor, params.id) }));
