import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { saveDraftRevision } from "@/modules/sales-marketing/performance/target.service";

/** PATCH { targetValue, notes, version }: save a draft revision. */
export const PATCH = salesMarketingRoute<{ id: string; revisionId: string }>({ module: "sales_performance", action: "edit" }, async ({ req, actor, params }) =>
  NextResponse.json({ data: await saveDraftRevision(actor, params.id, params.revisionId, await req.json()) })
);
