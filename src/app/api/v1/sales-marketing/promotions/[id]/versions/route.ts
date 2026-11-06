import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getPromotion, newVersion } from "@/modules/sales-marketing/promotions/promotion.service";

/** POST: a new draft version, copied from the latest one. */
export const POST = salesMarketingRoute<{ id: string }>({ module: "marketing_promotions", action: "view" }, async ({ actor, params }) => {
  await newVersion(actor, params.id);
  return NextResponse.json({ data: await getPromotion(actor, params.id) }, { status: 201 });
});
