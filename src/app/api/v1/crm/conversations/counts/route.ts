import { NextResponse } from "next/server";
import { inboxCounts } from "@/modules/crm/conversations/crm-conversations.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

/** Inbox sidebar counts: folders (all, unread, mine, unassigned, unmatched) and open conversations per channel. */
export const GET = crmRoute("view", async ({ actor }) => NextResponse.json({ data: await inboxCounts(actor) }));
