import { NextResponse } from "next/server";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getQuotationPrefillFromEnquiry } from "@/modules/sales-marketing/quotations/quotation.service";

/** GET ?enquiryId=: a draft payload pre-filled from the enquiry. Needs quotations.create and enquiry access. */
export const GET = salesMarketingRoute({ module: "sales_quotations", action: "create" }, async ({ req, actor }) => {
  const enquiryId = req.nextUrl.searchParams.get("enquiryId") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(enquiryId)) throw new BusinessRuleError("VALIDATION_ERROR", "enquiryId is required.");
  return NextResponse.json({ data: await getQuotationPrefillFromEnquiry(actor, enquiryId) });
});
