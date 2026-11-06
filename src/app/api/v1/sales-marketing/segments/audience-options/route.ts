import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { audienceSegmentOptions } from "@/modules/sales-marketing/segments/campaign-audience.service";

/** GET: active segments the user can see, for a campaign's audience picker. */
export const GET = salesMarketingRoute({ module: "marketing_segments", action: "view" }, async ({ actor }) => {
  return NextResponse.json({ data: await audienceSegmentOptions(actor) });
});
