import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { listTerritoryOptions } from "@/modules/sales-marketing/performance/territory.service";

/** GET: active territories for pickers. */
export const GET = salesMarketingRoute([{ module: "sales_performance", action: "view" }], async ({ actor }) => NextResponse.json({ data: await listTerritoryOptions(actor) }));
