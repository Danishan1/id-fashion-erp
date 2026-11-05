import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getCampaign, removeMetric, updateMetric } from "@/modules/sales-marketing/campaigns/campaign-results.service";

type P = { id: string; metricId: string };

export const PATCH = salesMarketingRoute<P>({ module: "marketing_campaigns", action: "edit" }, async ({ req, actor, params }) => {
  await updateMetric(actor, params.id, params.metricId, await req.json());
  return NextResponse.json({ data: await getCampaign(actor, params.id) });
});

export const DELETE = salesMarketingRoute<P>({ module: "marketing_campaigns", action: "edit" }, async ({ actor, params }) => {
  await removeMetric(actor, params.id, params.metricId);
  return NextResponse.json({ data: await getCampaign(actor, params.id) });
});
