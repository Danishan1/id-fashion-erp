import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { getOpportunityStageHistory } from "@/modules/crm/opportunities/crm-opportunities.service";

/** Applied stage / pipeline changes, newest first. */
export const GET = crmRoute<{ id: string }>("view", async ({ params, actor }) => NextResponse.json({ data: await getOpportunityStageHistory(actor, params.id) }));
