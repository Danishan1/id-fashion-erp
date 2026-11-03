import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getForecast } from "@/modules/sales-marketing/forecast/forecast.service";

/** GET ?periodType&periodStart: the live forecast in the viewer's scope. */
export const GET = salesMarketingRoute({ module: "sales_performance", action: "view" }, async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  return NextResponse.json({ data: await getForecast(actor, { periodType: sp.get("periodType") ?? "", periodStart: sp.get("periodStart") ?? "" }) });
});
