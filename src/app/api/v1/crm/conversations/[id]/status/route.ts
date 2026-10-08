import { NextResponse } from "next/server";
import { changeConversationStatus } from "@/modules/crm/conversations/crm-conversations.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

/** Body: { version, status: OPEN | PENDING | CLOSED | ARCHIVED } — close, reopen, mark pending, archive, restore. */
export const POST = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => NextResponse.json({ data: await changeConversationStatus(actor, params.id, await req.json()) }));
