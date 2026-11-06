import { NextResponse } from "next/server";
import { buildListMeta, parseListQuery } from "@/lib/list-query";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { listEnquiryImportBatches } from "@/modules/sales-marketing/bulk/enquiry-import.service";

/** Phase 14 — enquiry import history (own imports; S&M administrators see all). */
export const GET = salesMarketingRoute("create", async ({ req, actor }) => {
  const query = parseListQuery(req.nextUrl.searchParams, "createdAt");
  const { data, totalCount } = await listEnquiryImportBatches(actor, { skip: query.skip, take: query.take });
  return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
});
