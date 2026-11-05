import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { listRunDeliveries } from "@/modules/sales-marketing/delivery/delivery-run.service";

/** GET: recipients of a run (?status= &page &pageSize). Addresses masked without view_all. */
export const GET = salesMarketingRoute<{ id: string }>({ module: "marketing_delivery", action: "view" }, async ({ req, actor, params }) => {
  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(sp.get("pageSize")) || 50));
  return NextResponse.json(await listRunDeliveries(actor, params.id, { status: sp.get("status") ?? undefined }, page, pageSize));
});
