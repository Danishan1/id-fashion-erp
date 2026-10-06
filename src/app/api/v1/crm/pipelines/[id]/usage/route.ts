import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { pipelineUsage } from "@/modules/crm/pipelines/crm-pipelines.service";

/** Opportunity counts (total incl. closed/archived, and open) per stage — shown before archiving. */
export const GET = crmRoute<{ id: string }>({ module: "crm_settings", action: "view" }, async ({ params, actor }) => NextResponse.json({ data: await pipelineUsage(actor.companyId, params.id) }));
