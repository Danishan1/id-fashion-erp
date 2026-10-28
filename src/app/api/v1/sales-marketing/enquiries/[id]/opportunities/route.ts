import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { linkSalesEnquiryOpportunity } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";

/** POST: link a CRM opportunity ({ opportunityId }) — stored in the CRM's own ERP-link table. Also needs crm.edit. */
export const POST = salesMarketingRoute<{ id: string }>("edit", async ({ req, actor, params }) =>
  NextResponse.json({ data: await linkSalesEnquiryOpportunity(actor, params.id, await req.json()) })
);
