import { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import type { SmWfEvent } from "@/modules/sales-marketing/workflows/sm-workflow-registry";
import { INTERNAL_TO_PUBLIC, SM_EVENT_VERSION, type SmPublicEventType } from "./integration-registry";
import { minimalPayload, publicEntity } from "./public-event-contract";

export { buildSmEnvelope, minimalPayload, sampleSmEnvelope } from "./public-event-contract";

/**
 * Phase 16 — the public S&M event outbox (integration_events). Not a second
 * bus: rows are written by the Phase 15 dispatcher as it claims each internal
 * event (same read, same dedupe), and by workflow transitions. Each row is
 * unique on (source, source_key), so a re-read never publishes twice.
 * Outgoing S&M webhook subscriptions are delivered from here by the CRM
 * webhook engine.
 */

/** Called by the Phase 15 dispatcher for every newly claimed event. Returns whether a public event was written. */
export async function publishFromWorkflowEvent(ev: SmWfEvent, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<boolean> {
  const type = INTERNAL_TO_PUBLIC[ev.type];
  if (!type) return false;
  const r = await db.integrationEvent.createMany({
    data: [
      {
        companyId: ev.companyId,
        source: `sm:${ev.source}`,
        sourceKey: ev.sourceKey,
        eventType: type,
        eventVersion: SM_EVENT_VERSION,
        entityType: publicEntity(type),
        entityId: ev.entityId,
        occurredAt: ev.occurredAt,
        correlationId: null,
        payload: minimalPayload(type, ev.data) as Prisma.InputJsonValue,
      },
    ],
    skipDuplicates: true,
  });
  return r.count > 0;
}

/** Workflow instance finished or needs a person (Phase 15 engine and operator actions). */
export async function publishWorkflowEvent(
  i: { id: string; companyId: string; workflowKey: string; entityType: string; entityId: string; correlationId: string },
  kind: "completed" | "needs_attention",
  detail: { outcome?: string | null; errorCode?: string | null },
  at: Date
) {
  const type: SmPublicEventType = kind === "completed" ? "sm.workflow.completed" : "sm.workflow.needs_attention";
  await prisma.integrationEvent
    .createMany({
      data: [
        {
          companyId: i.companyId,
          source: "sm:workflow",
          sourceKey: kind === "completed" ? `${i.id}:completed` : `${i.id}:attention:${at.getTime()}`,
          eventType: type,
          eventVersion: SM_EVENT_VERSION,
          entityType: "WORKFLOW_INSTANCE",
          entityId: i.id,
          occurredAt: at,
          correlationId: i.correlationId,
          payload: minimalPayload(type, { workflowKey: i.workflowKey, recordType: i.entityType, recordId: i.entityId, outcome: detail.outcome ?? null, errorCode: detail.errorCode ?? null }) as Prisma.InputJsonValue,
        },
      ],
      skipDuplicates: true,
    })
    // Publishing must never break the workflow itself.
    .catch((e) => console.error(JSON.stringify({ level: "error", message: "Public workflow event not written", instanceId: i.id, error: (e as Error).message })));
}

export async function purgeOldIntegrationEvents(now: Date, retentionDays: number) {
  const { count } = await prisma.integrationEvent.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - retentionDays * 86_400_000) } } });
  return count;
}
