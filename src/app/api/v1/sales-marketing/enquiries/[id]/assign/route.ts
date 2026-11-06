import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { assignSalesEnquiry } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";

/** POST: assign or unassign the owner ({ ownerUserId }). */
export const POST = salesMarketingRoute<{ id: string }>("edit", async ({ req, actor, params }) =>
  NextResponse.json({ data: await assignSalesEnquiry(actor, params.id, await req.json().catch(() => ({}))) })
);
