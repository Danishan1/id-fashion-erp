import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { budgetOverview } from "@/modules/sales-marketing/budgets/budget.service";

/** GET ?status=&alertsOnly=1&search=: budget figures of the campaigns the viewer can see. */
export const GET = salesMarketingRoute({ module: "marketing_campaigns", action: "view" }, async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  return NextResponse.json({ data: await budgetOverview(actor, { status: sp.get("status") || undefined, alertsOnly: sp.get("alertsOnly") || undefined, search: sp.get("search") || undefined }) });
});
