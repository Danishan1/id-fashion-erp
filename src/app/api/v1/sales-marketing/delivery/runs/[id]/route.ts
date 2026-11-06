import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getRun } from "@/modules/sales-marketing/delivery/delivery-run.service";

export const GET = salesMarketingRoute<{ id: string }>({ module: "marketing_delivery", action: "view" }, async ({ actor, params }) => {
  return NextResponse.json({ data: await getRun(actor, params.id) });
});
