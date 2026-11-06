import { after } from "next/server";
import { logger } from "@/core/logging/logger";
import { defaultEngineDeps, dispatchRun, prepareRun, type EngineDeps } from "./delivery-engine";
import { processPendingEvents } from "./delivery-events.service";
import { enqueueEventProcessing, enqueueRunStep } from "./delivery-queue";

/**
 * Hands run work to the background queue; when Redis isn't configured or
 * reachable, works the run after the HTTP response instead (best effort,
 * bounded to a few minutes). Scheduled sends, retry back-off and recovery
 * need the worker (`npm run worker`) — without it they wait until it runs.
 */

const INLINE_BUDGET_MS = 4 * 60_000;

async function driveInline(runId: string) {
  const started = Date.now();
  // Inline mode: steps that would be re-enqueued are continued by this loop instead.
  let wanted: { step: "run.prepare" | "run.dispatch"; at: number } | null = null;
  const deps: EngineDeps = {
    ...defaultEngineDeps,
    schedule: async (step, _id, at) => {
      wanted = { step, at: at ? at.getTime() : Date.now() };
      return true;
    },
  };
  let step: "run.prepare" | "run.dispatch" | null = "run.prepare";
  while (step && Date.now() - started < INLINE_BUDGET_MS) {
    wanted = null;
    const res = step === "run.prepare" ? await prepareRun(runId, deps) : await dispatchRun(runId, deps);
    if (res.status === "SKIPPED" && step === "run.prepare") {
      step = "run.dispatch";
      continue;
    }
    const next = wanted as { step: "run.prepare" | "run.dispatch"; at: number } | null;
    if (!next) break;
    const wait = next.at - Date.now();
    // Don't hold a request worker for scheduled sends or long back-offs.
    if (wait > 15_000) break;
    if (wait > 0) await deps.sleep(wait);
    step = next.step;
  }
}

/** Start preparing (then sending) a run. */
export async function kickRun(runId: string, step: "run.prepare" | "run.dispatch" = "run.prepare"): Promise<"queued" | "inline"> {
  if (await enqueueRunStep(step, runId)) return "queued";
  after(() =>
    driveInline(runId).catch((e: Error) => {
      logger.error("Inline delivery run failed", { runId, error: e.message });
    })
  );
  return "inline";
}

/** Process stored provider events soon. */
export async function kickEventProcessing(): Promise<void> {
  if (await enqueueEventProcessing()) return;
  after(() =>
    processPendingEvents(200)
      .then(() => undefined)
      .catch((e: Error) => {
        logger.error("Inline delivery event processing failed", { error: e.message });
      })
  );
}
