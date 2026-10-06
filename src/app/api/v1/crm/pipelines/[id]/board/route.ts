import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { getPipelineBoard } from "@/modules/crm/pipelines/crm-pipeline-insights.service";

/** Board data (no UI yet): stages in order with count, value per currency and up to ?perStage records. ?status=OPEN|ALL, ?ownerUserId. Visibility applies. */
export const GET = crmRoute<{ id: string }>("view", async ({ req, params, actor }) =>
  NextResponse.json({ data: await getPipelineBoard(actor, params.id, Object.fromEntries(req.nextUrl.searchParams)) })
);
