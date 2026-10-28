import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getQuotation, updateQuotationDraft } from "@/modules/sales-marketing/quotations/quotation.service";

/** GET: quotation with its current revision and lines. PUT: save the draft (whole draft, with the `version` loaded). */
export const GET = salesMarketingRoute<{ id: string }>({ module: "sales_quotations", action: "view" }, async ({ actor, params }) =>
  NextResponse.json({ data: await getQuotation(actor, params.id) })
);

export const PUT = salesMarketingRoute<{ id: string }>({ module: "sales_quotations", action: "edit" }, async ({ req, actor, params }) =>
  NextResponse.json({ data: await updateQuotationDraft(actor, params.id, await req.json()) })
);
