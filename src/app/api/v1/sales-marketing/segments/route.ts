import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { createSegment, listSegments } from "@/modules/sales-marketing/segments/segment.service";

/** GET: segments the user can see (status=A,B sourceType segmentType ownerUserId search activeOnly; page, pageSize). */
export const GET = salesMarketingRoute({ module: "marketing_segments", action: "view" }, async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize")) || 25));
  const { page: _p, pageSize: _s, sortBy: _b, sortOrder: _o, ...filters } = Object.fromEntries(sp);
  void _p; void _s; void _b; void _o;
  return NextResponse.json(await listSegments(actor, filters, page, pageSize));
});

/** POST: new segment (version 1); a repeated idempotencyKey returns the first one. */
export const POST = salesMarketingRoute({ module: "marketing_segments", action: "create" }, async ({ req, actor }) => {
  return NextResponse.json({ data: await createSegment(actor, await req.json()) }, { status: 201 });
});
