import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { sendTemplateTest } from "@/modules/crm/templates/crm-templates.service";

/**
 * { channelId, to, confirm: true, versionId?, sample? | context? } — ONE test message to the typed address,
 * through the channel's provider adapter, marked "[TEST]". Not stored as a conversation; logged in the audit
 * trail and the template's history. A few per user per minute.
 */
export const POST = crmRoute<{ id: string }>("create", async ({ req, params, actor }) => NextResponse.json({ data: await sendTemplateTest(actor, params.id, await req.json()) }));
