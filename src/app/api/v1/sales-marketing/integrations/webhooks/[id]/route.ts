import { NextResponse } from "next/server";
import { deleteSmSubscription, getSmSubscription, updateSmSubscription } from "@/modules/sales-marketing/integrations/sm-webhooks.service";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";

type P = { id: string };
export const GET = salesMarketingRoute<P>({ module: "sales_integrations", action: "view" }, async ({ actor, params }) => NextResponse.json({ data: await getSmSubscription(actor, params.id) }));
export const PATCH = salesMarketingRoute<P>({ module: "sales_integrations", action: "edit" }, async ({ req, actor, params }) => NextResponse.json({ data: await updateSmSubscription(actor, params.id, await req.json()) }));
export const DELETE = salesMarketingRoute<P>({ module: "sales_integrations", action: "edit" }, async ({ actor, params }) => NextResponse.json({ data: await deleteSmSubscription(actor, params.id) }));
