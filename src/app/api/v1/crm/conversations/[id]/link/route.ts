import { NextResponse } from "next/server";
import { linkConversation } from "@/modules/crm/conversations/crm-conversations.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

/** Body: { version, contactId?, companyId?, opportunityId? } — omitted = unchanged, null = remove. Existing CRM records only. */
export const POST = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => NextResponse.json({ data: await linkConversation(actor, params.id, await req.json()) }));
