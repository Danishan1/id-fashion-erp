import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { getStageConfig } from "@/modules/crm/pipelines/crm-pipelines.service";

/** Stage configuration: the stage, its rules, the other stages and every requirement that can be chosen. */
export const GET = crmRoute<{ id: string; stageId: string }>({ module: "crm_settings", action: "view" }, async ({ params, actor }) => NextResponse.json({ data: await getStageConfig(actor.companyId, params.id, params.stageId) }));
