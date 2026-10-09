import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { archivePipeline } from "@/modules/crm/pipelines/crm-pipelines.service";

/** Body: { version, targetPipelineId?, targetStageId?, stageMap?, confirm? } — a destination is required while opportunities use the pipeline. */
export const POST = crmRoute<{ id: string }>({ module: "crm_settings", action: "edit" }, async ({ req, params, actor }) => NextResponse.json({ data: await archivePipeline(actor, params.id, await req.json()) }));
