import { Queue, Worker, type Job } from "bullmq";
import { createRedisConnection, databaseScopedQueueName } from "@/core/jobs/queue";
import { prisma } from "@/core/db/client";
import { failStaleEvaluations, queueNightlyEvaluations, runSegmentEvaluation } from "./segment-evaluation.service";

/**
 * Audience segment background jobs (Phase 09), run inside the shared worker
 * (`npm run worker`):
 *  - `segment.evaluate`  one evaluation / snapshot (jobId = evaluation id, so a
 *                        double enqueue is harmless; the run itself only claims
 *                        a QUEUED row).
 *  - `segment.nightly`   queues the night's refresh of ACTIVE segments set to NIGHTLY.
 *  - `segment.recover`   every 10 min: fails runs stuck in RUNNING, re-enqueues
 *                        QUEUED rows whose job got lost.
 * If Redis can't be reached when a user refreshes, the API runs the evaluation
 * after the response instead (scheduleSegmentEvaluation returns false).
 */
export const SEGMENT_JOBS_QUEUE_NAME = databaseScopedQueueName("marketing-segments");

let queue: Queue | null = null;
function getQueue() {
  if (!queue) queue = new Queue(SEGMENT_JOBS_QUEUE_NAME, { connection: createRedisConnection() });
  return queue;
}

/** Enqueue one evaluation. Returns false when the queue isn't reachable (caller runs it after the response). */
export async function scheduleSegmentEvaluation(evaluationId: string): Promise<boolean> {
  if (!process.env.REDIS_URL) return false;
  try {
    await getQueue().add("segment.evaluate", { evaluationId }, { jobId: `segment-eval-${evaluationId}`, attempts: 1, removeOnComplete: { age: 7 * 24 * 3600, count: 500 }, removeOnFail: { age: 30 * 24 * 3600 } });
    return true;
  } catch {
    return false;
  }
}

async function enqueueMany(ids: string[]) {
  for (const id of ids) await scheduleSegmentEvaluation(id);
  return ids.length;
}

export async function handleSegmentJob(job: Pick<Job, "name" | "data">) {
  switch (job.name) {
    case "segment.evaluate":
      return runSegmentEvaluation((job.data as { evaluationId: string }).evaluationId);
    case "segment.nightly":
      return { queued: await enqueueMany(await queueNightlyEvaluations()) };
    case "segment.recover": {
      const failed = await failStaleEvaluations();
      const lost = await prisma.marketingSegmentEvaluation.findMany({ where: { status: "QUEUED", requestedAt: { lt: new Date(Date.now() - 5 * 60_000) } }, select: { id: true }, take: 200 });
      return { failed, requeued: await enqueueMany(lost.map((l) => l.id)) };
    }
    default:
      throw new Error(`Unknown segment job "${job.name}"`);
  }
}

export function startSegmentJobsWorker() {
  const worker = new Worker(SEGMENT_JOBS_QUEUE_NAME, handleSegmentJob, { connection: createRedisConnection(), concurrency: 2 });
  worker.on("failed", (job, error) => {
    console.error(JSON.stringify({ level: "error", message: "Segment job failed", jobName: job?.name, jobId: job?.id, error: error?.message }));
  });
  const q = new Queue(SEGMENT_JOBS_QUEUE_NAME, { connection: createRedisConnection() });
  const opts = { attempts: 1, removeOnComplete: { count: 20 }, removeOnFail: { age: 7 * 24 * 3600 } };
  // 02:00 Asia/Kolkata = 20:30 UTC.
  q.upsertJobScheduler("segment-nightly", { pattern: "30 20 * * *" }, { name: "segment.nightly", data: {}, opts })
    .then(() => q.upsertJobScheduler("segment-recover", { every: 10 * 60_000 }, { name: "segment.recover", data: {}, opts }))
    .catch((e: Error) => console.error(JSON.stringify({ level: "error", message: "Could not schedule segment jobs", error: e.message })));
  console.log(JSON.stringify({ level: "info", message: `Segment jobs worker started, listening on queue "${SEGMENT_JOBS_QUEUE_NAME}"` }));
  return worker;
}
