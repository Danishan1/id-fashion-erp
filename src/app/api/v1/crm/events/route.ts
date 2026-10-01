import { parseListQuery } from "@/lib/list-query";
import { crmListResponse, crmRoute } from "@/modules/crm/core/crm-route";
import { parseCrmEventFilters } from "@/modules/crm/core/crm-event.schema";
import { listCrmEvents } from "@/modules/crm/core/crm-events.service";
import { getCrmRecordScope } from "@/modules/crm/core/crm-visibility";
import { assertCrmEntityAccess } from "@/modules/crm/crm-entity-access";

/**
 * CRM activity/timeline feed for the caller's company.
 * Query: page, pageSize (≤100), search, sortOrder (asc|desc, default desc),
 * entityType, entityId (requires entityType), eventType, actorUserId,
 * from / to (YYYY-MM-DD, inclusive, business days).
 *
 * Visibility: a record's timeline needs access to that record. The
 * company-wide feed shows everything to crm.view_all holders and only the
 * caller's own actions to everyone else.
 */
export const GET = crmRoute("view", async ({ req, actor }) => {
  const query = parseListQuery(req.nextUrl.searchParams, "occurredAt");
  const filters = parseCrmEventFilters(req.nextUrl.searchParams);
  if (filters.entityType && filters.entityId) {
    await assertCrmEntityAccess(actor, filters.entityType as never, filters.entityId);
  } else if ((await getCrmRecordScope(actor)).mode === "OWN") {
    filters.actorUserId = actor.userId;
  }
  const { data, totalCount } = await listCrmEvents(actor.companyId, filters, query);
  return crmListResponse(data, totalCount, query);
});
