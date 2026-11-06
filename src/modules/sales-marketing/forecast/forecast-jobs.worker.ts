import { Queue, Worker, type Job } from "bullmq";
import { createRedisConnection, databaseScopedQueueName } from "@/core/jobs/queue";
import { takeAutoSnapshotsForAllCompanies } from "./forecast-snapshot.service";

/**
 * Sales forecast background job (Phase 06), run inside the shared worker
 * (`npm run worker`). `forecast.auto-snapshots` runs every few hours and
 * takes the start-of-period snapshot (month, and quarter / year in their
 * first month) for every company that doesn't have one yet — idempotent,
 * so restarts and retries never duplicate a snapshot. If the worker is
 * stopped, the forecast still works; only that period's automatic snapshot
 * (and therefore its accuracy) is missing or marked late.
 */
export const FORECAST_JOBS_QUEUE_NAME = databaseScopedQueueName("sales-forecast");

export async function handleForecastJob(job: Pick<Job, "name">) {
  switch (job.name) {
    case "forecast.auto-snapshots":
      return takeAutoSnapshotsForAllCompanies();
    default:
      throw new Error(`Unknown forecast job "${job.name}"`);
  }
}

export function startForecastJobsWorker() {
  const worker = new Worker(FORECAST_JOBS_QUEUE_NAME, handleForecastJob, { connection: createRedisConnection(), concurrency: 1 });
  worker.on("failed", (job, error) => {
    console.error(JSON.stringify({ level: "error", message: "Forecast job failed", jobName: job?.name, jobId: job?.id, error: error?.message }));
  });
  worker.on("completed", (job) => {
    const rv = job.returnvalue as { created?: number } | undefined;
    if (!rv?.created) return;
    console.log(JSON.stringify({ level: "info", message: "Automatic forecast snapshots taken", ...rv }));
  });
  new Queue(FORECAST_JOBS_QUEUE_NAME, { connection: createRedisConnection() })
    .upsertJobScheduler(
      "forecast-auto-snapshots",
      { every: 6 * 60 * 60_000 },
      { name: "forecast.auto-snapshots", data: {}, opts: { attempts: 2, removeOnComplete: { count: 20 }, removeOnFail: { age: 7 * 24 * 3600 } } }
    )
    .catch((e: Error) => console.error(JSON.stringify({ level: "error", message: "Could not schedule forecast snapshots job", error: e.message })));
  console.log(JSON.stringify({ level: "info", message: `Forecast jobs worker started, listening on queue "${FORECAST_JOBS_QUEUE_NAME}"` }));
  return worker;
}
