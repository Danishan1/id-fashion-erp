import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { listRuns } from "@/modules/sales-marketing/delivery/delivery-run.service";

/** GET: runs (?status=A,B &campaignId= &page &pageSize). */
export const GET = salesMarketingRoute({ module: "marketing_delivery", action: "view" }, async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize")) || 25));
  return NextResponse.json(await listRuns(actor, { status: sp.get("status") ?? undefined, campaignId: sp.get("campaignId") ?? undefined }, page, pageSize));
});
