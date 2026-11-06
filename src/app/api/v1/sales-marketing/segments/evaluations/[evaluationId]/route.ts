import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getSegmentEvaluation } from "@/modules/sales-marketing/segments/segment-evaluation.service";

/** GET: one evaluation / snapshot with its outcome breakdown (poll this while it runs). */
export const GET = salesMarketingRoute<{ evaluationId: string }>({ module: "marketing_segments", action: "view" }, async ({ actor, params }) => {
  return NextResponse.json({ data: await getSegmentEvaluation(actor, params.evaluationId) });
});
