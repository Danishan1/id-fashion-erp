import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { duplicateSegment } from "@/modules/sales-marketing/segments/segment.service";

/** POST { code, name }: a new DRAFT copy (definition + explicit members). */
export const POST = salesMarketingRoute<{ id: string }>({ module: "marketing_segments", action: "create" }, async ({ req, actor, params }) => {
  return NextResponse.json({ data: await duplicateSegment(actor, params.id, await req.json()) }, { status: 201 });
});
