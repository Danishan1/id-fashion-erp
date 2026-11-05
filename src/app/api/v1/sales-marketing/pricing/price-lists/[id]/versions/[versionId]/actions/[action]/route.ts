import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { priceVersionAction } from "@/modules/sales-marketing/pricing/price-list.service";

/** POST: submit | return-to-draft | approve | decline | withdraw | discard. Each action checks its own sales_pricing permission. */
export const POST = salesMarketingRoute<{ id: string; versionId: string; action: string }>({ module: "sales_pricing", action: "view" }, async ({ req, actor, params }) =>
  NextResponse.json({ data: await priceVersionAction(actor, params.id, params.versionId, params.action, await req.json().catch(() => ({}))) })
);
