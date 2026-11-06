import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getSegment, updateSegment } from "@/modules/sales-marketing/segments/segment.service";

export const GET = salesMarketingRoute<{ id: string }>({ module: "marketing_segments", action: "view" }, async ({ actor, params }) => {
  return NextResponse.json({ data: await getSegment(actor, params.id) });
});

/** PATCH: name, description, purpose, owner, refresh schedule (with `version`). */
export const PATCH = salesMarketingRoute<{ id: string }>({ module: "marketing_segments", action: "edit" }, async ({ req, actor, params }) => {
  await updateSegment(actor, params.id, await req.json());
  return NextResponse.json({ data: await getSegment(actor, params.id) });
});
