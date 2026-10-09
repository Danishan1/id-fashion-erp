import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { archiveStage } from "@/modules/crm/pipelines/crm-pipelines.service";

/** Body: { version, reassignToStageId?, confirm? } — opportunities in the stage must be moved to another active stage of the pipeline. */
export const POST = crmRoute<{ id: string; stageId: string }>({ module: "crm_settings", action: "edit" }, async ({ req, params, actor }) =>
  NextResponse.json({ data: await archiveStage(actor, params.id, params.stageId, await req.json()) })
);
