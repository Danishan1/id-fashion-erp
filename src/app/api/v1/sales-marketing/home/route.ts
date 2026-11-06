import { NextResponse } from "next/server";
import { getSalesMarketingHome } from "@/modules/sales-marketing/sales-marketing-home.service";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";

/**
 * GET /api/v1/sales-marketing/home?preset=this_month — the Sales & Marketing
 * dashboard: KPIs vs the previous period, trend, funnel, work queue, team &
 * targets, system health. Same governed metrics as Analytics; every tile in
 * the viewer's own scope, hidden (with the reason) when not visible.
 */
export const GET = salesMarketingRoute(
  [
    { module: "sales_marketing", action: "view" },
    { module: "sales_quotations", action: "view" },
  ],
  async ({ req, actor }) => {
    const preset = req.nextUrl.searchParams.get("preset");
    return NextResponse.json({ data: await getSalesMarketingHome(actor, preset ? { preset } : {}) });
  }
);
