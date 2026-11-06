import { NextResponse } from "next/server";
import { createSmApiKey, listSmApiKeys } from "@/modules/sales-marketing/integrations/sm-api-keys.service";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";

/** S&M API keys. POST returns the full key once (`keyOnce`) — never again. */
export const GET = salesMarketingRoute({ module: "sales_integrations", action: "view" }, async ({ actor }) => NextResponse.json({ data: await listSmApiKeys(actor) }));
export const POST = salesMarketingRoute({ module: "sales_integrations", action: "edit" }, async ({ req, actor }) => NextResponse.json({ data: await createSmApiKey(actor, await req.json()) }, { status: 201, headers: { "Cache-Control": "no-store" } }));
