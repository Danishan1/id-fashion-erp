import { NextResponse } from "next/server";
import { buildListMeta, parseListQuery } from "@/lib/list-query";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { salesEnquiryListFilterSchema, salesEnquirySortSchema } from "@/modules/sales-marketing/enquiries/sales-enquiry.schema";
import { createSalesEnquiry, listSalesEnquiries } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";

/**
 * GET: sales enquiries in the caller's scope. Query: search, page, pageSize,
 * sortBy, sortOrder, view=open|closed|all (default open), stage, priority,
 * source (comma lists), owner=me|unassigned|<userId>, overdue=1, dateFrom,
 * dateTo, crmCompanyId, customerId.
 * POST: capture an enquiry (Buyer Enquiry payload + sales fields).
 */
export const GET = salesMarketingRoute("view", async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  const query = parseListQuery(sp, "enquiryDate");
  const filter = salesEnquiryListFilterSchema.parse(Object.fromEntries([...sp.entries()].filter(([k]) => k in salesEnquiryListFilterSchema.shape)));
  const sort = salesEnquirySortSchema.parse({ sortBy: sp.get("sortBy") || undefined, sortOrder: sp.get("sortOrder") || undefined });
  const { data, totalCount } = await listSalesEnquiries(actor, filter, sort, { skip: query.skip, take: query.take, search: query.search });
  return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
});

export const POST = salesMarketingRoute("create", async ({ req, actor }) =>
  NextResponse.json({ data: await createSalesEnquiry(actor, await req.json()) }, { status: 201 })
);
