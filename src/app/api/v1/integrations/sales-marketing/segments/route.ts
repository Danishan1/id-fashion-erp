import { pageMeta, pageOf, smApiRoute } from "@/modules/sales-marketing/integrations/sm-api-route";
import { apiListSegments } from "@/modules/sales-marketing/integrations/public-api.service";

/** GET /api/v1/integrations/sales-marketing/segments — segment metadata only (never members). Query: status, search, page, pageSize. Scope sm.segments:read. */
export const GET = smApiRoute({ scope: "sm.segments:read", endpoint: "GET /segments" }, async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  const p = pageOf(req);
  const r = await apiListSegments(actor, { status: sp.get("status") ?? undefined, search: sp.get("search") ?? undefined }, p);
  return { data: r.data, meta: pageMeta(r.total, p) };
});
