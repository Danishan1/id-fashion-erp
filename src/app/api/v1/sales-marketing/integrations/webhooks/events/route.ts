import { NextResponse } from "next/server";
import { smEventCatalogue } from "@/modules/sales-marketing/integrations/sm-webhooks.service";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";

export const GET = salesMarketingRoute({ module: "sales_integrations", action: "view" }, async () => NextResponse.json({ data: smEventCatalogue() }));
