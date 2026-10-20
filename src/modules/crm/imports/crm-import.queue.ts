import { createHash } from "node:crypto";
import { Queue } from "bullmq";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { createRedisConnection } from "@/core/jobs/queue";

/**
 * Background queue for CRM work: lead import validation / processing,
 * webhook/API retries, housekeeping and (Phase 09) activity reminders. Runs in the existing
 * worker process (`npm run worker`, started by `npm run dev`). The queue
 * name is derived from DATABASE_URL exactly like the bulk-import queue (see
 * src/core/jobs/queue.ts — two checkouts sharing one Redis must never pick
 * up each other's jobs).
 */
function deriveQueueName(): string {
  if (process.env.CRM_INGEST_QUEUE_NAME) return process.env.CRM_INGEST_QUEUE_NAME;
  const dbUrl = process.env.DATABASE_URL;
  const suffix = dbUrl ? createHash("sha256").update(dbUrl).digest("hex").slice(0, 12) : "unknown-db";
  return `crm-lead-ingest-${suffix}`;
}

export const CRM_INGEST_QUEUE_NAME = deriveQueueName();

export type CrmIngestJob =
  | { name: "import.validate"; data: { importJobId: string } }
  | { name: "import.process"; data: { importJobId: string } }
  | { name: "ingest.retry"; data: { eventId: string } }
  | { name: "import.cleanup"; data: Record<string, never> }
  // Phase 09: activity reminders, scheduled every minute by the worker.
  | { name: "activity.reminders"; data: Record<string, never> }
  // Phase 11: stuck outbound messages → FAILED.
  | { name: "conversation.sweep"; data: Record<string, never> }
  // Phase 18: workflow dispatch + due executions (every 15 s, plus a kick after triggering events).
  | { name: "workflow.tick"; data: Record<string, never> }
  // Phase 22: outgoing webhook subscriptions — queue, send, retry (every 15 s).
  | { name: "webhook.tick"; data: Record<string, never> };

let queue: Queue | null = null;

export function getCrmIngestQueue(): Queue {
  if (!queue) queue = new Queue(CRM_INGEST_QUEUE_NAME, { connection: createRedisConnection() });
  return queue;
}

/** Enqueue with retries; a missing Redis becomes a clear, user-facing error. */
export async function enqueueCrmIngestJob(job: CrmIngestJob, opts: { delayMs?: number; jobId?: string } = {}) {
  try {
    const added = await getCrmIngestQueue().add(job.name, job.data, {
      attempts: job.name === "ingest.retry" ? 1 : 3,
      backoff: { type: "exponential", delay: 10_000 },
      removeOnComplete: { age: 7 * 24 * 3600, count: 1000 },
      removeOnFail: { age: 30 * 24 * 3600 },
      ...(opts.delayMs ? { delay: opts.delayMs } : {}),
      ...(opts.jobId ? { jobId: opts.jobId } : {}),
    });
    return added.id ?? null;
  } catch (e) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      `The background worker queue isn't reachable (${(e as Error).message}). Check REDIS_URL and that the worker is running (npm run worker).`
    );
  }
}
