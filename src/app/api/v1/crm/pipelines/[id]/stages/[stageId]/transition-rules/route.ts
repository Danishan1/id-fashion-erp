import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { getTransitionRules, updateTransitionRules } from "@/modules/crm/pipelines/crm-pipelines.service";

/** PUT body: { version, transitionMode: "ANY" | "ONLY_LISTED", rules: [{ toStageId, allowed, requiredFields?, message? }] } — replaces every rule leaving the stage. */
export const GET = crmRoute<{ id: string; stageId: string }>({ module: "crm_settings", action: "view" }, async ({ params, actor }) => NextResponse.json({ data: await getTransitionRules(actor.companyId, params.id, params.stageId) }));

export const PUT = crmRoute<{ id: string; stageId: string }>({ module: "crm_settings", action: "edit" }, async ({ req, params, actor }) =>
  NextResponse.json({ data: await updateTransitionRules(actor, params.id, params.stageId, await req.json()) })
);
