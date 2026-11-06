import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getPromotion, saveVersionTerms } from "@/modules/sales-marketing/promotions/promotion.service";

/** PATCH: save a draft version's terms. */
export const PATCH = salesMarketingRoute<{ id: string; versionId: string }>({ module: "marketing_promotions", action: "edit" }, async ({ req, actor, params }) => {
  await saveVersionTerms(actor, params.id, params.versionId, await req.json());
  return NextResponse.json({ data: await getPromotion(actor, params.id) });
});
