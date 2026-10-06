import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { restoreStage } from "@/modules/crm/pipelines/crm-pipelines.service";

/** Body: { version }. */
export const POST = crmRoute<{ id: string; stageId: string }>({ module: "crm_settings", action: "edit" }, async ({ req, params, actor }) =>
  NextResponse.json({ data: await restoreStage(actor, params.id, params.stageId, await req.json()) })
);
