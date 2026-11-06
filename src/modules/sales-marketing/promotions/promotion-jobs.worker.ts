import { Queue, Worker, type Job } from "bullmq";
import { createRedisConnection, databaseScopedQueueName } from "@/core/jobs/queue";
import { evaluateAllBudgetAlerts } from "@/modules/sales-marketing/budgets/budget.service";
import { releaseExpiredReservations } from "./redemption.service";

/**
 * Promotions & budgets housekeeping (Phase 12), in the shared worker:
 *  - `promotion.expire`  nightly: reservations past their quotation's valid-until are marked RELEASED
 *                        (they already stopped counting on that date — this only tidies the status).
 *  - `budget.alerts`     every 30 min: re-evaluates campaign budget alerts, since Expenses, Purchase
 *                        Orders and Purchase Invoices change status in Finance, outside this module.
 *                        Raising / clearing is idempotent, so an extra run changes nothing.
 */
export const PROMOTION_JOBS_QUEUE_NAME = databaseScopedQueueName("marketing-promotions");

export async function handlePromotionJob(job: Pick<Job, "name">) {
  switch (job.name) {
    case "promotion.expire":
      return { released: await releaseExpiredReservations() };
    case "budget.alerts":
      return evaluateAllBudgetAlerts();
    default:
      throw new Error(`Unknown promotion job "${job.name}"`);
  }
}

export function startPromotionJobsWorker() {
  const worker = new Worker(PROMOTION_JOBS_QUEUE_NAME, handlePromotionJob, { connection: createRedisConnection(), concurrency: 1 });
  worker.on("failed", (job, error) => {
    console.error(JSON.stringify({ level: "error", message: "Promotion job failed", jobName: job?.name, jobId: job?.id, error: error?.message }));
  });
  const q = new Queue(PROMOTION_JOBS_QUEUE_NAME, { connection: createRedisConnection() });
  const opts = { attempts: 1, removeOnComplete: { count: 20 }, removeOnFail: { age: 7 * 24 * 3600 } };
  // 00:20 Asia/Kolkata = 18:50 UTC.
  q.upsertJobScheduler("promotion-expire", { pattern: "50 18 * * *" }, { name: "promotion.expire", data: {}, opts })
    .then(() => q.upsertJobScheduler("budget-alerts", { every: 30 * 60_000 }, { name: "budget.alerts", data: {}, opts }))
    .catch((e: Error) => console.error(JSON.stringify({ level: "error", message: "Could not schedule promotion jobs", error: e.message })));
  console.log(JSON.stringify({ level: "info", message: `Promotion jobs worker started, listening on queue "${PROMOTION_JOBS_QUEUE_NAME}"` }));
  return worker;
}
