import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { keepSnapshot } from "@/modules/sales-marketing/segments/segment-evaluation.service";

/** PATCH { keep, label }: keep a snapshot beyond the retention window (or release it). */
export const PATCH = salesMarketingRoute<{ evaluationId: string }>({ module: "marketing_segments", action: "edit" }, async ({ req, actor, params }) => {
  return NextResponse.json({ data: await keepSnapshot(actor, params.evaluationId, await req.json()) });
});
