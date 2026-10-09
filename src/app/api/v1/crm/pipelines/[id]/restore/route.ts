import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { restorePipeline } from "@/modules/crm/pipelines/crm-pipelines.service";

/** Body: { version }. */
export const POST = crmRoute<{ id: string }>({ module: "crm_settings", action: "edit" }, async ({ req, params, actor }) => NextResponse.json({ data: await restorePipeline(actor, params.id, await req.json()) }));
