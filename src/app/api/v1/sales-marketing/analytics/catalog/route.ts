import { NextResponse } from "next/server";
import { catalog } from "@/modules/sales-marketing/analytics/analytics.service";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";

/** Phase 17 — GET datasets, governed metrics (definitions, versions) and the viewer's access to each. */
export const GET = salesMarketingRoute({ module: "sales_analytics", action: "view" }, async ({ actor }) => NextResponse.json({ data: await catalog(actor) }));
