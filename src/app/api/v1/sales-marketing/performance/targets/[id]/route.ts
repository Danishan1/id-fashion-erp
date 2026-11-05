import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getTarget } from "@/modules/sales-marketing/performance/target.service";

export const GET = salesMarketingRoute<{ id: string }>({ module: "sales_performance", action: "view" }, async ({ actor, params }) => NextResponse.json({ data: await getTarget(actor, params.id) }));
