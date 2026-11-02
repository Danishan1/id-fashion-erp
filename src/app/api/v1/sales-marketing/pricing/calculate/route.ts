import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { calculatePrices } from "@/modules/sales-marketing/pricing/pricing.service";

/**
 * POST /api/v1/sales-marketing/pricing/calculate — prices up to 200 lines for
 * one customer (or prospect) on one date, with explanations. Read-only, safe to
 * retry. Needs sales_pricing.view or sales_quotations.create / edit.
 */
export const POST = salesMarketingRoute(
  [
    { module: "sales_pricing", action: "view" },
    { module: "sales_quotations", action: "create" },
    { module: "sales_quotations", action: "edit" },
  ],
  async ({ req, actor }) =>
  NextResponse.json({ data: await calculatePrices(actor, await req.json().catch(() => ({}))) })
);
