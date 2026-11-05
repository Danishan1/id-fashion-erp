import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { addMetric, getCampaign } from "@/modules/sales-marketing/campaigns/campaign-results.service";

export const POST = salesMarketingRoute<{ id: string }>({ module: "marketing_campaigns", action: "edit" }, async ({ req, actor, params }) => {
  await addMetric(actor, params.id, await req.json());
  return NextResponse.json({ data: await getCampaign(actor, params.id) }, { status: 201 });
});
