import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { getTemplateVersion } from "@/modules/crm/templates/crm-templates.service";

/** One version's exact content and its validation. */
export const GET = crmRoute<{ id: string; versionId: string }>("view", async ({ params, actor }) => NextResponse.json({ data: await getTemplateVersion(actor, params.id, params.versionId) }));
