import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { validateSegmentDefinition } from "@/modules/sales-marketing/segments/segment.service";

/** POST { sourceType, segmentType, criteria, exclusionCriteria }: server-side check, nothing saved. */
export const POST = salesMarketingRoute({ module: "marketing_segments", action: "view" }, async ({ req, actor }) => {
  return NextResponse.json({ data: await validateSegmentDefinition(actor, await req.json()) });
});
