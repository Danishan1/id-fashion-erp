import { NextResponse } from "next/server";
import { sendSavedReportNow } from "@/modules/sales-marketing/analytics/analytics-delivery.service";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";

type P = { id: string };

/** Phase 17 — POST (owner) delivers the report to its recipients now: one copy each, with their own access. */
export const POST = salesMarketingRoute<P>({ module: "sales_analytics", action: "edit" }, async ({ actor, params }) => NextResponse.json({ data: await sendSavedReportNow(actor, params.id) }));
