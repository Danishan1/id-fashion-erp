import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { priceListAction } from "@/modules/sales-marketing/pricing/price-list.service";

/** POST: deactivate | reactivate (sales_pricing.edit). */
export const POST = salesMarketingRoute<{ id: string; action: string }>({ module: "sales_pricing", action: "edit" }, async ({ actor, params }) =>
  NextResponse.json({ data: await priceListAction(actor, params.id, params.action) })
);
