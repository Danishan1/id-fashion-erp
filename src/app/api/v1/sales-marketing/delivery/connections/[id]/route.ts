import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getConnection, updateConnection } from "@/modules/sales-marketing/delivery/connection.service";

export const GET = salesMarketingRoute<{ id: string }>({ module: "sales_marketing_settings", action: "view" }, async ({ actor, params }) => {
  return NextResponse.json({ data: await getConnection(actor, params.id) });
});

/** PATCH: settings and limits (with `version`); an omitted secret keeps its value, "" clears it. */
export const PATCH = salesMarketingRoute<{ id: string }>({ module: "sales_marketing_settings", action: "edit" }, async ({ req, actor, params }) => {
  return NextResponse.json({ data: await updateConnection(actor, params.id, await req.json()) });
});
