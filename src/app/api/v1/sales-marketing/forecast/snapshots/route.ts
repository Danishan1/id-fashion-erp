import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { createManualSnapshot, listSnapshots } from "@/modules/sales-marketing/forecast/forecast-snapshot.service";

/** GET ?periodType&kind: snapshots (figures in the viewer's scope). POST { periodType, periodStart, note }: save one now. */
export const GET = salesMarketingRoute({ module: "sales_performance", action: "view" }, async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  return NextResponse.json(await listSnapshots(actor, { periodType: sp.get("periodType") ?? "", kind: sp.get("kind") ?? "" }));
});

export const POST = salesMarketingRoute({ module: "sales_performance", action: "create" }, async ({ req, actor }) =>
  NextResponse.json({ data: await createManualSnapshot(actor, await req.json()) }, { status: 201 })
);
