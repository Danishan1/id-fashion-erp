import { NextResponse } from "next/server";
import { PermissionService } from "@/core/rbac/PermissionService";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { changeSalesCredit, getSalesCredit } from "@/modules/sales-marketing/performance/sales-credit.service";

type P = { id: string };

/** GET: the order's sales credit and its change history (needs sales_orders.view). */
export const GET = salesMarketingRoute<P>({ module: "sales_performance", action: "view" }, async ({ actor, params }) => {
  await PermissionService.assert(actor.userId, "sales_orders", "view");
  return NextResponse.json({ data: await getSalesCredit(actor, params.id) });
});

/** PATCH { salesRepUserId, salesTerritoryId, reason }: change it (sales_performance.edit). */
export const PATCH = salesMarketingRoute<P>({ module: "sales_performance", action: "edit" }, async ({ req, actor, params }) =>
  NextResponse.json({ data: await changeSalesCredit(actor, params.id, await req.json()) })
);
