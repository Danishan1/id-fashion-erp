import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { addSalesEnquiryActivity, getSalesEnquiryActivities } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";

/** GET: the enquiry's timeline. POST: log a note, call, email or meeting ({ type, body, occurredAt? }). */
export const GET = salesMarketingRoute<{ id: string }>("view", async ({ actor, params }) =>
  NextResponse.json({ data: await getSalesEnquiryActivities(actor, params.id) })
);

export const POST = salesMarketingRoute<{ id: string }>("edit", async ({ req, actor, params }) =>
  NextResponse.json({ data: await addSalesEnquiryActivity(actor, params.id, await req.json()) }, { status: 201 })
);
