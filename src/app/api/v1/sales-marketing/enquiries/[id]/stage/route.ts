import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { changeSalesEnquiryStage } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";

/** POST: move the enquiry to another sales stage ({ stage, reason }). */
export const POST = salesMarketingRoute<{ id: string }>("edit", async ({ req, actor, params }) =>
  NextResponse.json({ data: await changeSalesEnquiryStage(actor, params.id, await req.json().catch(() => ({}))) })
);
