import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { searchSegmentCandidates } from "@/modules/sales-marketing/segments/segment.service";

/** GET ?search=: up to 25 records of the segment's type the user can see. */
export const GET = salesMarketingRoute<{ id: string }>({ module: "marketing_segments", action: "view" }, async ({ req, actor, params }) => {
  return NextResponse.json({ data: await searchSegmentCandidates(actor, params.id, req.nextUrl.searchParams.get("search") ?? "") });
});
