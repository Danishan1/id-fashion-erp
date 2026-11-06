import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getPromotion, promotionAction } from "@/modules/sales-marketing/promotions/promotion.service";

/** POST activate | pause | archive { comment? } — the service checks each action's permission and state. */
export const POST = salesMarketingRoute<{ id: string; action: string }>({ module: "marketing_promotions", action: "view" }, async ({ req, actor, params }) => {
  await promotionAction(actor, params.id, params.action, await req.json().catch(() => ({})));
  return NextResponse.json({ data: await getPromotion(actor, params.id) });
});
