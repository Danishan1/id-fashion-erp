import { NextResponse } from "next/server";
import { buildListMeta, parseListQuery } from "@/lib/list-query";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { quotationListFilterSchema, quotationSortSchema } from "@/modules/sales-marketing/quotations/quotation.schema";
import { createQuotation, listQuotations } from "@/modules/sales-marketing/quotations/quotation.service";

const Q = "sales_quotations" as const;

/**
 * GET: quotations in the caller's scope. Query: search, page, pageSize, sortBy,
 * sortOrder, view=open|closed|all (default open), status (comma list),
 * owner=me|unassigned|<userId>, customerId, buyerEnquiryId.
 * POST: create a draft quotation (totals are always computed on the server).
 */
export const GET = salesMarketingRoute({ module: Q, action: "view" }, async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  const query = parseListQuery(sp);
  const filter = quotationListFilterSchema.parse(Object.fromEntries([...sp.entries()].filter(([k]) => k in quotationListFilterSchema.shape)));
  const sort = quotationSortSchema.parse({ sortBy: sp.get("sortBy") || undefined, sortOrder: sp.get("sortOrder") || undefined });
  const { data, totalCount } = await listQuotations(actor, filter, sort, { skip: query.skip, take: query.take, search: query.search });
  return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
});

export const POST = salesMarketingRoute({ module: Q, action: "create" }, async ({ req, actor }) =>
  NextResponse.json({ data: await createQuotation(actor, await req.json()) }, { status: 201 })
);
