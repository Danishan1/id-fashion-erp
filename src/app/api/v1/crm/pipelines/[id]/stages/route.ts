import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { createStage, listStages } from "@/modules/crm/pipelines/crm-pipelines.service";

/** GET: the pipeline's stages (with usage and rules). POST: { name, description?, probability?, isDefault?, requiredFields?, transitionMode? } — added at the end. */
export const GET = crmRoute<{ id: string }>({ module: "crm_settings", action: "view" }, async ({ params, actor }) => NextResponse.json({ data: await listStages(actor.companyId, params.id) }));

export const POST = crmRoute<{ id: string }>({ module: "crm_settings", action: "edit" }, async ({ req, params, actor }) => NextResponse.json({ data: await createStage(actor, params.id, await req.json()) }, { status: 201 }));
