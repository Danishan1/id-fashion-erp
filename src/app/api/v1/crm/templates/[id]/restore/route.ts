import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { changeTemplateStatus } from "@/modules/crm/templates/crm-templates.service";

/** { version } — lifecycle action "restore" (see TEMPLATE_ACTIONS in template-registry.ts). */
export const POST = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => NextResponse.json({ data: await changeTemplateStatus(actor, params.id, "restore", await req.json()) }));
