import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getTerritory, updateTerritory } from "@/modules/sales-marketing/performance/territory.service";

type P = { id: string };

export const GET = salesMarketingRoute<P>({ module: "sales_performance", action: "view" }, async ({ actor, params }) => NextResponse.json({ data: await getTerritory(actor, params.id) }));

export const PATCH = salesMarketingRoute<P>({ module: "sales_performance", action: "edit" }, async ({ req, actor, params }) =>
  NextResponse.json({ data: await updateTerritory(actor, params.id, await req.json()) })
);
