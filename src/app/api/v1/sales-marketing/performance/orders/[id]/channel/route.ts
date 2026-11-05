import { NextResponse } from "next/server";
import { PermissionService } from "@/core/rbac/PermissionService";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getDocumentChannel, setDocumentChannel } from "@/modules/sales-marketing/channels/sales-channel.service";

type P = { id: string };

/** GET: the order's channel and sales agent with the change history (needs sales_orders.view). */
export const GET = salesMarketingRoute<P>({ module: "sales_performance", action: "view" }, async ({ actor, params }) => {
  await PermissionService.assert(actor.userId, "sales_orders", "view");
  return NextResponse.json({ data: await getDocumentChannel(actor, "SALES_ORDER", params.id) });
});

/** PATCH { salesChannelId, salesAgentId, reason } (sales_performance.edit). */
export const PATCH = salesMarketingRoute<P>({ module: "sales_performance", action: "edit" }, async ({ req, actor, params }) =>
  NextResponse.json({ data: await setDocumentChannel(actor, "SALES_ORDER", params.id, await req.json()) })
);
