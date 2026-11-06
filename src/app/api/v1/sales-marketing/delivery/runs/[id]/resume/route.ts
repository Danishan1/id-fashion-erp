import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { resumeRun } from "@/modules/sales-marketing/delivery/delivery-run.service";
import { kickRun } from "@/modules/sales-marketing/delivery/delivery-dispatch";

/** POST: send again to recipients left pending or given up on after retries. */
export const POST = salesMarketingRoute<{ id: string }>({ module: "marketing_delivery", action: "edit" }, async ({ actor, params }) => {
  const res = await resumeRun(actor, params.id);
  const mode = await kickRun(res.id, "run.dispatch");
  return NextResponse.json({ data: { ...res, mode } });
});
