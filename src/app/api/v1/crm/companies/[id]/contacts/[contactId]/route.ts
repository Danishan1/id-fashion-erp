import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { removeContactFromCompany } from "@/modules/crm/companies/company-relations.service";

/** Removes the relationship only; the contact stays. */
export const DELETE = crmRoute<{ id: string; contactId: string }>("edit", async ({ params, actor }) => {
  await removeContactFromCompany(actor, params.id, params.contactId);
  return NextResponse.json({ data: { id: params.contactId } });
});
