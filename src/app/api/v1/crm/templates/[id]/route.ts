import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { getTemplate, updateTemplate } from "@/modules/crm/templates/crm-templates.service";

/** Template details: current version, validation, usage, metadata. */
export const GET = crmRoute<{ id: string }>("view", async ({ params, actor }) => NextResponse.json({ data: await getTemplate(actor, params.id) }));

/**
 * Edit { version, name?, categoryId?, description?, subject?, body?, providerMetadata?, changeNote? }.
 * Content changes add a new version (never overwrite); an ACTIVE template's new version must be error-free.
 * PUT is accepted as an alias (the CRM uses PATCH elsewhere).
 */
const update = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => NextResponse.json({ data: await updateTemplate(actor, params.id, await req.json()) }));
export const PATCH = update;
export const PUT = update;
