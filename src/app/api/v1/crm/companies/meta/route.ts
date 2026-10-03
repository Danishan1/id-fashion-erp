import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { getCompanyFormMeta } from "@/modules/crm/companies/crm-companies.service";

/** Statuses, sources, company custom fields, industry / type suggestions and whether ERP customers can be picked. */
export const GET = crmRoute("view", async ({ actor }) => NextResponse.json({ data: await getCompanyFormMeta(actor) }));
