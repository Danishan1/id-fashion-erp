import { NextResponse } from "next/server";
import { crmRoute } from "@/modules/crm/core/crm-route";
import { linkLeadToCompany, listCompanyLeads, relatedPageSchema } from "@/modules/crm/companies/company-relations.service";

/** Paged leads of the company (and companies merged into it), visible to the caller. */
export const GET = crmRoute<{ id: string }>("view", async ({ req, params, actor }) => NextResponse.json(await listCompanyLeads(actor, params.id, relatedPageSchema.parse(Object.fromEntries(req.nextUrl.searchParams)))));

/** Body: { leadId } — associates an existing lead. */
export const POST = crmRoute<{ id: string }>("edit", async ({ req, params, actor }) => {
  await linkLeadToCompany(actor, params.id, await req.json());
  return NextResponse.json({ data: { id: params.id } });
});
