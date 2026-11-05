import { NextResponse, after } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { requestSegmentEvaluation, runSegmentEvaluation } from "@/modules/sales-marketing/segments/segment-evaluation.service";
import { scheduleSegmentEvaluation } from "@/modules/sales-marketing/segments/segment-jobs.worker";

/**
 * POST { idempotencyKey?, keep?, label? }: evaluate the current definition (a
 * new snapshot). Returns at once (202); the worker runs it. If the queue isn't
 * reachable it runs right after the response instead.
 */
export const POST = salesMarketingRoute<{ id: string }>({ module: "marketing_segments", action: "edit" }, async ({ req, actor, params }) => {
  const { evaluation, created } = await requestSegmentEvaluation(actor, params.id, await req.json().catch(() => ({})));
  if (created && evaluation.status === "QUEUED" && !(await scheduleSegmentEvaluation(evaluation.id))) {
    after(() => runSegmentEvaluation(evaluation.id).then(() => undefined));
  }
  return NextResponse.json({ data: { id: evaluation.id, status: evaluation.status, created } }, { status: created ? 202 : 200 });
});
