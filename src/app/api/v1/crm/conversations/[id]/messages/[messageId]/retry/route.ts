import { NextResponse } from "next/server";
import { retryConversationMessage } from "@/modules/crm/conversations/conversation-messaging.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

/** Resend a FAILED outbound message (same message and idempotency key; DND and channel checks run again). */
export const POST = crmRoute<{ id: string; messageId: string }>("create", async ({ params, actor }) => NextResponse.json({ data: await retryConversationMessage(actor, params.id, params.messageId) }));
