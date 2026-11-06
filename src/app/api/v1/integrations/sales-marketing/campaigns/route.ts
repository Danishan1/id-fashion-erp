import { pageMeta, pageOf, smApiRoute } from "@/modules/sales-marketing/integrations/sm-api-route";
import { apiListCampaigns } from "@/modules/sales-marketing/integrations/public-api.service";

/** GET /api/v1/integrations/sales-marketing/campaigns — campaigns the key's user can see. Query: status (comma list), from, to (YYYY-MM-DD, ≤ 366 days), search, page, pageSize (≤ 100). Scope sm.campaigns:read. */
export const GET = smApiRoute({ scope: "sm.campaigns:read", endpoint: "GET /campaigns" }, async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  const p = pageOf(req);
  const r = await apiListCampaigns(actor, { status: sp.get("status") ?? undefined, from: sp.get("from") ?? undefined, to: sp.get("to") ?? undefined, search: sp.get("search") ?? undefined }, p);
  return { data: r.data, meta: pageMeta(r.total, p) };
});
