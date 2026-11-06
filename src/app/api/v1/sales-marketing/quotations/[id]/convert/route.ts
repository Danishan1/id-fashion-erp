import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { convertQuotationToSalesOrder, getConversionPlan } from "@/modules/sales-marketing/quotations/quotation-conversion.service";

/**
 * GET: what converting this quotation would produce (lines, pieces, net prices, blockers).
 * POST: create the Sales Order from the accepted revision (Sales Order form payload +
 * `quotationLineIds`). Needs sales_quotations.edit and sales_orders.create. Idempotent.
 */
export const GET = salesMarketingRoute<{ id: string }>({ module: "sales_quotations", action: "view" }, async ({ actor, params }) =>
  NextResponse.json({ data: await getConversionPlan(actor, params.id) })
);

export const POST = salesMarketingRoute<{ id: string }>({ module: "sales_quotations", action: "edit" }, async ({ req, actor, params }) => {
  const result = await convertQuotationToSalesOrder(actor, params.id, await req.json().catch(() => ({})));
  return NextResponse.json({ data: result }, { status: result.alreadyConverted ? 200 : 201 });
});
