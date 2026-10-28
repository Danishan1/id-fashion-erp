import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { resumeSalesEnquiry } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";

/** POST: take the enquiry off hold, back to the stage it was held from. */
export const POST = salesMarketingRoute<{ id: string }>("edit", async ({ actor, params }) =>
  NextResponse.json({ data: await resumeSalesEnquiry(actor, params.id) })
);
