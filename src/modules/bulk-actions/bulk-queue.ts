import { Queue } from "bullmq";
import { createRedisConnection, databaseScopedQueueName } from "@/core/jobs/queue";

/**
 * Phase 14 — background queue for bulk jobs, on the app's existing BullMQ +
 * Redis infrastructure and processed by the existing worker process
 * (`npm run worker`). The database is the source of truth: a queue message
 * only says "look at bulk job X"; the worker claims the job with a lease in
 * Postgres, so duplicate or lost messages are harmless (a recovery tick
 * re-enqueues anything that stalls).
 *
 * Queue name: `bulk-actions-<hash of DATABASE_URL>` (same rule as the import
 * queues — two checkouts sharing one Redis never take each other's jobs).
 */
export const BULK_ACTION_QUEUE_NAME = process.env.BULK_ACTION_QUEUE_NAME || databaseScopedQueueName("bulk-actions");

export type BulkQueueJob = { name: "bulk.process"; data: { bulkJobId: string } } | { name: "bulk.recover"; data: Record<string, never> };

let queue: Queue | null = null;

export function getBulkActionQueue(): Queue {
  if (!queue) queue = new Queue(BULK_ACTION_QUEUE_NAME, { connection: createRedisConnection() });
  return queue;
}

const ENQUEUE_TIMEOUT_MS = 5_000;

/**
 * Best-effort enqueue. Never throws: when Redis is unreachable the job simply
 * stays QUEUED in the database and the worker's recovery tick picks it up once
 * the queue is back. Returns false when the message couldn't be added.
 */
export async function enqueueBulkJob(bulkJobId: string, opts: { delayMs?: number } = {}): Promise<boolean> {
  if (!process.env.REDIS_URL) return false;
  try {
    const add = getBulkActionQueue().add(
      "bulk.process",
      { bulkJobId },
      {
        // One attempt: retries are handled by the job's own lease/recovery, not by BullMQ.
        attempts: 1,
        removeOnComplete: { age: 24 * 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600 },
        ...(opts.delayMs ? { delay: opts.delayMs } : {}),
      }
    );
    // ioredis queues commands while disconnected; don't let an API request hang on that.
    await Promise.race([add, new Promise((_, reject) => setTimeout(() => reject(new Error("enqueue timeout")), ENQUEUE_TIMEOUT_MS))]);
    return true;
  } catch (e) {
    console.error(JSON.stringify({ level: "warn", message: "Bulk job could not be enqueued; recovery will retry", bulkJobId, error: (e as Error).message }));
    return false;
  }
}
