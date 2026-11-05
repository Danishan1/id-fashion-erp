import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { assignCustomers } from "@/modules/sales-marketing/performance/territory.service";

/** POST: add customers { customerIds, move }. */
export const POST = salesMarketingRoute<{ id: string }>({ module: "sales_performance", action: "edit" }, async ({ req, actor, params }) =>
  NextResponse.json({ data: await assignCustomers(actor, params.id, await req.json()) })
);
