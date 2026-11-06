import { after, NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { requestRun, executeRun } from "@/modules/sales-marketing/attribution/attribution-run.service";
import { scheduleAttributionRun } from "@/modules/sales-marketing/attribution/attribution-jobs.worker";

/** POST { from, to, idempotencyKey? }: queue a recalculation (a new run; earlier results stay). */
export const POST = salesMarketingRoute<{ id: string }>({ module: "marketing_attribution", action: "edit" }, async ({ req, actor, params }) => {
  const { run, created } = await requestRun(actor, params.id, await req.json());
  if (created && run.status === "QUEUED" && !(await scheduleAttributionRun(run.id))) {
    after(() => executeRun(run.id).then(() => undefined));
  }
  return NextResponse.json({ data: { id: run.id, status: run.status, created } }, { status: created ? 202 : 200 });
});
