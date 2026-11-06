import { NextResponse } from "next/server";
import { listConflicts } from "@/modules/sales-marketing/integrations/enquiry-intake.service";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";

/** Sync conflicts: ?status=OPEN|KEPT_ERP|APPLIED_EXTERNAL|DISMISSED&skip=&take=. */
export const GET = salesMarketingRoute({ module: "sales_integrations", action: "view" }, async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  const skip = Math.max(0, Number(sp.get("skip") ?? 0) || 0);
  const take = Math.min(100, Math.max(1, Number(sp.get("take") ?? 25) || 25));
  return NextResponse.json({ data: await listConflicts(actor, { status: sp.get("status") ?? undefined, skip, take }) });
});
