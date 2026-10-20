import { NextResponse } from "next/server";
import { parseListQuery } from "@/lib/list-query";
import { crmListResponse, crmRoute } from "@/modules/crm/core/crm-route";
import { createWorkflow, listWorkflows } from "@/modules/crm/workflows/crm-workflows.service";
import { parseWorkflowFilters } from "@/modules/crm/workflows/workflow.schema";

/**
 * Phase 18 — workflow automation.
 * GET: list (search, ?statuses=, ?triggers=, paging). POST: create (DRAFT, draft version 1).
 * Workflows are configuration, so they need crm_settings permissions.
 */
export const GET = crmRoute({ module: "crm_settings", action: "view" }, async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  const query = parseListQuery(sp, "updatedAt");
  const { data, totalCount } = await listWorkflows(actor, parseWorkflowFilters(sp), query);
  return crmListResponse(data, totalCount, query);
});

export const POST = crmRoute({ module: "crm_settings", action: "edit" }, async ({ req, actor }) =>
  NextResponse.json({ data: await createWorkflow(actor, await req.json()) }, { status: 201 })
);
