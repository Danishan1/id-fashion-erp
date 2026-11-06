import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { previewSegment } from "@/modules/sales-marketing/segments/segment.service";

/** POST { draft?, show?, page? }: live counts + a page of records. Writes nothing. */
export const POST = salesMarketingRoute<{ id: string }>({ module: "marketing_segments", action: "view" }, async ({ req, actor, params }) => {
  return NextResponse.json({ data: await previewSegment(actor, params.id, await req.json().catch(() => ({}))) });
});
