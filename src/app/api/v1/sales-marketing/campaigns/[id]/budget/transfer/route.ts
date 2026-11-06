import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getCampaignBudget, transferAllocation } from "@/modules/sales-marketing/budgets/budget.service";

/** POST { fromId, toId, amount, reason }: move budget between two lines of the campaign. */
export const POST = salesMarketingRoute<{ id: string }>({ module: "marketing_campaigns", action: "edit" }, async ({ req, actor, params }) => {
  await transferAllocation(actor, params.id, await req.json());
  return NextResponse.json({ data: await getCampaignBudget(actor, params.id) });
});
