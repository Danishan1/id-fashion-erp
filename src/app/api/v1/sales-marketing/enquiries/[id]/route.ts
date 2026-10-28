import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getSalesEnquiry, updateSalesEnquiryDetails } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";

/** GET: enquiry detail (lines, CRM links, opportunities, timeline). PATCH: edit sales details. */
export const GET = salesMarketingRoute<{ id: string }>("view", async ({ actor, params }) =>
  NextResponse.json({ data: await getSalesEnquiry(actor, params.id) })
);

export const PATCH = salesMarketingRoute<{ id: string }>("edit", async ({ req, actor, params }) =>
  NextResponse.json({ data: await updateSalesEnquiryDetails(actor, params.id, await req.json()) })
);
