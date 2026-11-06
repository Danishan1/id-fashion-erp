import { NextResponse } from "next/server";
import { usageSummary } from "@/modules/sales-marketing/analytics/analytics-reports.service";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";

/** Phase 17 — GET (S&M admins) report usage, slow runs and failures by dataset, last 30 days. */
export const GET = salesMarketingRoute({ module: "sales_marketing_settings", action: "edit" }, async ({ actor }) => NextResponse.json({ data: await usageSummary(actor) }));
