import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getDiscountRule, updateDiscountRule } from "@/modules/sales-marketing/pricing/discount-rule.service";

/** GET: rule + history. PUT: edit a draft / inactive rule (with the `version` loaded). */
export const GET = salesMarketingRoute<{ id: string }>({ module: "sales_pricing", action: "view" }, async ({ actor, params }) =>
  NextResponse.json({ data: await getDiscountRule(actor, params.id) })
);

export const PUT = salesMarketingRoute<{ id: string }>({ module: "sales_pricing", action: "edit" }, async ({ req, actor, params }) =>
  NextResponse.json({ data: await updateDiscountRule(actor, params.id, await req.json()) })
);
