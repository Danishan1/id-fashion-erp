import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getCampaign, recordManualResult } from "@/modules/sales-marketing/campaigns/campaign-results.service";

/** POST { actual, asOf }: record a manual metric's result (marked as manual, audited). */
export const POST = salesMarketingRoute<{ id: string; metricId: string }>({ module: "marketing_campaigns", action: "edit" }, async ({ req, actor, params }) => {
  await recordManualResult(actor, params.id, params.metricId, await req.json());
  return NextResponse.json({ data: await getCampaign(actor, params.id) });
});
