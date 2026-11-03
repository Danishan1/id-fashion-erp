import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { searchCustomersForTerritory } from "@/modules/sales-marketing/performance/territory.service";

/** GET ?q=: customers with their current territory (Add customers picker). */
export const GET = salesMarketingRoute({ module: "sales_performance", action: "edit" }, async ({ req, actor }) =>
  NextResponse.json({ data: await searchCustomersForTerritory(actor, req.nextUrl.searchParams.get("q") ?? "") })
);
