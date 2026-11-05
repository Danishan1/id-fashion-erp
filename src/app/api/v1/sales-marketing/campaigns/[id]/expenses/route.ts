import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getCampaign, linkExpense, searchLinkableExpenses } from "@/modules/sales-marketing/campaigns/campaign-results.service";

type P = { id: string };

/** GET ?search=: unlinked expenses that can be linked (needs expenses.view). POST { expenseId }: link one. */
export const GET = salesMarketingRoute<P>({ module: "marketing_campaigns", action: "edit" }, async ({ req, actor, params }) =>
  NextResponse.json({ data: await searchLinkableExpenses(actor, params.id, req.nextUrl.searchParams.get("search") ?? undefined) })
);

export const POST = salesMarketingRoute<P>({ module: "marketing_campaigns", action: "edit" }, async ({ req, actor, params }) => {
  await linkExpense(actor, params.id, await req.json());
  return NextResponse.json({ data: await getCampaign(actor, params.id) }, { status: 201 });
});
