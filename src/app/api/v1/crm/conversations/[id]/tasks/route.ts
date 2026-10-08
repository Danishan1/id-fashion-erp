import { NextResponse } from "next/server";
import { createTaskFromConversation } from "@/modules/crm/conversations/crm-conversations.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

/** Body: { subject, description?, dueDate?, dueTime?, assignedToUserId?, priority?, reminderMinutes?, messageId? } — a Phase 09 task linked to the conversation and its records. */
export const POST = crmRoute<{ id: string }>("create", async ({ req, params, actor }) => NextResponse.json({ data: await createTaskFromConversation(actor, params.id, await req.json()) }, { status: 201 }));
