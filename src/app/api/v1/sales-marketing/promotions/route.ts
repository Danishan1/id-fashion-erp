import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { createPromotion, listPromotions } from "@/modules/sales-marketing/promotions/promotion.service";

/** GET ?status=&search=: promotions (archived hidden unless asked). POST: header + version 1 as a draft. */
export const GET = salesMarketingRoute({ module: "marketing_promotions", action: "view" }, async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  return NextResponse.json({ data: await listPromotions(actor, { status: sp.get("status") || undefined, search: sp.get("search") || undefined }) });
});

export const POST = salesMarketingRoute({ module: "marketing_promotions", action: "create" }, async ({ req, actor }) =>
  NextResponse.json({ data: await createPromotion(actor, await req.json()) }, { status: 201 })
);
