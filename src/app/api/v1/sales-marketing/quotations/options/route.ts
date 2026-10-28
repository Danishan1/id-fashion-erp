import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getQuotationEditorOptions } from "@/modules/sales-marketing/quotations/quotation.service";

/** GET ?date=YYYY-MM-DD: GST rates effective on that date, units, company GST state, eligible owners. */
export const GET = salesMarketingRoute({ module: "sales_quotations", action: "view" }, async ({ req, actor }) => {
  const date = req.nextUrl.searchParams.get("date");
  return NextResponse.json({ data: await getQuotationEditorOptions(actor, date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined) });
});
