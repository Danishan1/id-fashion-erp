import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { addSegmentMembers, listSegmentMembers, removeSegmentMembers } from "@/modules/sales-marketing/segments/segment.service";

/** GET ?kind=INCLUDED|EXCLUDED&page=&history=true: explicit members (and removed rows with history=true). */
export const GET = salesMarketingRoute<{ id: string }>({ module: "marketing_segments", action: "view" }, async ({ req, actor, params }) => {
  const sp = req.nextUrl.searchParams;
  const kind = sp.get("kind") === "EXCLUDED" ? "EXCLUDED" : "INCLUDED";
  const page = Math.max(1, Number(sp.get("page")) || 1);
  return NextResponse.json(await listSegmentMembers(actor, params.id, kind, page, 25, sp.get("history") === "true"));
});

/** POST { recordIds, kind, reason }: add members / manual exclusions (records you can see only). */
export const POST = salesMarketingRoute<{ id: string }>({ module: "marketing_segments", action: "edit" }, async ({ req, actor, params }) => {
  return NextResponse.json({ data: await addSegmentMembers(actor, params.id, await req.json()) });
});

/** DELETE { recordIds, kind }: remove (history is kept). */
export const DELETE = salesMarketingRoute<{ id: string }>({ module: "marketing_segments", action: "edit" }, async ({ req, actor, params }) => {
  return NextResponse.json({ data: await removeSegmentMembers(actor, params.id, await req.json()) });
});
