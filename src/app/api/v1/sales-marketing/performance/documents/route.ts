import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { listCreditedDocuments } from "@/modules/sales-marketing/performance/performance-board.service";

const KEYS = ["metric", "periodType", "periodStart", "repId", "teamManagerId", "territoryId", "bucket"] as const;

/** GET: the orders / quotations / invoices behind one board figure. */
export const GET = salesMarketingRoute({ module: "sales_performance", action: "view" }, async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  return NextResponse.json({ data: await listCreditedDocuments(actor, Object.fromEntries(KEYS.map((k) => [k, sp.get(k) ?? ""]))) });
});
