import { NextResponse } from "next/server";
import { integrationMetrics } from "@/modules/sales-marketing/integrations/integrations.service";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";

export const GET = salesMarketingRoute({ module: "sales_integrations", action: "view" }, async ({ actor }) => NextResponse.json({ data: await integrationMetrics(actor) }));
