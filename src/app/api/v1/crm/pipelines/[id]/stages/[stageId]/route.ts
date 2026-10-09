import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { getStageDetail, updateStage } from "@/modules/crm/pipelines/crm-pipelines.service";

/** PATCH body: { version, name?, description?, probability?, requiredFields?, transitionMode? }. */
export const GET = crmRoute<{ id: string; stageId: string }>({ module: "crm_settings", action: "view" }, async ({ params, actor }) => NextResponse.json({ data: await getStageDetail(actor.companyId, params.id, params.stageId) }));

export const PATCH = crmRoute<{ id: string; stageId: string }>({ module: "crm_settings", action: "edit" }, async ({ req, params, actor }) =>
  NextResponse.json({ data: await updateStage(actor, params.id, params.stageId, await req.json()) })
);
