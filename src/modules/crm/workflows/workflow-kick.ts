import { logger } from "@/core/logging/logger";
import { subscribeCrmEvent } from "../core/crm-event-bus";
import { enqueueCrmIngestJob } from "../imports/crm-import.queue";
import { TRIGGERING_EVENT_TYPES } from "./workflow-triggers";

/**
 * Best-effort latency improvement only: after a commit that wrote an event a
 * workflow could react to, ask the worker to run a tick now instead of at the
 * next 15-second schedule. Correctness never depends on this — the scheduled
 * tick reads the durable `crm_events` outbox — so it is fire-and-forget (never
 * awaited, never slows or fails the user's request) and de-duplicated per
 * 2-second bucket. Disable with CRM_WORKFLOW_KICK=false.
 */
const globalForKick = globalThis as unknown as { __crmWorkflowKick?: boolean };

if (!globalForKick.__crmWorkflowKick && process.env.CRM_WORKFLOW_KICK !== "false") {
  globalForKick.__crmWorkflowKick = true;
  subscribeCrmEvent("*", (event) => {
    if (!TRIGGERING_EVENT_TYPES.includes(event.eventType)) return;
    const bucket = Math.floor(Date.now() / 2000);
    void enqueueCrmIngestJob({ name: "workflow.tick", data: {} }, { jobId: `workflow-kick-${bucket}` }).catch((e: Error) =>
      logger.warn("Workflow kick not queued (the scheduled tick will pick the event up)", { error: e.message })
    );
  });
}
