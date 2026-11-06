import { NextResponse } from "next/server";
import { runAdHoc } from "@/modules/sales-marketing/analytics/analytics-reports.service";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";

/** Phase 17 — POST a governed report query (dataset, metrics, dimensions, filters, from/to or a relative `preset`); runs with your permissions. */
export const POST = salesMarketingRoute({ module: "sales_analytics", action: "view" }, async ({ req, actor }) => NextResponse.json({ data: await runAdHoc(actor, await req.json()) }));
