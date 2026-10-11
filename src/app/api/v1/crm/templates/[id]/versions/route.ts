import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { listTemplateVersions } from "@/modules/crm/templates/crm-templates.service";

/** Every version (immutable), newest first, with its exact content and how often it was used. */
export const GET = crmRoute<{ id: string }>("view", async ({ params, actor }) => NextResponse.json({ data: await listTemplateVersions(actor, params.id) }));
