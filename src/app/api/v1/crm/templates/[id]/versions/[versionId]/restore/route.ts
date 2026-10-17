import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { restoreTemplateVersion } from "@/modules/crm/templates/crm-templates.service";

/** { version, changeNote? } — copies this version into a NEW current version (history is never rewritten). */
export const POST = crmRoute<{ id: string; versionId: string }>("edit", async ({ req, params, actor }) => NextResponse.json({ data: await restoreTemplateVersion(actor, params.id, params.versionId, await req.json()) }, { status: 201 }));
