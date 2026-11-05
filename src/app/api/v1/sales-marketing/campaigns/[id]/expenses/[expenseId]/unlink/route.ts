import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getCampaign, unlinkExpense } from "@/modules/sales-marketing/campaigns/campaign-results.service";

/** POST { reason }: unlink an expense (the expense itself is untouched). */
export const POST = salesMarketingRoute<{ id: string; expenseId: string }>({ module: "marketing_campaigns", action: "edit" }, async ({ req, actor, params }) => {
  await unlinkExpense(actor, params.id, params.expenseId, await req.json());
  return NextResponse.json({ data: await getCampaign(actor, params.id) });
});
