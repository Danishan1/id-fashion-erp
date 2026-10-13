import { createHash } from "node:crypto";
import { Queue } from "bullmq";
import IORedis from "ioredis";

/**
 * First background-job infrastructure in this app (2026-09-04, Bulk Master
 * Data Import). REDIS_URL is required for this specific feature only --
 * every other part of the app remains fully synchronous and has no
 * dependency on Redis being reachable.
 *
 * `maxRetriesPerRequest: null` is BullMQ's own documented requirement for
 * the connection it's handed (it manages retries/blocking itself).
 */
function createConnection() {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error(
      "REDIS_URL is not set — required for the Bulk Master Data Import background queue. See .env.example."
    );
  }
  return new IORedis(url, { maxRetriesPerRequest: null });
}

/**
 * Real incident, 2026-09-11: REDIS_URL points at one shared cloud Redis
 * instance, and multiple independent local checkouts of this repo (each
 * with its own separate DATABASE_URL/Postgres) were all connecting to it
 * under the same fixed queue name — so whichever checkout's worker happened
 * to grab a job first would try to process it against ITS OWN database,
 * where the batchId simply doesn't exist, failing every time with "No
 * record was found for an update" while the job's real owner sat stuck at
 * QUEUED forever (its own worker never got a chance to see the job at all).
 *
 * The actual invariant that matters isn't "same machine" or "same checkout
 * path" — it's "same database." Deriving the queue name from a hash of
 * DATABASE_URL means any two processes that share a database (the only
 * case where sharing a queue is ever correct — e.g. multiple worker
 * replicas of one real deployment) automatically share a queue, and any
 * two processes pointed at different databases (this bug's actual cause)
 * automatically get different, non-interfering queues — with no per-
 * developer setup step to forget. Hashed (not the raw URL) since a queue
 * name can show up in logs/monitoring and the URL carries a password.
 * BULK_IMPORT_QUEUE_NAME may still be set explicitly to override this if a
 * deployment ever genuinely needs a fixed, predictable name.
 */
function deriveQueueName(): string {
  if (process.env.BULK_IMPORT_QUEUE_NAME) return process.env.BULK_IMPORT_QUEUE_NAME;
  const dbUrl = process.env.DATABASE_URL;
  const suffix = dbUrl ? createHash("sha256").update(dbUrl).digest("hex").slice(0, 12) : "unknown-db";
  return `bulk-import-${suffix}`;
}

export const BULK_IMPORT_QUEUE_NAME = deriveQueueName();

/**
 * Same "one queue per database" rule for other queues (Phase 14 bulk actions):
 * `<prefix>-<12 hex of sha256(DATABASE_URL)>`.
 */
export function databaseScopedQueueName(prefix: string): string {
  const dbUrl = process.env.DATABASE_URL;
  const suffix = dbUrl ? createHash("sha256").update(dbUrl).digest("hex").slice(0, 12) : "unknown-db";
  return `${prefix}-${suffix}`;
}

let queue: Queue | null = null;

/** Lazily created so importing this module never opens a Redis connection
 * on its own — only the first actual enqueue (or the worker process) does. */
export function getBulkImportQueue(): Queue {
  if (!queue) {
    queue = new Queue(BULK_IMPORT_QUEUE_NAME, { connection: createConnection() });
  }
  return queue;
}

export { createConnection as createRedisConnection };
