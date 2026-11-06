import { NextResponse } from "next/server";
import { z } from "zod";
import { drillLogged } from "@/modules/sales-marketing/analytics/analytics-reports.service";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";

const body = z.object({ query: z.unknown(), keys: z.record(z.string().max(40), z.string().max(100).nullable()).default({}) }).strict();

/** Phase 17 — POST { query, keys } → the source records behind one result row (visibility re-applied). */
export const POST = salesMarketingRoute({ module: "sales_analytics", action: "view" }, async ({ req, actor }) => {
  const b = body.parse(await req.json());
  return NextResponse.json({ data: await drillLogged(actor, b.query, b.keys) });
});
