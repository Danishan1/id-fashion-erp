import { NextResponse } from "next/server";
import { runDashboard } from "@/modules/sales-marketing/analytics/analytics-dashboards.service";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";

type P = { key: string };

/** Phase 17 — GET ?preset= one standard dashboard, every widget run with your permissions. */
export const GET = salesMarketingRoute<P>({ module: "sales_analytics", action: "view" }, async ({ req, actor, params }) => {
  const preset = req.nextUrl.searchParams.get("preset");
  return NextResponse.json({ data: await runDashboard(actor, params.key, preset ? { preset } : {}) });
});
