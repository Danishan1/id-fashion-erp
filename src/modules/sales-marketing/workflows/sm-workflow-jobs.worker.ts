import { Queue, Worker, type Job } from "bullmq";
import { createRedisConnection, databaseScopedQueueName } from "@/core/jobs/queue";
import { tickIntegrations } from "@/modules/sales-marketing/integrations/integration-maintenance";
import { tickSmWorkflows } from "./sm-workflow-engine";
import "./sm-workflow-impls";

/**
 * Phase 15 — S&M workflow tick in the shared worker (`npm run worker`), on the
 * app's BullMQ / Redis like every other S&M background job:
 *  - `sm-workflow.tick` every 30 s: read committed events, start / wake
 *    instances, run what is due, tidy the event log (and, since Phase 16,
 *    publish the public S&M events outgoing webhooks deliver);
 *  - `sm-integrations.tick` every 5 min (Phase 16): integration registry
 *    health and retention.
 * The database is the source of truth (instances, steps, checkpoints): a lost
 * or duplicated tick is harmless; two workers never run one instance at once
 * (lease in Postgres).
 */
export const SM_WORKFLOW_QUEUE_NAME = databaseScopedQueueName("sales-workflows");

export async function handleSmWorkflowJob(job: Pick<Job, "name">) {
  if (job.name === "sm-workflow.tick") return tickSmWorkflows(new Date());
  // Phase 16: integration registry health + retention, on the same queue.
  if (job.name === "sm-integrations.tick") return tickIntegrations(new Date());
  throw new Error(`Unknown S&M workflow job "${job.name}"`);
}

export function startSmWorkflowWorker() {
  const worker = new Worker(SM_WORKFLOW_QUEUE_NAME, handleSmWorkflowJob, { connection: createRedisConnection(), concurrency: 1 });
  worker.on("failed", (job, error) => console.error(JSON.stringify({ level: "error", message: "S&M workflow tick failed", jobName: job?.name, error: error?.message })));
  worker.on("completed", (job) => {
    const r = job.returnvalue as { read?: number; started?: number; woken?: number; invalid?: number; ran?: Record<string, number> } | undefined;
    if (!r || (!r.read && !r.started && !r.invalid && !Object.keys(r.ran ?? {}).length)) return;
    console.log(JSON.stringify({ level: "info", message: "S&M workflow tick", result: r }));
  });
  const q = new Queue(SM_WORKFLOW_QUEUE_NAME, { connection: createRedisConnection() });
  q.upsertJobScheduler("sm-workflow-tick", { every: 30_000 }, { name: "sm-workflow.tick", data: {}, opts: { attempts: 1, removeOnComplete: { count: 20 }, removeOnFail: { age: 24 * 3600 } } }).catch((e: Error) =>
    console.error(JSON.stringify({ level: "error", message: "Could not schedule the S&M workflow tick", error: e.message }))
  );
  q.upsertJobScheduler("sm-integrations-tick", { every: 5 * 60_000 }, { name: "sm-integrations.tick", data: {}, opts: { attempts: 1, removeOnComplete: { count: 20 }, removeOnFail: { age: 24 * 3600 } } }).catch((e: Error) =>
    console.error(JSON.stringify({ level: "error", message: "Could not schedule the S&M integrations tick", error: e.message }))
  );
  console.log(JSON.stringify({ level: "info", message: `S&M workflow worker started, listening on queue "${SM_WORKFLOW_QUEUE_NAME}"` }));
  return worker;
}
