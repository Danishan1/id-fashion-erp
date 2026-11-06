import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { reopenSalesEnquiry } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";

/** POST: reopen a lost / not-qualified enquiry ({ reason }). */
export const POST = salesMarketingRoute<{ id: string }>("edit", async ({ req, actor, params }) =>
  NextResponse.json({ data: await reopenSalesEnquiry(actor, params.id, await req.json().catch(() => ({}))) })
);
