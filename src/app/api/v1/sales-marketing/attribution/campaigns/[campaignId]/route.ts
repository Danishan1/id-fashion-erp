import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { campaignAttributionDetail } from "@/modules/sales-marketing/attribution/attribution-report.service";

/** GET ?modelId=&from=&to=: conversions credited to the campaign, with the touches that shared each one. */
export const GET = salesMarketingRoute<{ campaignId: string }>({ module: "marketing_attribution", action: "view" }, async ({ req, actor, params }) => {
  const sp = req.nextUrl.searchParams;
  const pick = (k: string) => sp.get(k) || undefined;
  return NextResponse.json({ data: await campaignAttributionDetail(actor, params.campaignId, { modelId: pick("modelId"), from: pick("from"), to: pick("to") }) });
});
