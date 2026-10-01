import { NextResponse } from "next/server";
import { parseListQuery } from "@/lib/list-query";
import { crmListResponse, crmRoute } from "@/modules/crm/core/crm-route";
import { leadSortSchema, parseLeadFilterParams } from "@/modules/crm/leads/lead.schema";
import { createLead, listLeads } from "@/modules/crm/leads/lead.service";

/**
 * GET: server-side search, filters, sort and paging (see parseLeadFilterParams
 * for the query format). Archived leads are excluded unless `archived=only|include`.
 * POST: create a lead (409 CRM_POSSIBLE_DUPLICATE / DUPLICATE_LEAD_EXISTS when
 * duplicate rules match; resend with `confirmDuplicate: true` for warnings).
 */
export const GET = crmRoute("view", async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  const query = parseListQuery(sp);
  const filter = parseLeadFilterParams(sp);
  const sort = leadSortSchema.parse({ sortBy: sp.get("sortBy") || undefined, sortOrder: sp.get("sortOrder") || undefined });
  const { data, totalCount } = await listLeads(actor, filter, sort, query);
  return crmListResponse(data, totalCount, query);
});

export const POST = crmRoute("create", async ({ req, actor }) => {
  const lead = await createLead(actor, await req.json());
  return NextResponse.json({ data: lead }, { status: 201 });
});
