import { parseListQuery } from "@/lib/list-query";
import { crmListResponse, crmRoute } from "@/modules/crm/core/crm-route";
import { listIngestEvents } from "@/modules/crm/capture/crm-ingest-events.service";

/** API & webhook submission log (crm_settings.view). Query: status, channel, page, pageSize. */
export const GET = crmRoute({ module: "crm_settings", action: "view" }, async ({ req, actor }) => {
  const query = parseListQuery(req.nextUrl.searchParams);
  const sp = req.nextUrl.searchParams;
  const { data, totalCount } = await listIngestEvents(actor, { status: sp.get("status") || undefined, channel: sp.get("channel") || undefined }, query);
  return crmListResponse(data, totalCount, query);
});
