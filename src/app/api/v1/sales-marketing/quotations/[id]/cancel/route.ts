import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { cancelQuotation } from "@/modules/sales-marketing/quotations/quotation.service";

/** POST: cancel a draft quotation ({ reason }). */
export const POST = salesMarketingRoute<{ id: string }>({ module: "sales_quotations", action: "cancel" }, async ({ req, actor, params }) =>
  NextResponse.json({ data: await cancelQuotation(actor, params.id, await req.json().catch(() => ({}))) })
);
