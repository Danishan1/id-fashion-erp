import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { createAllocation, getCampaignBudget } from "@/modules/sales-marketing/budgets/budget.service";

/** POST { name, categoryId, campaignChannelId?, amount, notes? }: a budget line (lines can't add up to more than the approved budget). */
export const POST = salesMarketingRoute<{ id: string }>({ module: "marketing_campaigns", action: "edit" }, async ({ req, actor, params }) => {
  await createAllocation(actor, params.id, await req.json());
  return NextResponse.json({ data: await getCampaignBudget(actor, params.id) }, { status: 201 });
});
