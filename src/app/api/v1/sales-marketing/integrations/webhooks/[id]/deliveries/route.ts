import { NextResponse } from "next/server";
import { listSmDeliveries } from "@/modules/sales-marketing/integrations/sm-webhooks.service";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";

/** Delivery log: ?status=&skip=&take= (take ≤ 100). Outcomes only, never payloads. */
export const GET = salesMarketingRoute<{ id: string }>({ module: "sales_integrations", action: "view" }, async ({ req, actor, params }) => {
  const sp = req.nextUrl.searchParams;
  const skip = Math.max(0, Number(sp.get("skip") ?? 0) || 0);
  const take = Math.min(100, Math.max(1, Number(sp.get("take") ?? 25) || 25));
  return NextResponse.json({ data: await listSmDeliveries(actor, params.id, { status: sp.get("status") ?? undefined, skip, take }) });
});
