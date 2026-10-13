import { NextResponse } from "next/server";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { buildListMeta, parseListQuery } from "@/lib/list-query";
import { parseBulkItemFilters } from "@/modules/bulk-actions/bulk-job.schema";
import { buildBulkErrorReport, cancelBulkJob, downloadBulkExport, getBulkJob, listBulkJobItems, retryBulkJob } from "@/modules/bulk-actions/bulk-jobs.service";
import { bulkRoute, readJsonBody } from "@/modules/bulk-actions/bulk-route";

/**
 * Phase 14 — one catch-all for /api/v1/bulk-jobs/{id}/... (keeps folder nesting shallow).
 *
 *   GET  /{id}            job detail (status, counters, progress, error, retries, download info)
 *   GET  /{id}/items      ?statuses=FAILED,SKIPPED&page=&pageSize=  per-record outcomes
 *   GET  /{id}/errors     CSV of failed / skipped / not-processed records with reasons
 *   GET  /{id}/download   the export file (requester only, until it expires)
 *   POST /{id}/cancel     stop records that haven't started (nothing is rolled back)
 *   POST /{id}/retry      { idempotencyKey? } → a new job for the failed records
 */
type Params = { path: string[] };

function notFound(): never {
  throw new BusinessRuleError("NOT_FOUND", "Unknown bulk job endpoint.");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idOf(path: string[]) {
  const [id, sub, ...rest] = path;
  if (!id || !UUID.test(id) || rest.length) notFound();
  return { id, sub };
}

function fileResponse(buffer: Buffer, fileName: string, mimeType: string) {
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": mimeType,
      "Content-Disposition": `attachment; filename="${fileName.replace(/[^\w.-]/g, "_")}"`,
      "Content-Length": String(buffer.byteLength),
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const GET = bulkRoute<Params>(async ({ req, params, actor }) => {
  const { id, sub } = idOf(params.path);
  if (!sub) return NextResponse.json({ data: await getBulkJob(actor, id) });
  if (sub === "items") {
    const sp = req.nextUrl.searchParams;
    const query = parseListQuery(sp, "sequence");
    const { data, totalCount } = await listBulkJobItems(actor, id, parseBulkItemFilters(sp), query);
    return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
  }
  if (sub === "errors") {
    const r = await buildBulkErrorReport(actor, id);
    return fileResponse(r.buffer, r.fileName, "text/csv; charset=utf-8");
  }
  if (sub === "download") {
    const r = await downloadBulkExport(actor, id);
    return fileResponse(r.buffer, r.fileName, r.mimeType);
  }
  notFound();
});

export const POST = bulkRoute<Params>(async ({ req, params, actor }) => {
  const { id, sub } = idOf(params.path);
  if (sub === "cancel") return NextResponse.json({ data: await cancelBulkJob(actor, id) });
  if (sub === "retry") {
    const job = await retryBulkJob(actor, id, await readJsonBody(req));
    return NextResponse.json({ data: job }, { status: job.duplicate ? 200 : 202 });
  }
  notFound();
});
