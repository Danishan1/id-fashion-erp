import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { listEligibleOwners } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";

/** GET: people who can be sales reps (active users with Sales & Marketing access). */
export const GET = salesMarketingRoute({ module: "sales_performance", action: "view" }, async ({ actor }) => NextResponse.json({ data: await listEligibleOwners(actor) }));
