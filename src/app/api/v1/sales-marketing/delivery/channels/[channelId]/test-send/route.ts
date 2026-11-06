import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { sendTestMessage } from "@/modules/sales-marketing/delivery/delivery-run.service";

/** POST { to }: one [TEST] message with sample data; not stored as a delivery. */
export const POST = salesMarketingRoute<{ channelId: string }>({ module: "marketing_delivery", action: "create" }, async ({ req, actor, params }) => {
  return NextResponse.json({ data: await sendTestMessage(actor, params.channelId, await req.json()) });
});
