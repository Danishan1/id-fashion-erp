import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { setPrimaryContact } from "@/modules/crm/companies/company-relations.service";

/** Body: { contactId: uuid | null } — must be one of the company's contacts. */
export const PUT = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => {
  await setPrimaryContact(actor, params.id, await req.json());
  return NextResponse.json({ data: { id: params.id } });
});
