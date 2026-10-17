import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { createNote, listNotes } from "@/modules/crm/notes/crm-notes.service";

/** Internal notes on a conversation — the shared CRM notes (entity CONVERSATION). Never sent to the customer. Edit / delete: /api/v1/crm/notes/<id>. */
export const GET = crmRoute<{ id: string }>("view", async ({ params, actor }) => NextResponse.json({ data: await listNotes(actor, "CONVERSATION", params.id) }));

export const POST = crmRoute<{ id: string }>("create", async ({ req, params, actor }) => NextResponse.json({ data: await createNote(actor, "CONVERSATION", params.id, await req.json()) }, { status: 201 }));
