import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { requestPlanChange } from "@/modules/sales-marketing/campaigns/campaign.service";
import { getCampaign } from "@/modules/sales-marketing/campaigns/campaign-results.service";

/** POST { plannedStartDate, plannedEndDate, plannedBudget, budgetNotes, reason }: ask for a plan change on an approved campaign. */
export const POST = salesMarketingRoute<{ id: string }>({ module: "marketing_campaigns", action: "edit" }, async ({ req, actor, params }) => {
  await requestPlanChange(actor, params.id, await req.json());
  return NextResponse.json({ data: await getCampaign(actor, params.id) }, { status: 201 });
});
