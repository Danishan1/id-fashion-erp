import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { createNote, listNotes } from "@/modules/crm/notes/crm-notes.service";

export const GET = crmRoute<{ id: string }>("view", async ({ params, actor }) => NextResponse.json({ data: await listNotes(actor, "LEAD", params.id) }));

export const POST = crmRoute<{ id: string }>("create", async ({ req, params, actor }) =>
  NextResponse.json({ data: await createNote(actor, "LEAD", params.id, await req.json()) }, { status: 201 })
);
