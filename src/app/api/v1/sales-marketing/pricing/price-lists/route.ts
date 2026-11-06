import { NextResponse } from "next/server";
import { buildListMeta, parseListQuery } from "@/lib/list-query";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { createPriceList, listPriceLists } from "@/modules/sales-marketing/pricing/price-list.service";

const P = { module: "sales_pricing", action: "view" } as const;

/** GET: price lists (search, page, pageSize, kind, customerId, status=active|inactive|pending|all). POST: new list with a draft version 1. */
export const GET = salesMarketingRoute(P, async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  const query = parseListQuery(sp);
  const { data, totalCount } = await listPriceLists(
    actor,
    { kind: sp.get("kind") ?? "", customerId: sp.get("customerId") ?? "", status: sp.get("status") ?? "" },
    { skip: query.skip, take: query.take, search: query.search }
  );
  return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
});

export const POST = salesMarketingRoute({ module: "sales_pricing", action: "create" }, async ({ req, actor }) =>
  NextResponse.json({ data: await createPriceList(actor, await req.json()) }, { status: 201 })
);
