import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { incentivePlanAction } from "@/modules/sales-marketing/commissions/incentive-plan.service";

/** POST submit | return-to-draft | send-back | approve | retire | discard — the service checks the action's permission. */
export const POST = salesMarketingRoute<{ id: string; action: string }>({ module: "sales_commissions", action: "view" }, async ({ req, actor, params }) => {
  const body = await req.json().catch(() => ({}));
  return NextResponse.json({ data: await incentivePlanAction(actor, params.id, params.action, body) });
});
