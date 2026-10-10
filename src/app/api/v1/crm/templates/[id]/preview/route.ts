import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { previewTemplate } from "@/modules/crm/templates/crm-templates.service";

/**
 * Render a stored template: { versionId?, sample? | context: { contactId, companyId, opportunityId, leadId, appointmentId, conversationId }, channelId? }.
 * Sample data unless records are given; records must be visible to the user. Returns subject, body, errors, warnings, missing variables.
 */
export const POST = crmRoute<{ id: string }>("view", async ({ req, params, actor }) => NextResponse.json({ data: await previewTemplate(actor, params.id, await req.json().catch(() => ({}))) }));
