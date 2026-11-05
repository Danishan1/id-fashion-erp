import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { channelSetupOptions } from "@/modules/sales-marketing/delivery/delivery-run.service";

/** GET: active connections and active message templates for the campaign channel picker. */
export const GET = salesMarketingRoute({ module: "marketing_delivery", action: "create" }, async ({ actor }) => {
  return NextResponse.json({ data: await channelSetupOptions(actor) });
});
