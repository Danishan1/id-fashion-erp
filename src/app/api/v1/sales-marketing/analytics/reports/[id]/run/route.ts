import { NextResponse } from "next/server";
import { runSavedReport } from "@/modules/sales-marketing/analytics/analytics-reports.service";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";

type P = { id: string };

/** Phase 17 — POST runs a saved report for its current period, with YOUR permissions. */
export const POST = salesMarketingRoute<P>({ module: "sales_analytics", action: "view" }, async ({ actor, params }) => NextResponse.json({ data: await runSavedReport(actor, params.id) }));
