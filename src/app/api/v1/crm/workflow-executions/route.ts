import { parseListQuery } from "@/lib/list-query";
import { crmListResponse, crmRoute } from "@/modules/crm/core/crm-route";
import { listExecutions } from "@/modules/crm/workflows/crm-workflows.service";
import { parseExecutionFilters } from "@/modules/crm/workflows/workflow.schema";

/** Phase 18 — every workflow execution: ?workflowId=&statuses=&entityType=&entityId=&mode=LIVE|TEST, paging. */
export const GET = crmRoute({ module: "crm_settings", action: "view" }, async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  const query = parseListQuery(sp, "createdAt");
  const { data, totalCount } = await listExecutions(actor, parseExecutionFilters(sp), query);
  return crmListResponse(data, totalCount, query);
});
