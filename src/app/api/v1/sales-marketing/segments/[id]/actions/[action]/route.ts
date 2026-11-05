import { NextResponse } from "next/server";
import { z } from "zod";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getSegment, segmentAction } from "@/modules/sales-marketing/segments/segment.service";

/** POST activate | pause | archive — the service checks each action's permission (archive = delete). */
export const POST = salesMarketingRoute<{ id: string; action: string }>({ module: "marketing_segments", action: "view" }, async ({ req, actor, params }) => {
  const action = z.enum(["activate", "pause", "archive"]).parse(params.action);
  await segmentAction(actor, params.id, action, await req.json().catch(() => ({})));
  return NextResponse.json({ data: await getSegment(actor, params.id) });
});
