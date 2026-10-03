import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { restoreCompany } from "@/modules/crm/companies/crm-companies.service";

export const POST = crmRoute<{ id: string }>("edit", async ({ params, actor }) => NextResponse.json({ data: await restoreCompany(actor, params.id) }));
