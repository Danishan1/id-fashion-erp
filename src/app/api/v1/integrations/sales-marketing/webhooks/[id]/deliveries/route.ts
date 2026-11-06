import { pageOf, smApiRoute } from "@/modules/sales-marketing/integrations/sm-api-route";
import { listSmDeliveries } from "@/modules/sales-marketing/integrations/sm-webhooks.service";

/** GET delivery status (outcome only: status, attempts, HTTP status, reason — never payloads). Query: status, page, pageSize. Scope sm.webhooks:manage. */
export const GET = smApiRoute<{ id: string }>({ scope: "sm.webhooks:manage", endpoint: "GET /webhooks/{id}/deliveries" }, async ({ req, actor, params }) => {
  const p = pageOf(req);
  const r = await listSmDeliveries(actor, params.id, { status: req.nextUrl.searchParams.get("status") ?? undefined, skip: p.skip, take: p.take });
  return { data: r.rows, meta: { page: p.page, pageSize: p.pageSize, total: r.totalCount } };
});
