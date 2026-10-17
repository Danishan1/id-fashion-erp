import { NextResponse } from "next/server";
import { getConversation, updateConversation } from "@/modules/crm/conversations/crm-conversations.service";
import { crmRoute } from "@/modules/crm/core/crm-route";

/** GET: conversation with participants, channel capabilities, contactability, match candidates and allowed actions. */
export const GET = crmRoute<{ id: string }>("view", async ({ params, actor }) => NextResponse.json({ data: await getConversation(actor, params.id) }));

/** PATCH { version, subject } */
export const PATCH = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => NextResponse.json({ data: await updateConversation(actor, params.id, await req.json()) }));
