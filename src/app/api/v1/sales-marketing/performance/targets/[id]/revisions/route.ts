import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { startNewRevision } from "@/modules/sales-marketing/performance/target.service";

/** POST: start a new draft revision copied from the latest one. */
export const POST = salesMarketingRoute<{ id: string }>({ module: "sales_performance", action: "edit" }, async ({ actor, params }) =>
  NextResponse.json({ data: await startNewRevision(actor, params.id) }, { status: 201 })
);
