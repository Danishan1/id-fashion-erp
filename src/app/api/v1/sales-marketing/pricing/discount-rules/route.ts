import { NextResponse } from "next/server";
import { buildListMeta, parseListQuery } from "@/lib/list-query";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { createDiscountRule, listDiscountRules } from "@/modules/sales-marketing/pricing/discount-rule.service";

/** GET: discount rules (search, page, pageSize, status comma list). POST: new draft rule. */
export const GET = salesMarketingRoute({ module: "sales_pricing", action: "view" }, async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  const query = parseListQuery(sp);
  const { data, totalCount } = await listDiscountRules(actor, { status: sp.get("status") ?? undefined }, { skip: query.skip, take: query.take, search: query.search });
  return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
});

export const POST = salesMarketingRoute({ module: "sales_pricing", action: "create" }, async ({ req, actor }) =>
  NextResponse.json({ data: await createDiscountRule(actor, await req.json()) }, { status: 201 })
);
