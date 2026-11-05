import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { resolveUnknown } from "@/modules/sales-marketing/delivery/delivery-run.service";
import { kickRun } from "@/modules/sales-marketing/delivery/delivery-dispatch";

/** POST { resolution: MARK_FAILED | RESEND, deliveryIds?, acknowledgeDuplicateRisk?, reason } */
export const POST = salesMarketingRoute<{ id: string }>({ module: "marketing_delivery", action: "edit" }, async ({ req, actor, params }) => {
  const res = await resolveUnknown(actor, params.id, await req.json());
  const mode = res.requeued ? await kickRun(res.id, "run.dispatch") : null;
  return NextResponse.json({ data: { ...res, mode } });
});
