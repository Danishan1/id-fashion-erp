import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { validateStoredTemplate } from "@/modules/crm/templates/crm-templates.service";

/** { versionId?, channelId? } — CRM rules, plus the channel provider's rules when channelId is given. */
export const POST = crmRoute<{ id: string }>("view", async ({ req, params, actor }) => NextResponse.json({ data: await validateStoredTemplate(actor, params.id, await req.json().catch(() => ({}))) }));
