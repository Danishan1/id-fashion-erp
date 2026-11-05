import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { addCampaignChannel, listCampaignChannels } from "@/modules/sales-marketing/delivery/delivery-run.service";

/** GET: the campaign's delivery channels with readiness problems and recent runs. */
export const GET = salesMarketingRoute<{ id: string }>({ module: "marketing_delivery", action: "view" }, async ({ actor, params }) => {
  return NextResponse.json({ data: await listCampaignChannels(actor, params.id) });
});

/** POST { connectionId, templateId } */
export const POST = salesMarketingRoute<{ id: string }>({ module: "marketing_delivery", action: "create" }, async ({ req, actor, params }) => {
  return NextResponse.json({ data: await addCampaignChannel(actor, params.id, await req.json()) }, { status: 201 });
});
