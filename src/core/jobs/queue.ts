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

export const BULK_IMPORT_QUEUE_NAME = "bulk-import";

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
