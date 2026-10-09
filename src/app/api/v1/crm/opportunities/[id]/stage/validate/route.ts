import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { validateOpportunityTransition } from "@/modules/crm/opportunities/crm-opportunities.service";

/** Body: { stageId, pipelineId? } — dry run: { allowed, reasons[], missingFields[], probability } without changing anything. */
export const POST = crmRoute<{ id: string }>("view", async ({ req, params, actor }) => NextResponse.json({ data: await validateOpportunityTransition(actor, params.id, await req.json()) }));
