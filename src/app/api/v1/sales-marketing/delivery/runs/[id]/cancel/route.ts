import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { cancelRun } from "@/modules/sales-marketing/delivery/delivery-run.service";

/** POST { reason } */
export const POST = salesMarketingRoute<{ id: string }>({ module: "marketing_delivery", action: "cancel" }, async ({ req, actor, params }) => {
  return NextResponse.json({ data: await cancelRun(actor, params.id, await req.json()) });
});
