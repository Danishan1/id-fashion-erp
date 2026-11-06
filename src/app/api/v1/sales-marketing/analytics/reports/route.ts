import { NextResponse } from "next/server";
import { createSavedReport, listSavedReports } from "@/modules/sales-marketing/analytics/analytics-reports.service";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";

/** Phase 17 — GET saved reports you own or that are shared with you; POST save a report (definition only, never SQL). */
export const GET = salesMarketingRoute({ module: "sales_analytics", action: "view" }, async ({ actor }) => NextResponse.json({ data: await listSavedReports(actor) }));
export const POST = salesMarketingRoute({ module: "sales_analytics", action: "create" }, async ({ req, actor }) => NextResponse.json({ data: await createSavedReport(actor, await req.json()) }, { status: 201 }));
