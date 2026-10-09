import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { updateStageRequiredFields } from "@/modules/crm/pipelines/crm-pipelines.service";

/** Body: { version, requiredFields: ["company", "amount", "erp:SALES_ORDER", "custom:<key>", …] }. */
export const PUT = crmRoute<{ id: string; stageId: string }>({ module: "crm_settings", action: "edit" }, async ({ req, params, actor }) =>
  NextResponse.json({ data: await updateStageRequiredFields(actor, params.id, params.stageId, await req.json()) })
);
