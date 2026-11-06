import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { listReviews } from "@/modules/sales-marketing/content/content-review.service";

/** GET: review queue (?status=PENDING|APPROVED|CHANGES_REQUESTED|REJECTED|WITHDRAWN &subjectType &page). */
export const GET = salesMarketingRoute({ module: "marketing_content", action: "view" }, async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize")) || 24));
  return NextResponse.json(await listReviews(actor, { status: sp.get("status") ?? undefined, subjectType: sp.get("subjectType") ?? undefined }, page, pageSize));
});
