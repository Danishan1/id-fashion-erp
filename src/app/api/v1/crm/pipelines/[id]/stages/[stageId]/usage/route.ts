import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { stageUsage } from "@/modules/crm/pipelines/crm-pipelines.service";

export const GET = crmRoute<{ id: string; stageId: string }>({ module: "crm_settings", action: "view" }, async ({ params, actor }) => NextResponse.json({ data: await stageUsage(actor.companyId, params.id, params.stageId) }));
