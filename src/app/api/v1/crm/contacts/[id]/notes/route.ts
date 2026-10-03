import { NextResponse } from "next/server";
import { loadContactForActor } from "@/modules/crm/contacts/crm-contacts.service";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { createNote, listNotes } from "@/modules/crm/notes/crm-notes.service";

export const GET = crmRoute<{ id: string }>("view", async ({ params, actor }) => NextResponse.json({ data: await listNotes(actor, "CONTACT", params.id) }));

export const POST = crmRoute<{ id: string }>("create", async ({ req, params, actor }) => {
  // Notes go on the surviving contact, never on a merged one.
  await loadContactForActor(actor, params.id);
  return NextResponse.json({ data: await createNote(actor, "CONTACT", params.id, await req.json()) }, { status: 201 });
});
