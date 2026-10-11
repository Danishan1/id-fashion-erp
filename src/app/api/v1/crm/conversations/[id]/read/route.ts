import { NextResponse } from "next/server";
import { markConversationRead } from "@/modules/crm/conversations/crm-conversations.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

/** Body: { upToMessageId? } — marks inbound messages seen up to that message (or all). Returns the remaining unread count. */
export const POST = crmRoute<{ id: string }>("view", async ({ req, params, actor }) => NextResponse.json({ data: await markConversationRead(actor, params.id, await req.json().catch(() => ({}))) }));
