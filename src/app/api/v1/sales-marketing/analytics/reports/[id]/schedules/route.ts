import { NextResponse } from "next/server";
import { listReportSchedules, scheduleSavedReport } from "@/modules/sales-marketing/analytics/analytics-delivery.service";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";

type P = { id: string };

/**
 * Phase 17 — GET this report's delivery schedules; POST { frequency, timeOfDay, dayOfWeek?, dayOfMonth? }
 * (owner) schedules delivery on the Phase 14 engine. Pause / resume / delete: /api/v1/bulk-schedules/[id].
 */
export const GET = salesMarketingRoute<P>({ module: "sales_analytics", action: "view" }, async ({ actor, params }) => NextResponse.json({ data: await listReportSchedules(actor, params.id) }));
export const POST = salesMarketingRoute<P>({ module: "sales_analytics", action: "edit" }, async ({ req, actor, params }) => NextResponse.json({ data: await scheduleSavedReport(actor, params.id, await req.json()) }, { status: 201 }));
