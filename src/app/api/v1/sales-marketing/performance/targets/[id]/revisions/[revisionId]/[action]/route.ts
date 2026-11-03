import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { revisionAction } from "@/modules/sales-marketing/performance/target.service";

/**
 * POST: submit | return-to-draft | send-back | approve | discard. The service
 * checks the action's own permission (edit / reject / approve).
 */
export const POST = salesMarketingRoute<{ id: string; revisionId: string; action: string }>({ module: "sales_performance", action: "view" }, async ({ req, actor, params }) =>
  NextResponse.json({ data: await revisionAction(actor, params.id, params.revisionId, params.action, await req.json().catch(() => ({}))) })
);
