import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { startRun } from "@/modules/sales-marketing/delivery/delivery-run.service";
import { kickRun } from "@/modules/sales-marketing/delivery/delivery-dispatch";

/** POST { confirmed: true, scheduledFor?, idempotencyKey? }: send now or schedule. */
export const POST = salesMarketingRoute<{ channelId: string }>({ module: "marketing_delivery", action: "create" }, async ({ req, actor, params }) => {
  const { run, created } = await startRun(actor, params.channelId, await req.json());
  const mode = created ? await kickRun(run.id, "run.prepare") : null;
  return NextResponse.json({ data: { id: run.id, runNumber: run.runNumber, status: run.status, created, mode } }, { status: created ? 201 : 200 });
});
