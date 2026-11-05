import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { archiveTarget } from "@/modules/sales-marketing/performance/target.service";

/** POST { reason }: archive the target. */
export const POST = salesMarketingRoute<{ id: string }>({ module: "sales_performance", action: "edit" }, async ({ req, actor, params }) =>
  NextResponse.json({ data: await archiveTarget(actor, params.id, await req.json().catch(() => ({}))) })
);
