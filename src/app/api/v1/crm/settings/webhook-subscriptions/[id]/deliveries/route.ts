import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { listDeliveries } from "@/modules/crm/webhooks-out/crm-webhook-subscriptions.service";

/** Delivery log (newest first). ?status=&skip=&take= — outcome only, never the request body or the receiver's response. */
export const GET = crmRoute<{ id: string }>({ module: "crm_settings", action: "view" }, async ({ req, params, actor }) => {
  const sp = req.nextUrl.searchParams;
  const skip = Math.max(0, Number.parseInt(sp.get("skip") ?? "0", 10) || 0);
  const take = Math.min(100, Math.max(1, Number.parseInt(sp.get("take") ?? "25", 10) || 25));
  return NextResponse.json({ data: await listDeliveries(actor, params.id, { status: sp.get("status") ?? undefined, skip, take }) });
});
