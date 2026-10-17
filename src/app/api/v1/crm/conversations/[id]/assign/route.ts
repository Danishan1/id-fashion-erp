import { NextResponse } from "next/server";
import { assignConversation } from "@/modules/crm/conversations/crm-conversations.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

/** Body: { version, assignedToUserId | null } — assign, reassign or unassign. Emits conversation.assigned. */
export const POST = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => NextResponse.json({ data: await assignConversation(actor, params.id, await req.json()) }));
