import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getCampaignBudget, linkSpend, searchLinkableSpend } from "@/modules/sales-marketing/budgets/budget.service";

type P = { id: string };

/** GET ?kind=EXPENSE|PURCHASE_ORDER|PURCHASE_INVOICE&search=: records that can be linked (needs that module's view). */
export const GET = salesMarketingRoute<P>({ module: "marketing_campaigns", action: "edit" }, async ({ req, actor, params }) => {
  const sp = req.nextUrl.searchParams;
  return NextResponse.json({ data: await searchLinkableSpend(actor, params.id, sp.get("kind") ?? "", sp.get("search") ?? undefined) });
});

/** POST { kind, recordId, allocationId? }: link a record, or move a linked one to another budget line. */
export const POST = salesMarketingRoute<P>({ module: "marketing_campaigns", action: "edit" }, async ({ req, actor, params }) => {
  await linkSpend(actor, params.id, await req.json());
  return NextResponse.json({ data: await getCampaignBudget(actor, params.id) });
});
