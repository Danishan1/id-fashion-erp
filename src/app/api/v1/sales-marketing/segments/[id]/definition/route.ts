import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getSegment, saveSegmentDefinition } from "@/modules/sales-marketing/segments/segment.service";

/** PUT { criteria, exclusionCriteria, eligibilityChannel, changeNote, version }: a change adds definition version N+1. */
export const PUT = salesMarketingRoute<{ id: string }>({ module: "marketing_segments", action: "edit" }, async ({ req, actor, params }) => {
  const r = await saveSegmentDefinition(actor, params.id, await req.json());
  return NextResponse.json({ data: { changed: r.changed, versionNumber: r.versionNumber, segment: await getSegment(actor, params.id) } });
});
