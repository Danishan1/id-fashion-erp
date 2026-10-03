import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { archiveCompany } from "@/modules/crm/companies/crm-companies.service";

/** CRM-only archive: related records and the ERP customer are untouched. */
export const POST = crmRoute<{ id: string }>("edit", async ({ params, actor }) => NextResponse.json({ data: await archiveCompany(actor, params.id) }));
