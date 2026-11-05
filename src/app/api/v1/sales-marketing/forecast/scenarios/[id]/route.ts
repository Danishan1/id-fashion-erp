import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getScenario, updateScenario } from "@/modules/sales-marketing/forecast/forecast-scenario.service";

type P = { id: string };

export const GET = salesMarketingRoute<P>({ module: "sales_performance", action: "view" }, async ({ actor, params }) => NextResponse.json({ data: await getScenario(actor, params.id) }));

export const PATCH = salesMarketingRoute<P>({ module: "sales_performance", action: "edit" }, async ({ req, actor, params }) =>
  NextResponse.json({ data: await updateScenario(actor, params.id, await req.json()) })
);
