import { NextResponse } from "next/server";
import { parseListQuery } from "@/lib/list-query";
import { crmListResponse, crmRoute } from "@/modules/crm/core/crm-route";
import { opportunitySortSchema, parseOpportunityFilterParams } from "@/modules/crm/opportunities/opportunity.schema";
import { createOpportunity, listOpportunities } from "@/modules/crm/opportunities/crm-opportunities.service";

/**
 * GET: server-side search, filters, sort and paging (query format: see
 * parseOpportunityFilterParams). Archived opportunities are excluded unless
 * `archived=only|include`.
 * POST: create an opportunity (409 CRM_POSSIBLE_DUPLICATE when an open one
 * with the same name exists for the same company and contact — resend with
 * `confirmDuplicate: true`).
 */
export const GET = crmRoute("view", async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  const query = parseListQuery(sp);
  const filter = parseOpportunityFilterParams(sp);
  const sort = opportunitySortSchema.parse({ sortBy: sp.get("sortBy") || undefined, sortOrder: sp.get("sortOrder") || undefined });
  const { data, totalCount } = await listOpportunities(actor, filter, sort, query);
  return crmListResponse(data, totalCount, query);
});

export const POST = crmRoute("create", async ({ req, actor }) => NextResponse.json({ data: await createOpportunity(actor, await req.json()) }, { status: 201 }));
