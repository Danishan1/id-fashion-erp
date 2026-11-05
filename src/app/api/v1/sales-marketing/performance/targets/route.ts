import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { createTarget, listTargets } from "@/modules/sales-marketing/performance/target.service";

const FILTERS = ["periodType", "periodStart", "scope", "metric", "status", "userId", "territoryId"] as const;

/** GET: targets in the viewer's scope with live attainment. POST: new target (draft revision 1). */
export const GET = salesMarketingRoute({ module: "sales_performance", action: "view" }, async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  const result = await listTargets(actor, Object.fromEntries(FILTERS.map((k) => [k, sp.get(k) ?? ""])));
  return NextResponse.json(result);
});

export const POST = salesMarketingRoute({ module: "sales_performance", action: "create" }, async ({ req, actor }) =>
  NextResponse.json({ data: await createTarget(actor, await req.json()) }, { status: 201 })
);
