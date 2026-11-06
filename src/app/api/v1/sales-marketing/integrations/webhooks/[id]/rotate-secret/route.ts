import { NextResponse } from "next/server";
import { rotateSmSubscriptionSecret } from "@/modules/sales-marketing/integrations/sm-webhooks.service";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";

export const POST = salesMarketingRoute<{ id: string }>({ module: "sales_integrations", action: "edit" }, async ({ req, actor, params }) => NextResponse.json({ data: await rotateSmSubscriptionSecret(actor, params.id, await req.json()) }, { headers: { "Cache-Control": "no-store" } }));
