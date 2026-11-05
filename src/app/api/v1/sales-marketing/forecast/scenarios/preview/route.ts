import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { previewScenario } from "@/modules/sales-marketing/forecast/forecast-scenario.service";

/** POST { periodType, periodStart, assumptions }: baseline vs what-if, not saved. */
export const POST = salesMarketingRoute({ module: "sales_performance", action: "view" }, async ({ req, actor }) => NextResponse.json({ data: await previewScenario(actor, await req.json()) }));
