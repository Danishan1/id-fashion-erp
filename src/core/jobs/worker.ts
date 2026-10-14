import "dotenv/config";
import { Worker, type Job } from "bullmq";
import { createRedisConnection, BULK_IMPORT_QUEUE_NAME } from "./queue";
import { processBulkImportJob } from "@/modules/import/bulk-import.service";
import type { BulkImportActorContext } from "@/modules/import/bulk-import.service";
import type { BulkImportMasterType } from "@/modules/import/import.schema";
import { startCrmIngestWorker } from "@/modules/crm/imports/crm-import.worker";
import { startPlatformJobsWorker } from "@/modules/platform/platform-jobs.worker";

/**
 * Standalone process for the Bulk Master Data Import background queue —
 * run as `npm run worker`, separate from `next dev`/`next start`. This is
 * the ONLY place `processBulkImportJob` (a per-row-isolation write loop) is
 * ever invoked; the API routes only ever enqueue, never process directly,
 * which is what actually makes the commit endpoint return immediately
 * instead of blocking on however long 5,000-10,000 rows takes.
 *
 * `import "dotenv/config"` is required here (unlike the rest of this app,
 * which reads env vars via Next.js's own automatic .env loading) because
 * this script runs completely outside the Next.js process.
 */
interface BulkImportJobData {
  batchId: string;
  masterType: BulkImportMasterType;
  actor: BulkImportActorContext;
  rows: Record<string, string>[];
}

const worker = new Worker<BulkImportJobData>(
  BULK_IMPORT_QUEUE_NAME,
  async (job: Job<BulkImportJobData>) => {
    const { batchId, masterType, actor, rows } = job.data;
    await processBulkImportJob(batchId, masterType, actor, rows, async (processed, total) => {
      await job.updateProgress({ processed, total });
    });
  },
  { connection: createRedisConnection(), concurrency: 1 }
);

worker.on("completed", (job) => {
  console.log(JSON.stringify({ level: "info", message: "Bulk import job completed", jobId: job.id, batchId: job.data.batchId }));
});

worker.on("failed", (job, error) => {
  console.error(
    JSON.stringify({
      level: "error",
      message: "Bulk import job failed",
      jobId: job?.id,
      batchId: job?.data?.batchId,
      error: error?.message,
    })
  );
});

console.log(JSON.stringify({ level: "info", message: `Bulk import worker started, listening on queue "${BULK_IMPORT_QUEUE_NAME}"` }));

// CRM lead import & capture jobs (Phase 03) share this worker process.
const crmWorker = startCrmIngestWorker();

// Platform SaaS Phase 4: hourly subscription lifecycle notices.
const platformWorker = startPlatformJobsWorker();

process.on("SIGTERM", async () => {
  await Promise.all([worker.close(), crmWorker.close(), platformWorker.close()]);
  process.exit(0);
});
process.on("SIGINT", async () => {
  await Promise.all([worker.close(), crmWorker.close(), platformWorker.close()]);
  process.exit(0);
});

