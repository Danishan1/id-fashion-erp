import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { setDefaultPipeline } from "@/modules/crm/pipelines/crm-pipelines.service";

/** Body: { version } — makes this the company's default pipeline (the previous default is cleared; both audited). */
export const POST = crmRoute<{ id: string }>({ module: "crm_settings", action: "edit" }, async ({ req, params, actor }) => NextResponse.json({ data: await setDefaultPipeline(actor, params.id, await req.json()) }));
