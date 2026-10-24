import { Queue, Worker, type Job } from "bullmq";
import { createRedisConnection, databaseScopedQueueName } from "@/core/jobs/queue";
import { creditCurrentMonthForAllCompanies } from "./leave-balance.service";

/**
 * Attendance background jobs, run inside the shared worker (`npm run worker`).
 * `leave.monthly-credit` replaces the old system's 1st-of-month cron: every
 * few hours it makes sure this month's leave balances exist (idempotent —
 * an existing balance is never touched). Balances are also created on demand
 * whenever a screen or an approval needs one, so a stopped worker never
 * blocks anyone.
 */
export const ATTENDANCE_JOBS_QUEUE_NAME = databaseScopedQueueName("hrms-attendance");

async function handleAttendanceJob(job: Job) {
  switch (job.name) {
    case "leave.monthly-credit":
      return creditCurrentMonthForAllCompanies(new Date());
    default:
      throw new Error(`Unknown attendance job "${job.name}"`);
  }
}

export function startAttendanceJobsWorker() {
  const worker = new Worker(ATTENDANCE_JOBS_QUEUE_NAME, handleAttendanceJob, { connection: createRedisConnection(), concurrency: 1 });
  worker.on("failed", (job, error) => {
    console.error(JSON.stringify({ level: "error", message: "Attendance job failed", jobName: job?.name, jobId: job?.id, error: error?.message }));
  });
  worker.on("completed", (job) => {
    const rv = job.returnvalue as { created?: number } | undefined;
    if (!rv?.created) return;
    console.log(JSON.stringify({ level: "info", message: "Monthly leave balances credited", ...rv }));
  });
  new Queue(ATTENDANCE_JOBS_QUEUE_NAME, { connection: createRedisConnection() })
    .upsertJobScheduler(
      "leave-monthly-credit",
      { every: 6 * 60 * 60_000 },
      { name: "leave.monthly-credit", data: {}, opts: { attempts: 1, removeOnComplete: { count: 20 }, removeOnFail: { age: 7 * 24 * 3600 } } }
    )
    .catch((e: Error) => console.error(JSON.stringify({ level: "error", message: "Could not schedule leave monthly credit job", error: e.message })));
  console.log(JSON.stringify({ level: "info", message: `Attendance jobs worker started, listening on queue "${ATTENDANCE_JOBS_QUEUE_NAME}"` }));
  return worker;
}
