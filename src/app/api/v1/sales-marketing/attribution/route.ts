import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { attributionReport } from "@/modules/sales-marketing/attribution/attribution-report.service";

/** GET ?modelId=&compareModelId=&basis=&from=&to=&campaignId=: attribution & ROI by campaign from the model's newest completed run. */
export const GET = salesMarketingRoute({ module: "marketing_attribution", action: "view" }, async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  const pick = (k: string) => sp.get(k) || undefined;
  return NextResponse.json({ data: await attributionReport(actor, { modelId: pick("modelId"), compareModelId: pick("compareModelId"), basis: pick("basis"), from: pick("from"), to: pick("to"), campaignId: pick("campaignId") }) });
});
