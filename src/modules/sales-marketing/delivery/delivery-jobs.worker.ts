import { Queue, Worker, type Job } from "bullmq";
import { createRedisConnection } from "@/core/jobs/queue";
import { dispatchRun, prepareRun, recoverDelivery } from "./delivery-engine";
import { processPendingEvents } from "./delivery-events.service";
import { DELIVERY_QUEUE_NAME } from "./delivery-queue";

/**
 * Marketing delivery jobs (Phase 10), run inside the shared worker:
 *  - `run.prepare`      build a run's recipient list (under the run lease)
 *  - `run.dispatch`     send one slice; the engine re-enqueues the next one
 *  - `events.process`   apply stored provider callbacks
 *  - `delivery.recover` every 2 min: interrupted sends → UNKNOWN, lost/due runs
 *                       re-enqueued, unprocessed events applied
 * Every handler is safe to run twice (leases + guarded status updates).
 */
export async function handleDeliveryJob(job: Pick<Job, "name" | "data">) {
  switch (job.name) {
    case "run.prepare":
      return prepareRun((job.data as { runId: string }).runId);
    case "run.dispatch":
      return dispatchRun((job.data as { runId: string }).runId);
    case "events.process":
      return { processed: await processPendingEvents(500) };
    case "delivery.recover": {
      const recovered = await recoverDelivery();
      return { ...recovered, events: await processPendingEvents(500) };
    }
    default:
      throw new Error(`Unknown delivery job "${job.name}"`);
  }
}

export function startDeliveryJobsWorker() {
  const worker = new Worker(DELIVERY_QUEUE_NAME, handleDeliveryJob, { connection: createRedisConnection(), concurrency: 4 });
  worker.on("failed", (job, error) => {
    console.error(JSON.stringify({ level: "error", message: "Delivery job failed", jobName: job?.name, jobId: job?.id, error: error?.message }));
  });
  const q = new Queue(DELIVERY_QUEUE_NAME, { connection: createRedisConnection() });
  q.upsertJobScheduler("delivery-recover", { every: 2 * 60_000 }, { name: "delivery.recover", data: {}, opts: { attempts: 1, removeOnComplete: { count: 20 }, removeOnFail: { age: 7 * 24 * 3600 } } }).catch((e: Error) =>
    console.error(JSON.stringify({ level: "error", message: "Could not schedule delivery recovery", error: e.message }))
  );
  console.log(JSON.stringify({ level: "info", message: `Delivery jobs worker started, listening on queue "${DELIVERY_QUEUE_NAME}"` }));
  return worker;
}
