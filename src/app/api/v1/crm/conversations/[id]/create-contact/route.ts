import { NextResponse } from "next/server";
import { createContactFromConversation } from "@/modules/crm/conversations/crm-conversations.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

/**
 * Body: { version, firstName, lastName?, email?, mobile?, whatsapp?, crmCompanyId?, confirmDuplicate? }.
 * Creates the contact through the contact service (duplicate rules apply —
 * 409 CRM_POSSIBLE_DUPLICATE / CRM_DUPLICATE_RECORD with matches) and links it.
 */
export const POST = crmRoute<{ id: string }>("create", async ({ req, params, actor }) => NextResponse.json({ data: await createContactFromConversation(actor, params.id, await req.json()) }, { status: 201 }));
