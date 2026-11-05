import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { versionAction } from "@/modules/sales-marketing/commissions/commission-plan.service";

/** POST submit | return-to-draft | send-back | approve | withdraw | discard — the service checks the action's permission. */
export const POST = salesMarketingRoute<{ id: string; versionId: string; action: string }>({ module: "sales_commissions", action: "view" }, async ({ req, actor, params }) => {
  const body = await req.json().catch(() => ({}));
  return NextResponse.json({ data: await versionAction(actor, params.id, params.versionId, params.action, body) });
});
