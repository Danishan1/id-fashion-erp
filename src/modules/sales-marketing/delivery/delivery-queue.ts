import { Queue } from "bullmq";
import { createRedisConnection, databaseScopedQueueName } from "@/core/jobs/queue";

/**
 * Queue for delivery work (Phase 10). Handlers are idempotent: they claim
 * runs (lease) and deliveries (guarded status update) before doing anything,
 * so a repeated or duplicated job can't send twice.
 */
export const DELIVERY_QUEUE_NAME = databaseScopedQueueName("marketing-delivery");

let queue: Queue | null = null;
function getQueue() {
  if (!queue) queue = new Queue(DELIVERY_QUEUE_NAME, { connection: createRedisConnection() });
  return queue;
}

const JOB_OPTS = { attempts: 1, removeOnComplete: { age: 24 * 3600, count: 1000 }, removeOnFail: { age: 7 * 24 * 3600 } };

/** Enqueue a run step. Returns false when Redis isn't configured / reachable (the caller decides what to do). */
export async function enqueueRunStep(step: "run.prepare" | "run.dispatch", runId: string, at?: Date | null): Promise<boolean> {
  if (!process.env.REDIS_URL) return false;
  const delay = at ? Math.max(0, at.getTime() - Date.now()) : 0;
  // Extra jobs are harmless: a run is worked on only under its lease.
  try {
    await getQueue().add(step, { runId }, { ...JOB_OPTS, delay, jobId: `${step}-${runId}-${Date.now() + delay}` });
    return true;
  } catch {
    return false;
  }
}

export async function enqueueEventProcessing(): Promise<boolean> {
  if (!process.env.REDIS_URL) return false;
  try {
    await getQueue().add("events.process", {}, { ...JOB_OPTS, jobId: `events-process-${Math.floor(Date.now() / 5_000)}` });
    return true;
  } catch {
    return false;
  }
}
