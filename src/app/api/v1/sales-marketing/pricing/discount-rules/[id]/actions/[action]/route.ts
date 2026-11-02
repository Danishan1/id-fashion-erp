import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { discountRuleAction } from "@/modules/sales-marketing/pricing/discount-rule.service";

/** POST: submit | return-to-draft | approve | decline | deactivate. Each action checks its own sales_pricing permission. */
export const POST = salesMarketingRoute<{ id: string; action: string }>({ module: "sales_pricing", action: "view" }, async ({ req, actor, params }) =>
  NextResponse.json({ data: await discountRuleAction(actor, params.id, params.action, await req.json().catch(() => ({}))) })
);
