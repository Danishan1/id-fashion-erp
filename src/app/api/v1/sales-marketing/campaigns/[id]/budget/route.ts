import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getCampaignBudget } from "@/modules/sales-marketing/budgets/budget.service";

/** GET: approved budget, allocation lines, linked spend and alerts. */
export const GET = salesMarketingRoute<{ id: string }>({ module: "marketing_campaigns", action: "view" }, async ({ actor, params }) => NextResponse.json({ data: await getCampaignBudget(actor, params.id) }));
