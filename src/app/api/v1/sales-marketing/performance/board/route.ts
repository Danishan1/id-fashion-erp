import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getPerformanceBoard } from "@/modules/sales-marketing/performance/performance-board.service";

/** GET ?metric&periodType&periodStart: the team performance board in the viewer's scope. */
export const GET = salesMarketingRoute({ module: "sales_performance", action: "view" }, async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  return NextResponse.json({ data: await getPerformanceBoard(actor, { metric: sp.get("metric") ?? "", periodType: sp.get("periodType") ?? "", periodStart: sp.get("periodStart") ?? "" }) });
});
