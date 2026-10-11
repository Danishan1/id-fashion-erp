import { Worker, type Job } from "bullmq";
import { createRedisConnection } from "@/core/jobs/queue";
import { retryIngestEvent } from "../capture/crm-ingest-events.service";
import { CrmCaptureRepository } from "../capture/crm-capture.repository";
import { cleanupStaleImports, processImportJob, runImportValidation } from "./crm-import.service";
import { CRM_INGEST_QUEUE_NAME, enqueueCrmIngestJob, getCrmIngestQueue } from "./crm-import.queue";
import { processDueActivityReminders } from "../activities/crm-activities.service";
import { failStaleOutboundMessages } from "../conversations/conversation-messaging.service";

/**
 * CRM lead-ingestion jobs, run inside the shared worker process
 * (src/core/jobs/worker.ts → `npm run worker`). Concurrency 1: imports are
 * processed one at a time, in order, which keeps duplicate detection
 * between rows of the same file deterministic.
 */
export async function handleCrmIngestJob(job: Job) {
  const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
  switch (job.name) {
    case "import.validate":
      return runImportValidation(job.data.importJobId);
    case "import.process":
      return processImportJob(job.data.importJobId, { finalAttempt });
    case "ingest.retry":
      return retryIngestEvent(job.data.eventId);
    case "import.cleanup": {
      const result = await cleanupStaleImports();
      // Safety net for retries whose delayed job was lost (e.g. Redis restart).
      for (const ev of await CrmCaptureRepository.dueRetries(new Date())) await retryIngestEvent(ev.id);
      return result;
    }
    case "activity.reminders":
      // Idempotent: each reminder is claimed once in the database (see processDueActivityReminders).
      return processDueActivityReminders(new Date());
    case "conversation.sweep":
      // Phase 11: outbound messages stuck in "sending" (process stopped mid-send) → FAILED, never resent automatically.
      return failStaleOutboundMessages(new Date());
    default:
      throw new Error(`Unknown CRM ingest job "${job.name}"`);
  }
}

export function startCrmIngestWorker() {
  const worker = new Worker(CRM_INGEST_QUEUE_NAME, handleCrmIngestJob, { connection: createRedisConnection(), concurrency: 1 });
  worker.on("failed", (job, error) => {
    console.error(JSON.stringify({ level: "error", message: "CRM ingest job failed", jobName: job?.name, jobId: job?.id, attempt: job?.attemptsMade, error: error?.message }));
  });
  worker.on("completed", (job) => {
    // The per-minute reminder sweep only logs when it did something.
    const rv = job.returnvalue as { sent?: number; cancelled?: number } | undefined;
    if (job.name === "activity.reminders" && !(rv?.sent || rv?.cancelled)) return;
    if (job.name === "conversation.sweep" && !(job.returnvalue as { failed?: number } | undefined)?.failed) return;
    console.log(JSON.stringify({ level: "info", message: "CRM ingest job completed", jobName: job.name, jobId: job.id }));
  });
  // Daily housekeeping at 02:15 server time; idempotent if several workers start.
  getCrmIngestQueue()
    .upsertJobScheduler("crm-import-cleanup", { pattern: "15 2 * * *" }, { name: "import.cleanup", data: {} })
    .catch((e: Error) => console.error(JSON.stringify({ level: "error", message: "Could not schedule CRM import cleanup", error: e.message })));
  // Activity reminders (Phase 09): every minute; the scheduler id makes this idempotent across restarts / workers.
  getCrmIngestQueue()
    .upsertJobScheduler("crm-activity-reminders", { every: 60_000 }, { name: "activity.reminders", data: {}, opts: { attempts: 1, removeOnComplete: { count: 100 }, removeOnFail: { age: 24 * 3600 } } })
    .catch((e: Error) => console.error(JSON.stringify({ level: "error", message: "Could not schedule CRM activity reminders", error: e.message })));
  // Conversations (Phase 11): every 5 minutes, idempotent per message.
  getCrmIngestQueue()
    .upsertJobScheduler("crm-conversation-sweep", { every: 5 * 60_000 }, { name: "conversation.sweep", data: {}, opts: { attempts: 1, removeOnComplete: { count: 50 }, removeOnFail: { age: 24 * 3600 } } })
    .catch((e: Error) => console.error(JSON.stringify({ level: "error", message: "Could not schedule CRM conversation sweep", error: e.message })));
  console.log(JSON.stringify({ level: "info", message: `CRM ingest worker started, listening on queue "${CRM_INGEST_QUEUE_NAME}"` }));
  return worker;
}

export { enqueueCrmIngestJob };
