import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { transferOpportunityPipeline } from "@/modules/crm/opportunities/crm-opportunities.service";

/** Body: { pipelineId, stageId?, probability?, version?, reason? } — moves the opportunity to another pipeline (default stage unless given). */
export const POST = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => NextResponse.json({ data: await transferOpportunityPipeline(actor, params.id, await req.json()) }));
