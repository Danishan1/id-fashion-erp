import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { rotateWebhookToken } from "@/modules/sales-marketing/delivery/connection.service";

/** POST: new callback URL; the old one stops working at once. */
export const POST = salesMarketingRoute<{ id: string }>({ module: "sales_marketing_settings", action: "edit" }, async ({ actor, params }) => {
  return NextResponse.json({ data: await rotateWebhookToken(actor, params.id) });
});
