import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { listEligibleOwners } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";

/** GET: users who can own Sales & Marketing records (active, with sales_marketing.view). */
export const GET = salesMarketingRoute("view", async ({ actor }) => NextResponse.json({ data: await listEligibleOwners(actor) }));
