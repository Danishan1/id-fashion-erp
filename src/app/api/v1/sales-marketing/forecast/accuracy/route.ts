import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getAccuracySummary } from "@/modules/sales-marketing/forecast/forecast-snapshot.service";

/** GET ?periodType: forecast accuracy over ended periods (automatic snapshots). */
export const GET = salesMarketingRoute({ module: "sales_performance", action: "view" }, async ({ req, actor }) =>
  NextResponse.json({ data: await getAccuracySummary(actor, { periodType: req.nextUrl.searchParams.get("periodType") ?? "" }) })
);
