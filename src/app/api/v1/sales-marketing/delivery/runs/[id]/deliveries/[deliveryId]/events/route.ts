import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { listDeliveryEvents } from "@/modules/sales-marketing/delivery/delivery-run.service";

export const GET = salesMarketingRoute<{ id: string; deliveryId: string }>({ module: "marketing_delivery", action: "view" }, async ({ actor, params }) => {
  return NextResponse.json({ data: await listDeliveryEvents(actor, params.id, params.deliveryId) });
});
