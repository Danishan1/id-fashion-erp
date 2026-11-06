import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { createScenario, listScenarios } from "@/modules/sales-marketing/forecast/forecast-scenario.service";

/** GET ?archived=true|false: saved scenarios. POST: save a new one. */
export const GET = salesMarketingRoute({ module: "sales_performance", action: "view" }, async ({ req, actor }) =>
  NextResponse.json({ data: await listScenarios(actor, { archived: req.nextUrl.searchParams.get("archived") ?? "" }) })
);

export const POST = salesMarketingRoute({ module: "sales_performance", action: "create" }, async ({ req, actor }) =>
  NextResponse.json({ data: await createScenario(actor, await req.json()) }, { status: 201 })
);
