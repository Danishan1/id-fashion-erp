import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { listEligibleOwners } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";

/** GET: people who can be sales reps (active users with Sales & Marketing access). Also used by the Phase 07 commission and channel screens. */
export const GET = salesMarketingRoute(
  [
    { module: "sales_performance", action: "view" },
    { module: "sales_commissions", action: "view" },
    { module: "sales_marketing_settings", action: "edit" },
  ],
  async ({ actor }) => NextResponse.json({ data: await listEligibleOwners(actor) }));
