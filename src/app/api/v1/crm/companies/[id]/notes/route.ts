import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { loadCompanyForActor } from "@/modules/crm/companies/crm-companies.service";
import { createNote, listNotes } from "@/modules/crm/notes/crm-notes.service";

export const GET = crmRoute<{ id: string }>("view", async ({ params, actor }) => NextResponse.json({ data: await listNotes(actor, "COMPANY", params.id) }));

export const POST = crmRoute<{ id: string }>("create", async ({ req, params, actor }) => {
  // Notes go on the surviving company, never on a merged one.
  await loadCompanyForActor(actor, params.id);
  return NextResponse.json({ data: await createNote(actor, "COMPANY", params.id, await req.json()) }, { status: 201 });
});
