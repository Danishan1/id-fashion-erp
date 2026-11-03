import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getSnapshot } from "@/modules/sales-marketing/forecast/forecast-snapshot.service";

export const GET = salesMarketingRoute<{ id: string }>({ module: "sales_performance", action: "view" }, async ({ actor, params }) => NextResponse.json({ data: await getSnapshot(actor, params.id) }));
