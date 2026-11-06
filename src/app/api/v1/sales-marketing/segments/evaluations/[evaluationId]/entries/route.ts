import { NextResponse } from "next/server";
import { z } from "zod";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { listSnapshotEntries } from "@/modules/sales-marketing/segments/segment-evaluation.service";

/** GET ?outcome=INCLUDED|EXCLUDED|INELIGIBLE&page=: a completed snapshot's records. */
export const GET = salesMarketingRoute<{ evaluationId: string }>({ module: "marketing_segments", action: "view" }, async ({ req, actor, params }) => {
  const sp = req.nextUrl.searchParams;
  const outcome = z.enum(["INCLUDED", "EXCLUDED", "INELIGIBLE"]).catch("INCLUDED").parse(sp.get("outcome"));
  return NextResponse.json(await listSnapshotEntries(actor, params.evaluationId, outcome, Math.max(1, Number(sp.get("page")) || 1)));
});
