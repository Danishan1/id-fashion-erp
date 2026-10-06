import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { reorderStages } from "@/modules/crm/pipelines/crm-pipelines.service";

/** Body: { ids: [every active stage id in the new order] }. Display order only — opportunities keep their stage. */
export const POST = crmRoute<{ id: string }>({ module: "crm_settings", action: "edit" }, async ({ req, params, actor }) => NextResponse.json({ data: await reorderStages(actor, params.id, await req.json()) }));
