import { Queue, Worker, type Job } from "bullmq";
import { createRedisConnection, databaseScopedQueueName } from "@/core/jobs/queue";
import { prisma } from "@/core/db/client";
import { executeRun, queueScheduledRuns, recoverRuns } from "./attribution-run.service";
import { syncAttributionSources } from "./attribution-sync.service";

/**
 * Attribution background jobs (Phase 13), in the shared worker:
 *  - `attribution.run`      one calculation (jobId = run id, so a double enqueue is harmless;
 *                           the run itself only claims a QUEUED row)
 *  - `attribution.sync`     every 30 min: incremental sync of touchpoints / conversions for
 *                           companies that use attribution (keeps "out of date" honest)
 *  - `attribution.nightly`  recalculates the last 365 days of every model in use
 *  - `attribution.recover`  every 10 min: fails stuck runs, re-enqueues lost queued runs
 * Without Redis the API runs a requested calculation after the response.
 */
export const ATTRIBUTION_JOBS_QUEUE_NAME = databaseScopedQueueName("marketing-attribution");

let queue: Queue | null = null;
function getQueue() {
  if (!queue) queue = new Queue(ATTRIBUTION_JOBS_QUEUE_NAME, { connection: createRedisConnection() });
  return queue;
}

/** Enqueue one run. Returns false when the queue isn't reachable (caller runs it after the response). */
export async function scheduleAttributionRun(runId: string): Promise<boolean> {
  if (!process.env.REDIS_URL) return false;
  try {
    await getQueue().add("attribution.run", { runId }, { jobId: `attribution-run-${runId}`, attempts: 1, removeOnComplete: { age: 7 * 24 * 3600, count: 200 }, removeOnFail: { age: 30 * 24 * 3600 } });
    return true;
  } catch {
    return false;
  }
}

async function companiesUsingAttribution() {
  const rows = await prisma.marketingAttributionModel.findMany({ where: { status: "ACTIVE" }, distinct: ["companyId"], select: { companyId: true } });
  return rows.map((r) => r.companyId);
}

export async function handleAttributionJob(job: Pick<Job, "name" | "data">) {
  switch (job.name) {
    case "attribution.run":
      return { ran: await executeRun((job.data as { runId: string }).runId) };
    case "attribution.sync": {
      let companies = 0;
      for (const c of await companiesUsingAttribution()) {
        await syncAttributionSources(c);
        companies++;
      }
      return { companies };
    }
    case "attribution.nightly": {
      const ids = await queueScheduledRuns();
      for (const id of ids) if (!(await scheduleAttributionRun(id))) await executeRun(id);
      return { queued: ids.length };
    }
    case "attribution.recover": {
      const r = await recoverRuns();
      for (const id of r.queued) await scheduleAttributionRun(id);
      return { failed: r.failed, requeued: r.queued.length };
    }
    default:
      throw new Error(`Unknown attribution job "${job.name}"`);
  }
}

export function startAttributionJobsWorker() {
  const worker = new Worker(ATTRIBUTION_JOBS_QUEUE_NAME, handleAttributionJob, { connection: createRedisConnection(), concurrency: 1 });
  worker.on("failed", (job, error) => {
    console.error(JSON.stringify({ level: "error", message: "Attribution job failed", jobName: job?.name, jobId: job?.id, error: error?.message }));
  });
  const q = new Queue(ATTRIBUTION_JOBS_QUEUE_NAME, { connection: createRedisConnection() });
  const opts = { attempts: 1, removeOnComplete: { count: 20 }, removeOnFail: { age: 7 * 24 * 3600 } };
  // 03:10 Asia/Kolkata = 21:40 UTC.
  q.upsertJobScheduler("attribution-nightly", { pattern: "40 21 * * *" }, { name: "attribution.nightly", data: {}, opts })
    .then(() => q.upsertJobScheduler("attribution-sync", { every: 30 * 60_000 }, { name: "attribution.sync", data: {}, opts }))
    .then(() => q.upsertJobScheduler("attribution-recover", { every: 10 * 60_000 }, { name: "attribution.recover", data: {}, opts }))
    .catch((e: Error) => console.error(JSON.stringify({ level: "error", message: "Could not schedule attribution jobs", error: e.message })));
  console.log(JSON.stringify({ level: "info", message: `Attribution jobs worker started, listening on queue "${ATTRIBUTION_JOBS_QUEUE_NAME}"` }));
  return worker;
}
