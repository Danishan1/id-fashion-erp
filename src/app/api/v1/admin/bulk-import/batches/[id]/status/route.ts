import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getImportBatchById } from "@/modules/import/import.service";
import { getBulkImportQueue } from "@/core/jobs/queue";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Polled by the Admin UI's progress bar. Combines the DB row (authoritative
 * once the worker finalizes it) with the BullMQ job's own live progress
 * while still QUEUED/PROCESSING — a transient Redis hiccup here degrades to
 * "no live progress available" rather than failing the whole status check,
 * since the DB status/counts are always meaningful on their own.
 */
export async function GET(_req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "administration_settings", "create");

    const { id } = await params;
    const batch = await getImportBatchById(session.user.companyId, id);

    let jobProgress: { processed: number; total: number } | null = null;
    let jobState: string | null = null;
    if (batch.jobId && (batch.status === "QUEUED" || batch.status === "PROCESSING")) {
      try {
        const job = await getBulkImportQueue().getJob(batch.jobId);
        if (job) {
          jobState = await job.getState();
          if (job.progress && typeof job.progress === "object") {
            jobProgress = job.progress as { processed: number; total: number };
          }
        }
      } catch {
        // Redis unreachable or job already purged — the DB fields below
        // still tell the caller everything it needs for a stalled/completed
        // batch, so this is deliberately non-fatal.
      }
    }

    return NextResponse.json({
      data: {
        id: batch.id,
        status: batch.status,
        totalRows: batch.totalRows,
        importedCount: batch.importedCount,
        skippedCount: batch.skippedCount,
        hasFailedRows: batch.failedRowsJson !== null,
        jobState,
        jobProgress,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
