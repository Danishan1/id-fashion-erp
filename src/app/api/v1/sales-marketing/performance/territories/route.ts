import { NextResponse } from "next/server";
import { buildListMeta, parseListQuery } from "@/lib/list-query";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { createTerritory, listTerritories } from "@/modules/sales-marketing/performance/territory.service";

/** GET: territories (search, page, pageSize, status=active|inactive|all). POST: new territory. */
export const GET = salesMarketingRoute({ module: "sales_performance", action: "view" }, async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  const query = parseListQuery(sp);
  const { data, total } = await listTerritories(actor, { status: sp.get("status") ?? "" }, { skip: query.skip, take: query.take, search: query.search });
  return NextResponse.json({ data, meta: buildListMeta(total, query.page, query.pageSize) });
});

export const POST = salesMarketingRoute({ module: "sales_performance", action: "edit" }, async ({ req, actor }) =>
  NextResponse.json({ data: await createTerritory(actor, await req.json()) }, { status: 201 })
);
