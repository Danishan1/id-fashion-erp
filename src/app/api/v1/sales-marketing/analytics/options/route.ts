import { NextResponse } from "next/server";
import { dimensionOptions } from "@/modules/sales-marketing/analytics/analytics.service";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";

/** Phase 17 — GET ?dataset=&dimension=&search= filter choices for one dimension. */
export const GET = salesMarketingRoute({ module: "sales_analytics", action: "view" }, async ({ req, actor }) => {
  const p = req.nextUrl.searchParams;
  return NextResponse.json({ data: await dimensionOptions(actor, { dataset: p.get("dataset") ?? "", dimension: p.get("dimension") ?? "", ...(p.get("search") ? { search: p.get("search")! } : {}) }) });
});
