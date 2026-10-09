import { parseListQuery } from "@/lib/list-query";
import { crmListResponse, crmRoute } from "@/modules/crm/core/crm-route";
import { parseCrmEventFilters } from "@/modules/crm/core/crm-event.schema";
import { listCrmEvents } from "@/modules/crm/core/crm-events.service";
import { getCrmRecordScope } from "@/modules/crm/core/crm-visibility";
import { assertCrmEntityAccess, companyTimelineScope, mergedContactIds } from "@/modules/crm/crm-entity-access";
import { CrmActivityRepository } from "@/modules/crm/activities/crm-activity.repository";

/**
 * CRM activity/timeline feed for the caller's company.
 * Query: page, pageSize (≤100), search, sortOrder (asc|desc, default desc),
 * entityType, entityId (requires entityType), eventType, actorUserId,
 * from / to (YYYY-MM-DD, inclusive, business days).
 *
 * A record's timeline includes its activities' events (Phase 09).
 *
 * Visibility: a record's timeline needs access to that record. The
 * company-wide feed shows everything to crm.view_all holders and only the
 * caller's own actions to everyone else.
 */
export const GET = crmRoute("view", async ({ req, actor }) => {
  const query = parseListQuery(req.nextUrl.searchParams, "occurredAt");
  const filters = parseCrmEventFilters(req.nextUrl.searchParams);
  let related: string[] = [];
  let scopes: { entityType: "CONTACT" | "LEAD" | "ACTIVITY"; ids: string[] }[] = [];
  if (filters.entityType && filters.entityId) {
    await assertCrmEntityAccess(actor, filters.entityType as never, filters.entityId);
    // A record's timeline includes the history of records merged into it.
    if (filters.entityType === "CONTACT") related = await mergedContactIds(actor.companyId, filters.entityId);
    if (filters.entityType === "COMPANY") {
      // ?includeRelated=true also shows the company's contacts' and leads' events (visible ones only).
      const t = await companyTimelineScope(actor, filters.entityId, req.nextUrl.searchParams.get("includeRelated") === "true");
      related = t.companyIds;
      scopes = [
        { entityType: "CONTACT", ids: t.contactIds },
        { entityType: "LEAD", ids: t.leadIds },
      ];
    }
    // Phase 09: a record's timeline also shows the events of the activities linked to it (newest 500).
    if (filters.entityType !== "ACTIVITY") {
      const activityIds = await CrmActivityRepository.linkedActivityIds(actor.companyId, filters.entityType as never, [filters.entityId, ...related]);
      if (activityIds.length) scopes = [...scopes, { entityType: "ACTIVITY", ids: activityIds }];
    }
  } else if ((await getCrmRecordScope(actor)).mode === "OWN") {
    filters.actorUserId = actor.userId;
  }
  const { data, totalCount } = await listCrmEvents(actor.companyId, filters, query, related, scopes);
  return crmListResponse(data, totalCount, query);
});
