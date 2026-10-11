import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { previewDraft } from "@/modules/crm/templates/crm-templates.service";

/** Preview unsaved editor content: { channelType, subject?, body, providerMetadata?, sample? | context: { contactId…, conversationId }, channelId? }. */
export const POST = crmRoute("view", async ({ req, actor }) => NextResponse.json({ data: await previewDraft(actor, await req.json()) }));
