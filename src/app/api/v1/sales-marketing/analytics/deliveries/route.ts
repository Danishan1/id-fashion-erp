import { NextResponse } from "next/server";
import { listDeliveries } from "@/modules/sales-marketing/analytics/analytics-delivery.service";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";

/** Phase 17 — GET reports delivered to you (downloadable while valid) and the delivery log of reports you own. */
export const GET = salesMarketingRoute({ module: "sales_analytics", action: "view" }, async ({ actor }) => NextResponse.json({ data: await listDeliveries(actor) }));
