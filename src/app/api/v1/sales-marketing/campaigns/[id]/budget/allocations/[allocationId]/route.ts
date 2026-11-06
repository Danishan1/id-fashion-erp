import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { deleteAllocation, getCampaignBudget, updateAllocation } from "@/modules/sales-marketing/budgets/budget.service";

type P = { id: string; allocationId: string };

/** PATCH { ..., status?: ACTIVE | CLOSED, version }. */
export const PATCH = salesMarketingRoute<P>({ module: "marketing_campaigns", action: "edit" }, async ({ req, actor, params }) => {
  await updateAllocation(actor, params.id, params.allocationId, await req.json());
  return NextResponse.json({ data: await getCampaignBudget(actor, params.id) });
});

/** DELETE: only a line with no spend linked to it. */
export const DELETE = salesMarketingRoute<P>({ module: "marketing_campaigns", action: "edit" }, async ({ actor, params }) => {
  await deleteAllocation(actor, params.id, params.allocationId);
  return NextResponse.json({ data: await getCampaignBudget(actor, params.id) });
});
