import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { changeCompanyStatus } from "@/modules/crm/companies/crm-companies.service";

/** Body: { statusId, version? }. Explicit only — ERP activity never changes a CRM status. */
export const POST = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => NextResponse.json({ data: await changeCompanyStatus(actor, params.id, await req.json()) }));
