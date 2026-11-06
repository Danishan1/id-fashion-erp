import { NextResponse } from "next/server";
import { createSmSubscription, listSmSubscriptions } from "@/modules/sales-marketing/integrations/sm-webhooks.service";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";

/** Outgoing webhooks for S&M events. POST returns the signing secret once (`secretOnce`). */
export const GET = salesMarketingRoute({ module: "sales_integrations", action: "view" }, async ({ actor }) => NextResponse.json({ data: await listSmSubscriptions(actor) }));
export const POST = salesMarketingRoute({ module: "sales_integrations", action: "edit" }, async ({ req, actor }) => NextResponse.json({ data: await createSmSubscription(actor, await req.json()) }, { status: 201, headers: { "Cache-Control": "no-store" } }));
