import { NextResponse } from "next/server";
import { getIntegration, integrationAction } from "@/modules/sales-marketing/integrations/integrations.service";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";

type P = { id: string };
/** GET one integration (health, usage, callbacks, checkpoints, history). POST { action: enable | disable | check, reason? }. */
export const GET = salesMarketingRoute<P>({ module: "sales_integrations", action: "view" }, async ({ actor, params }) => NextResponse.json({ data: await getIntegration(actor, params.id) }));
export const POST = salesMarketingRoute<P>({ module: "sales_integrations", action: "edit" }, async ({ req, actor, params }) => NextResponse.json({ data: await integrationAction(actor, params.id, await req.json()) }));
