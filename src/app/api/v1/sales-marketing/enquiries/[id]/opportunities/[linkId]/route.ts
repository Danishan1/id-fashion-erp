import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { unlinkSalesEnquiryOpportunity } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";

/** DELETE: remove a CRM opportunity link. Also needs crm.edit. */
export const DELETE = salesMarketingRoute<{ id: string; linkId: string }>("edit", async ({ actor, params }) =>
  NextResponse.json({ data: await unlinkSalesEnquiryOpportunity(actor, params.id, params.linkId) })
);
