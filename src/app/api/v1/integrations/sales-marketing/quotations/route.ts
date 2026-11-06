import { pageMeta, pageOf, smApiRoute } from "@/modules/sales-marketing/integrations/sm-api-route";
import { apiListQuotations } from "@/modules/sales-marketing/integrations/public-api.service";

/** GET /api/v1/integrations/sales-marketing/quotations — newest change first. Query: status (comma list), customerId, enquiryId, updatedSince (ISO), page, pageSize. Scope sm.quotations:read. */
export const GET = smApiRoute({ scope: "sm.quotations:read", endpoint: "GET /quotations" }, async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  const p = pageOf(req);
  const r = await apiListQuotations(actor, { status: sp.get("status") ?? undefined, customerId: sp.get("customerId") ?? undefined, enquiryId: sp.get("enquiryId") ?? undefined, updatedSince: sp.get("updatedSince") ?? undefined }, p);
  return { data: r.data, meta: pageMeta(r.total, p) };
});
