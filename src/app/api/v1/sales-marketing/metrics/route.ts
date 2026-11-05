import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getSalesMarketingMetrics } from "@/modules/sales-marketing/sales-marketing-metrics.service";

/**
 * GET /api/v1/sales-marketing/metrics?days=30|90|365 — dashboard KPIs in the
 * viewer's own scope (enquiries / quotations / orders only where the viewer
 * can see them). Definitions: sales-marketing-metrics.service.ts.
 */
export const GET = salesMarketingRoute(
  [
    { module: "sales_marketing", action: "view" },
    { module: "sales_quotations", action: "view" },
  ],
  async ({ req, actor }) => NextResponse.json({ data: await getSalesMarketingMetrics(actor, Number(req.nextUrl.searchParams.get("days")) || 90) })
);
