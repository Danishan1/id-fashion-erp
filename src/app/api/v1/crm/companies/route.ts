import { NextResponse } from "next/server";
import { parseListQuery } from "@/lib/list-query";
import { companySortSchema, parseCompanyFilterParams } from "@/modules/crm/companies/company.schema";
import { createCompany, listCompanies } from "@/modules/crm/companies/crm-companies.service";
import { crmListResponse, crmRoute } from "@/modules/crm/core/crm-route";

/**
 * GET: server-side search, filters, sort and paging (query format: see
 * parseCompanyFilterParams). Archived companies are excluded unless
 * `archived=only|include`; merged companies are never listed.
 * POST: create a company (409 CRM_POSSIBLE_DUPLICATE for warnings — resend
 * with `confirmDuplicate: true`; 409 CRM_DUPLICATE_RECORD when a BLOCK rule
 * or an already-linked ERP customer matches).
 */
export const GET = crmRoute("view", async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  const query = parseListQuery(sp);
  const filter = parseCompanyFilterParams(sp);
  const sort = companySortSchema.parse({ sortBy: sp.get("sortBy") || undefined, sortOrder: sp.get("sortOrder") || undefined });
  const { data, totalCount } = await listCompanies(actor, filter, sort, query);
  return crmListResponse(data, totalCount, query);
});

export const POST = crmRoute("create", async ({ req, actor }) => NextResponse.json({ data: await createCompany(actor, await req.json()) }, { status: 201 }));
