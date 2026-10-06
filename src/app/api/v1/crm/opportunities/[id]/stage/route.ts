import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { changeOpportunityStage } from "@/modules/crm/opportunities/crm-opportunities.service";

/** Body: { stageId, pipelineId?, probability?, version? } — records old/new stage and probability. */
export const POST = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => NextResponse.json({ data: await changeOpportunityStage(actor, params.id, await req.json()) }));
