import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { unlinkLeadFromCompany } from "@/modules/crm/companies/company-relations.service";

export const DELETE = crmRoute<{ id: string; leadId: string }>("edit", async ({ params, actor }) => {
  await unlinkLeadFromCompany(actor, params.id, params.leadId);
  return NextResponse.json({ data: { id: params.leadId } });
});
