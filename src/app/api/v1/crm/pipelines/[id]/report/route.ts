import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { z } from "zod";
import { getPipelineReport } from "@/modules/crm/pipelines/crm-pipeline-insights.service";

const rangeSchema = z
  .object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })
  .refine((r) => !r.from || !r.to || r.from <= r.to, "'From' must be on or before 'To'.");

/** Pipeline report: totals, open/won/lost, stage distribution and conversion. ?from&to filter by created date. Visibility applies. */
export const GET = crmRoute<{ id: string }>("view", async ({ req, params, actor }) => {
  const range = rangeSchema.parse(Object.fromEntries(req.nextUrl.searchParams));
  return NextResponse.json({ data: await getPipelineReport(actor, params.id, range) });
});
