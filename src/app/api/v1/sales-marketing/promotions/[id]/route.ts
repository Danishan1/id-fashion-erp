import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getPromotion, updatePromotionHeader } from "@/modules/sales-marketing/promotions/promotion.service";

type P = { id: string };

export const GET = salesMarketingRoute<P>({ module: "marketing_promotions", action: "view" }, async ({ actor, params }) => NextResponse.json({ data: await getPromotion(actor, params.id) }));

/** PATCH { name, description, objective, ownerUserId?, version }: the header (terms live on versions). */
export const PATCH = salesMarketingRoute<P>({ module: "marketing_promotions", action: "edit" }, async ({ req, actor, params }) => {
  await updatePromotionHeader(actor, params.id, await req.json());
  return NextResponse.json({ data: await getPromotion(actor, params.id) });
});
