import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { addContactToCompany, listCompanyContacts, relatedPageSchema } from "@/modules/crm/companies/company-relations.service";

/** Paged contacts of the company (visible to the caller). ?page=&pageSize=&includeArchived=true */
export const GET = crmRoute<{ id: string }>("view", async ({ req, params, actor }) => NextResponse.json(await listCompanyContacts(actor, params.id, relatedPageSchema.parse(Object.fromEntries(req.nextUrl.searchParams)))));

/** Body: { contactId, makePrimary?, moveFromOtherCompany? } — adds an existing contact (409 needsConfirmation if at another company). */
export const POST = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => NextResponse.json({ data: await addContactToCompany(actor, params.id, await req.json()) }));
