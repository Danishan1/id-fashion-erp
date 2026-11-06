import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getCampaignBudget, unlinkSpend } from "@/modules/sales-marketing/budgets/budget.service";

/** POST { kind, recordId, reason }: the record no longer counts for this campaign. */
export const POST = salesMarketingRoute<{ id: string }>({ module: "marketing_campaigns", action: "edit" }, async ({ req, actor, params }) => {
  await unlinkSpend(actor, params.id, await req.json());
  return NextResponse.json({ data: await getCampaignBudget(actor, params.id) });
});
