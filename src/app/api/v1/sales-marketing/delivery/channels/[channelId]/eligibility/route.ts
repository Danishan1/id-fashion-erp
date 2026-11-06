import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { previewEligibility } from "@/modules/sales-marketing/delivery/delivery-run.service";

/** GET: who would receive it now (counts only), before a Send. */
export const GET = salesMarketingRoute<{ channelId: string }>({ module: "marketing_delivery", action: "view" }, async ({ actor, params }) => {
  return NextResponse.json({ data: await previewEligibility(actor, params.channelId) });
});
