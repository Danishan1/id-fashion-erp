import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { checkCompanyDuplicates } from "@/modules/crm/companies/crm-companies.service";

/** Live duplicate check for the company form, using the same rules as save. */
export const POST = crmRoute("view", async ({ req, actor }) => NextResponse.json({ data: await checkCompanyDuplicates(actor, await req.json()) }));
