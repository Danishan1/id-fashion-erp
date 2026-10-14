import { createHash } from "node:crypto";
import { Queue, Worker, type Job } from "bullmq";
import { createRedisConnection } from "@/core/jobs/queue";
import { processSubscriptionLifecycle } from "./subscription-lifecycle.service";

/**
 * Platform background jobs (Platform SaaS Phase 4, PLAT-023), run inside the
 * shared worker process (`npm run worker`). Queue name derived from
 * DATABASE_URL like every other queue, so two checkouts sharing one Redis
 * never pick up each other's jobs.
 */
function deriveQueueName(): string {
  if (process.env.PLATFORM_JOBS_QUEUE_NAME) return process.env.PLATFORM_JOBS_QUEUE_NAME;
  const dbUrl = process.env.DATABASE_URL;
  const suffix = dbUrl ? createHash("sha256").update(dbUrl).digest("hex").slice(0, 12) : "unknown-db";
  return `platform-jobs-${suffix}`;
}

export const PLATFORM_JOBS_QUEUE_NAME = deriveQueueName();

async function handlePlatformJob(job: Job) {
  switch (job.name) {
    case "subscription.lifecycle":
      return processSubscriptionLifecycle(new Date());
    default:
      throw new Error(`Unknown platform job "${job.name}"`);
  }
}

export function startPlatformJobsWorker() {
  const worker = new Worker(PLATFORM_JOBS_QUEUE_NAME, handlePlatformJob, { connection: createRedisConnection(), concurrency: 1 });
  worker.on("failed", (job, error) => {
    console.error(JSON.stringify({ level: "error", message: "Platform job failed", jobName: job?.name, jobId: job?.id, error: error?.message }));
  });
  worker.on("completed", (job) => {
    const rv = job.returnvalue as { sent?: number } | undefined;
    if (!rv?.sent) return;
    console.log(JSON.stringify({ level: "info", message: "Subscription notices sent", sent: rv.sent }));
  });
  // Hourly; the scheduler id makes this idempotent across restarts / several workers.
  new Queue(PLATFORM_JOBS_QUEUE_NAME, { connection: createRedisConnection() })
    .upsertJobScheduler(
      "subscription-lifecycle",
      { every: 60 * 60_000 },
      { name: "subscription.lifecycle", data: {}, opts: { attempts: 1, removeOnComplete: { count: 50 }, removeOnFail: { age: 7 * 24 * 3600 } } }
    )
    .catch((e: Error) => console.error(JSON.stringify({ level: "error", message: "Could not schedule subscription lifecycle job", error: e.message })));
  console.log(JSON.stringify({ level: "info", message: `Platform jobs worker started, listening on queue "${PLATFORM_JOBS_QUEUE_NAME}"` }));
  return worker;
}
