import { Worker, type Job } from "bullmq";
import { createRedisConnection } from "@/core/jobs/queue";
import { processBulkJob, recoverBulkJobs } from "./bulk-engine";
import { BULK_ACTION_QUEUE_NAME, enqueueBulkJob, getBulkActionQueue } from "./bulk-queue";

/**
 * Phase 14 — bulk job processing inside the shared worker process
 * (src/core/jobs/worker.ts → `npm run worker`). Concurrency 2: two jobs can
 * run side by side; one job is never processed twice at the same time (the
 * Postgres lease in bulk-engine.ts). A recovery tick every minute resumes
 * jobs whose worker died and re-sends queue messages that were lost.
 */
export async function handleBulkJob(job: Job) {
  switch (job.name) {
    case "bulk.process":
      return { status: await processBulkJob(String(job.data.bulkJobId)) };
    case "bulk.recover":
      return recoverBulkJobs(new Date(), enqueueBulkJob);
    default:
      throw new Error(`Unknown bulk job "${job.name}"`);
  }
}

export function startBulkActionWorker() {
  const worker = new Worker(BULK_ACTION_QUEUE_NAME, handleBulkJob, { connection: createRedisConnection(), concurrency: 2 });
  worker.on("failed", (job, error) => {
    console.error(JSON.stringify({ level: "error", message: "Bulk action job failed", jobName: job?.name, jobId: job?.id, bulkJobId: job?.data?.bulkJobId, error: error?.message }));
  });
  worker.on("completed", (job) => {
    if (job.name === "bulk.recover") {
      const rv = job.returnvalue as { resumed?: string[]; expiredFiles?: number } | undefined;
      if (!rv?.resumed?.length && !rv?.expiredFiles) return;
    }
    console.log(JSON.stringify({ level: "info", message: "Bulk action job completed", jobName: job.name, bulkJobId: job.data?.bulkJobId, result: job.returnvalue }));
  });
  getBulkActionQueue()
    .upsertJobScheduler("bulk-recover", { every: 60_000 }, { name: "bulk.recover", data: {}, opts: { attempts: 1, removeOnComplete: { count: 50 }, removeOnFail: { age: 24 * 3600 } } })
    .catch((e: Error) => console.error(JSON.stringify({ level: "error", message: "Could not schedule bulk job recovery", error: e.message })));
  console.log(JSON.stringify({ level: "info", message: `Bulk action worker started, listening on queue "${BULK_ACTION_QUEUE_NAME}"` }));
  return worker;
}
