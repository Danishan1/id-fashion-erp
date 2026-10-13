import { NextResponse } from "next/server";
import { buildListMeta, parseListQuery } from "@/lib/list-query";
import { parseBulkJobFilters } from "@/modules/bulk-actions/bulk-job.schema";
import { createBulkJob, listBulkJobs } from "@/modules/bulk-actions/bulk-jobs.service";
import { bulkRoute, readJsonBody } from "@/modules/bulk-actions/bulk-route";

/**
 * Phase 14 — bulk jobs.
 *   GET  ?statuses=RUNNING,FAILED&entityType=LEAD&mine=true&page=&pageSize=
 *        Own jobs, plus every job of entity types the user administers.
 *   POST { entityType, actionKey, selection: { mode: IDS|PAGE, ids } | { mode: FILTER, filterQuery },
 *          params, idempotencyKey?, confirmCount? } → 202 with the queued job.
 */
export const GET = bulkRoute(async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  const query = parseListQuery(sp);
  const { data, totalCount } = await listBulkJobs(actor, parseBulkJobFilters(sp), query);
  return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
});

export const POST = bulkRoute(async ({ req, actor }) => {
  const job = await createBulkJob(actor, await readJsonBody(req));
  return NextResponse.json({ data: job }, { status: job.duplicate ? 200 : 202 });
});
