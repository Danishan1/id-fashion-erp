import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { createConnection, listConnections } from "@/modules/sales-marketing/delivery/connection.service";

/** GET: connections (settings users see config + hints; delivery users only names). ?channelType= &activeOnly=1 */
export const GET = salesMarketingRoute([{ module: "sales_marketing_settings", action: "view" }, { module: "marketing_delivery", action: "view" }], async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  return NextResponse.json({ data: await listConnections(actor, { channelType: sp.get("channelType") ?? undefined, activeOnly: sp.get("activeOnly") === "1" }) });
});

/** POST: new connection. Secrets are write-only — never returned. */
export const POST = salesMarketingRoute({ module: "sales_marketing_settings", action: "edit" }, async ({ req, actor }) => {
  return NextResponse.json({ data: await createConnection(actor, await req.json()) }, { status: 201 });
});
