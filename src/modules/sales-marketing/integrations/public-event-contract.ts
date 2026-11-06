import { PUBLIC_PAYLOAD_KEYS, SM_EVENT_VERSION, SM_PUBLIC_EVENTS, smPublicEnvelopeSchema, type SmPublicEnvelope, type SmPublicEventType } from "./integration-registry";

/**
 * Phase 16 — the public S&M event contract (v1): payload minimisation and the
 * envelope. Client-safe (the developer guide renders samples from here).
 */

export type Scalar = string | number | boolean | null;

/** Keeps only the documented keys for the event's family, as scalars. Nothing else ever leaves the ERP. */
export function minimalPayload(publicType: string, data: Record<string, unknown>): Record<string, Scalar> {
  const family = publicType.split(".")[1] ?? "";
  const allowed = PUBLIC_PAYLOAD_KEYS[family] ?? [];
  const out: Record<string, Scalar> = {};
  for (const k of allowed) {
    const v = data[k];
    if (v === undefined) continue;
    out[k] = typeof v === "string" ? v.slice(0, 200) : typeof v === "number" || typeof v === "boolean" || v === null ? v : String(v).slice(0, 200);
  }
  return out;
}

export const publicEntity = (t: SmPublicEventType) => SM_PUBLIC_EVENTS[t].entity;

/** The JSON body of an S&M webhook delivery. */
export function buildSmEnvelope(e: { id: string; companyId: string; eventType: string; eventVersion: number; occurredAt: Date | string; entityType: string; entityId: string; correlationId: string | null; payload: unknown }, test = false): SmPublicEnvelope {
  const payload = e.payload && typeof e.payload === "object" && !Array.isArray(e.payload) ? (e.payload as Record<string, Scalar>) : {};
  return {
    id: e.id,
    type: e.eventType,
    version: 1,
    occurredAt: new Date(e.occurredAt).toISOString(),
    test,
    companyId: e.companyId,
    correlationId: e.correlationId,
    data: { entity: { type: e.entityType, id: e.entityId }, payload },
  };
}

const SAMPLE_PAYLOADS: Partial<Record<string, Record<string, Scalar>>> = {
  enquiry: { toStage: "QUALIFIED" },
  quotation: { revisionNumber: 1 },
  budget: { kind: "OVER_BUDGET", campaignId: "00000000-0000-4000-8000-0000000000c2" },
  attribution: { status: "COMPLETED", modelId: "00000000-0000-4000-8000-0000000000d1", conversions: 42, unattributed: 3 },
  bulk: { status: "COMPLETED_WITH_ERRORS", recordType: "ENQUIRY", actionKey: "enquiry.export", failedCount: 2, retryOfJobId: null },
  workflow: { workflowKey: "quotation_to_order", recordType: "QUOTATION", recordId: "00000000-0000-4000-8000-0000000000a2", outcome: "CONVERTED", errorCode: null },
};

/** Synthetic example (docs and test deliveries) — validated against the published schema. */
export function sampleSmEnvelope(type: SmPublicEventType = "sm.quotation.accepted", test = true, companyId = "00000000-0000-4000-8000-0000000000f1"): SmPublicEnvelope {
  const env = buildSmEnvelope(
    {
      id: "00000000-0000-4000-8000-00000000e016",
      companyId,
      eventType: type,
      eventVersion: SM_EVENT_VERSION,
      occurredAt: "2026-11-06T09:30:00.000Z",
      entityType: publicEntity(type),
      entityId: "00000000-0000-4000-8000-0000000000a1",
      correlationId: type.startsWith("sm.workflow.") ? "smwf:00000000-0000-4000-8000-0000000000b1" : null,
      payload: SAMPLE_PAYLOADS[type.split(".")[1]] ?? {},
    },
    test
  );
  return smPublicEnvelopeSchema.parse(env);
}

