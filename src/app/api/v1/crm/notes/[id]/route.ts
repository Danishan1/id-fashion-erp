import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { deleteNote, updateNote } from "@/modules/crm/notes/crm-notes.service";

/** Authors edit their own notes; authors and managers (crm.view_all) can delete. */
export const PATCH = crmRoute<{ id: string }>("view", async ({ req, params, actor }) => NextResponse.json({ data: await updateNote(actor, params.id, await req.json()) }));

export const DELETE = crmRoute<{ id: string }>("view", async ({ params, actor }) => {
  await deleteNote(actor, params.id);
  return NextResponse.json({ data: { id: params.id } });
});
