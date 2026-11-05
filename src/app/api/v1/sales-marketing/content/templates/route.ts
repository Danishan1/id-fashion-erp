import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { listMarketingTemplates } from "@/modules/sales-marketing/content/marketing-template.service";

/** GET: CRM email / SMS / WhatsApp templates with their marketing review (?search &channelType &review=approved|pending|needs_review &page). */
export const GET = salesMarketingRoute({ module: "marketing_content", action: "view" }, async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize")) || 24));
  return NextResponse.json(await listMarketingTemplates(actor, { search: sp.get("search") ?? undefined, channelType: sp.get("channelType") ?? undefined, review: sp.get("review") ?? undefined }, page, pageSize));
});
