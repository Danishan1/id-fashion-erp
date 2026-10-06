import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { changeOpportunityStage } from "@/modules/crm/opportunities/crm-opportunities.service";

/**
 * Body: { stageId, pipelineId?, probability?, useStageProbability?, reason?, version? }.
 * Validated by the central transition service (rules, required fields); a
 * refused move returns 422 CRM_STAGE_TRANSITION_BLOCKED with missingFields.
 */
export const POST = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => NextResponse.json({ data: await changeOpportunityStage(actor, params.id, await req.json()) }));
