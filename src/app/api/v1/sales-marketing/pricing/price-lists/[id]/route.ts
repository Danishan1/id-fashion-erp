import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getPriceList, updatePriceListHeader } from "@/modules/sales-marketing/pricing/price-list.service";

/** GET (?version=n): list, versions, one version's prices, history. PATCH: name / description / priority. */
export const GET = salesMarketingRoute<{ id: string }>({ module: "sales_pricing", action: "view" }, async ({ req, actor, params }) => {
  const n = Number(req.nextUrl.searchParams.get("version"));
  return NextResponse.json({ data: await getPriceList(actor, params.id, Number.isInteger(n) && n > 0 ? n : undefined) });
});

export const PATCH = salesMarketingRoute<{ id: string }>({ module: "sales_pricing", action: "edit" }, async ({ req, actor, params }) =>
  NextResponse.json({ data: await updatePriceListHeader(actor, params.id, await req.json()) })
);
