import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { promotionFormOptions } from "@/modules/sales-marketing/promotions/promotion.service";

/** GET: choices for the promotion terms editor. */
export const GET = salesMarketingRoute({ module: "marketing_promotions", action: "view" }, async ({ actor }) => NextResponse.json({ data: await promotionFormOptions(actor) }));
