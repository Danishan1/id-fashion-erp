import { parseListQuery } from "@/lib/list-query";
import { crmListResponse, crmRoute } from "@/modules/crm/core/crm-route";
import { listCrmEvents } from "@/modules/crm/core/crm-events.service";
import { loadActivity } from "@/modules/crm/activities/crm-activities.service";

/** The activity's own history (created, assigned, rescheduled, completed…), newest first. */
export const GET = crmRoute<{ id: string }>("view", async ({ req, params, actor }) => {
  await loadActivity(actor, params.id);
  const query = parseListQuery(req.nextUrl.searchParams, "occurredAt");
  const { data, totalCount } = await listCrmEvents(actor.companyId, { entityType: "ACTIVITY", entityId: params.id }, query);
  return crmListResponse(data, totalCount, query);
});
