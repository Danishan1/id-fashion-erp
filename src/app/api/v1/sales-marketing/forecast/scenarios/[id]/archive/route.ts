import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { archiveScenario } from "@/modules/sales-marketing/forecast/forecast-scenario.service";

export const POST = salesMarketingRoute<{ id: string }>({ module: "sales_performance", action: "edit" }, async ({ actor, params }) => NextResponse.json({ data: await archiveScenario(actor, params.id) }));
