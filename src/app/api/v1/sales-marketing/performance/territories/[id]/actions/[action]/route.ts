import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { territoryAction } from "@/modules/sales-marketing/performance/territory.service";

/** POST: deactivate | reactivate. */
export const POST = salesMarketingRoute<{ id: string; action: string }>({ module: "sales_performance", action: "edit" }, async ({ actor, params }) =>
  NextResponse.json({ data: await territoryAction(actor, params.id, params.action) })
);
