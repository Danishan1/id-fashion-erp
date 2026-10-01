import { parseListQuery } from "@/lib/list-query";
import { crmListResponse, crmRoute } from "@/modules/crm/core/crm-route";
import { parseCrmEventFilters } from "@/modules/crm/core/crm-event.schema";
import { listCrmEvents } from "@/modules/crm/core/crm-events.service";

/**
 * CRM activity/timeline feed for the caller's company.
 * Query: page, pageSize (≤100), search, sortOrder (asc|desc, default desc),
 * entityType, entityId (requires entityType), eventType, actorUserId,
 * from / to (YYYY-MM-DD, inclusive).
 */
export const GET = crmRoute("view", async ({ req, actor }) => {
  const query = parseListQuery(req.nextUrl.searchParams, "occurredAt");
  const filters = parseCrmEventFilters(req.nextUrl.searchParams);
  const { data, totalCount } = await listCrmEvents(actor.companyId, filters, query);
  return crmListResponse(data, totalCount, query);
});
