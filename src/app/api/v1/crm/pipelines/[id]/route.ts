import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { getPipeline, updatePipeline } from "@/modules/crm/pipelines/crm-pipelines.service";

/** GET: pipeline with stages, rules, usage counts and requirement options (CRM settings). PATCH: { version, name?, description? }. */
export const GET = crmRoute<{ id: string }>({ module: "crm_settings", action: "view" }, async ({ params, actor }) => NextResponse.json({ data: await getPipeline(actor.companyId, params.id) }));

export const PATCH = crmRoute<{ id: string }>({ module: "crm_settings", action: "edit" }, async ({ req, params, actor }) => NextResponse.json({ data: await updatePipeline(actor, params.id, await req.json()) }));
