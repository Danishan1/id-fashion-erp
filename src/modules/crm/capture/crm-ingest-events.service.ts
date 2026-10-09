import type { CrmDuplicatePolicy, CrmLeadCaptureChannel, Prisma } from "@prisma/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError, isUniqueConstraintViolationOnColumn } from "@/core/errors/BusinessRuleError";
import type { CrmActor } from "../core/crm-actor";
import { ingestLead, loadIngestLookups, prepareLead, resolveFlaggedLead, type IngestContext, type IngestResult } from "../ingestion/lead-ingest.service";
import { enqueueCrmIngestJob } from "../imports/crm-import.queue";
import { CrmCaptureRepository } from "./crm-capture.repository";
import { ingestEventListQuerySchema, ingestEventReviewSchema } from "./crm-capture.schema";

/**
 * Inbox for API and webhook lead submissions. Every submission is stored
 * first (payload, idempotency key, who sent it), then processed through the
 * Lead Ingestion Service:
 *
 * - Idempotency: (company, provider, idempotency key) is unique — the same
 *   Idempotency-Key / external event id received again returns the original
 *   result instead of creating a second lead. A repeated external lead id
 *   (without an event id) is caught by crm_lead_external_refs.
 * - Retries: unexpected failures (database / infrastructure) are retried
 *   with backoff by the worker; data problems are final and reported.
 * - Flagged submissions wait for a person to decide (create / update / skip).
 */

export const MAX_INGEST_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 12 * 3600_000];
const MAX_PAYLOAD_CHARS = 64 * 1024;
const SECRET_KEY_RE = /pass(word)?|secret|token|authorization|api[_-]?key|signature/i;

/** Stored with the event so a retry or a review can rebuild exactly what was received. */
interface EventMeta {
  actor: { companyId: string; userId: string };
  context: Pick<IngestContext, "channel" | "provider" | "duplicatePolicy" | "defaultSourceId" | "defaultSourceKey" | "defaultOwnerUserId" | "via">;
  mapped: Record<string, unknown>;
}
interface StoredPayload {
  received: unknown;
  meta: EventMeta;
}

export function redactPayload(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[nested]";
  if (Array.isArray(value)) return value.slice(0, 100).map((v) => redactPayload(v, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEY_RE.test(k) ? "[redacted]" : redactPayload(v, depth + 1)]));
  }
  return typeof value === "string" && value.length > 5000 ? `${value.slice(0, 5000)}…` : value;
}

function boundedPayload(received: unknown, meta: EventMeta): StoredPayload {
  const redacted = redactPayload(received);
  const text = JSON.stringify(redacted) ?? "null";
  return { received: text.length > MAX_PAYLOAD_CHARS ? { truncated: true, preview: text.slice(0, 2000) } : redacted, meta: { ...meta, mapped: redactPayload(meta.mapped) as Record<string, unknown> } };
}

export interface LeadSubmission {
  actor: CrmActor;
  context: IngestContext;
  apiKeyId?: string | null;
  webhookEndpointId?: string | null;
  idempotencyKey?: string | null;
  externalEventId?: string | null;
  externalLeadId?: string | null;
  /** CRM field → value (adapter / API output). */
  mapped: Record<string, unknown>;
  /** What was received, for the event log (secrets are redacted). */
  received: unknown;
}

export type IngestEventDto = NonNullable<Awaited<ReturnType<typeof CrmCaptureRepository.findEventByKey>>>;

function eventStatus(result: IngestResult) {
  if (result.outcome === "FLAGGED") return "FLAGGED" as const;
  if (result.outcome === "FAILED") return "FAILED" as const;
  return "PROCESSED" as const;
}

/** Store + process one submission. Returns the event and whether it was a replay of an earlier delivery. */
export async function submitLead(s: LeadSubmission): Promise<{ event: IngestEventDto; result: IngestResult | null; replay: boolean }> {
  const idempotencyKey = (s.idempotencyKey ?? s.externalEventId)?.slice(0, 200) ?? null;
  const meta: EventMeta = {
    actor: { companyId: s.actor.companyId, userId: s.actor.userId },
    context: {
      channel: s.context.channel,
      provider: s.context.provider,
      duplicatePolicy: s.context.duplicatePolicy,
      defaultSourceId: s.context.defaultSourceId,
      defaultSourceKey: s.context.defaultSourceKey,
      defaultOwnerUserId: s.context.defaultOwnerUserId,
      via: s.context.via,
    },
    mapped: { ...s.mapped, ...(s.externalLeadId ? { externalId: s.externalLeadId } : {}) },
  };
  let eventId: string;
  try {
    eventId = (
      await CrmCaptureRepository.createEvent({
        companyId: s.actor.companyId,
        channel: s.context.channel,
        provider: s.context.provider,
        apiKeyId: s.apiKeyId ?? null,
        webhookEndpointId: s.webhookEndpointId ?? null,
        idempotencyKey,
        externalEventId: s.externalEventId ?? null,
        externalLeadId: s.externalLeadId ?? null,
        payload: boundedPayload(s.received, meta) as unknown as Prisma.InputJsonValue,
      })
    ).id;
  } catch (e) {
    if (idempotencyKey && isUniqueConstraintViolationOnColumn(e, "idempotency_key")) {
      const existing = await CrmCaptureRepository.findEventByKey(s.actor.companyId, s.context.provider, idempotencyKey);
      // A re-delivery of an event that failed on our side counts as a retry.
      if (existing && existing.status === "FAILED" && existing.attempts < MAX_INGEST_ATTEMPTS) {
        const stored = await CrmCaptureRepository.findEvent({ id: existing.id });
        const { meta: storedMeta } = stored!.payload as unknown as StoredPayload;
        const { event, result } = await processEvent(existing.id, { ...storedMeta.actor, branchId: null }, { ...storedMeta.context }, storedMeta.mapped, existing.attempts + 1);
        return { event, result, replay: true };
      }
      if (existing) return { event: existing, result: null, replay: true };

    }
    throw e;
  }
  await writeAuditLog({
    companyId: s.actor.companyId,
    userId: s.actor.userId,
    tableName: "crm_ingest_events",
    recordId: eventId,
    action: "CREATE",
    newValues: { event: s.context.channel === "WEBHOOK" ? "webhook.received" : "api.lead_received", provider: s.context.provider, idempotencyKey, externalLeadId: s.externalLeadId ?? null },
  });
  const { event, result } = await processEvent(eventId, s.actor, { ...s.context }, meta.mapped, 1);
  return { event, result, replay: false };
}

async function processEvent(eventId: string, actor: CrmActor, context: IngestContext, mapped: Record<string, unknown>, attempt: number) {
  let result: IngestResult;
  try {
    result = await ingestLead(actor, mapped, context);
  } catch (e) {
    result = { outcome: "FAILED", reason: `Unexpected error: ${(e as Error).message}`, retryable: true, leadId: null, leadNumber: null, messages: [], duplicates: null };
  }
  const retry = result.outcome === "FAILED" && result.retryable && attempt < MAX_INGEST_ATTEMPTS;
  const nextRetryAt = retry ? new Date(Date.now() + RETRY_DELAYS_MS[attempt - 1]) : null;
  const event = await CrmCaptureRepository.updateEvent(eventId, {
    status: eventStatus(result),
    outcome: result.outcome,
    outcomeReason: result.reason?.slice(0, 1000) ?? null,
    duplicateMatches: result.duplicates?.leadMatches.length
      ? (result.duplicates.leadMatches.slice(0, 5).map((m) => ({ id: m.id, leadNumber: m.leadNumber, fullName: m.fullName, rules: m.rules, archived: m.archived })) as Prisma.InputJsonValue)
      : undefined,
    leadId: result.leadId,
    attempts: attempt,
    lastError: result.outcome === "FAILED" ? (result.reason?.slice(0, 1000) ?? null) : null,
    nextRetryAt,
    processedAt: new Date(),
  });
  if (retry && nextRetryAt) {
    await enqueueCrmIngestJob({ name: "ingest.retry", data: { eventId } }, { delayMs: nextRetryAt.getTime() - Date.now(), jobId: `ingest-retry-${eventId}-${attempt}` }).catch(() => undefined);
  }
  return { event, result };
}

/** Worker: retry a failed submission with exactly the payload and settings it arrived with. */
export async function retryIngestEvent(eventId: string) {
  const ev = await CrmCaptureRepository.findEvent({ id: eventId });
  if (!ev || ev.status !== "FAILED" || ev.attempts >= MAX_INGEST_ATTEMPTS) return null;
  const { meta } = ev.payload as unknown as StoredPayload;
  return processEvent(eventId, { ...meta.actor, branchId: null }, { ...meta.context }, meta.mapped, ev.attempts + 1);
}

// ── Log & review (CRM users) ─────────────────────────────────────

export async function listIngestEvents(actor: CrmActor, rawQuery: unknown, page: { skip: number; take: number }) {
  const q = ingestEventListQuerySchema.parse(rawQuery);
  const where: Prisma.CrmIngestEventWhereInput = { companyId: actor.companyId, ...(q.status ? { status: q.status } : {}), ...(q.channel ? { channel: q.channel as CrmLeadCaptureChannel } : {}) };
  const [data, totalCount] = await CrmCaptureRepository.listEvents(where, page.skip, page.take);
  return { data, totalCount };
}

export async function getIngestEvent(actor: CrmActor, id: string) {
  const ev = await CrmCaptureRepository.findEvent({ id, companyId: actor.companyId });
  if (!ev) throw new BusinessRuleError("NOT_FOUND", "Submission not found.", { id });
  const payload = ev.payload as unknown as StoredPayload;
  return { ...ev, payload: undefined, received: payload.received, mapped: payload.meta?.mapped ?? null };
}

export async function reviewIngestEvent(actor: CrmActor, id: string, raw: unknown) {
  const decision = ingestEventReviewSchema.parse(raw);
  const ev = await CrmCaptureRepository.findEvent({ id, companyId: actor.companyId });
  if (!ev) throw new BusinessRuleError("NOT_FOUND", "Submission not found.", { id });
  if (ev.status !== "FLAGGED") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Only flagged submissions can be reviewed.");
  const { meta } = ev.payload as unknown as StoredPayload;
  const context: IngestContext = { ...meta.context };
  const prepared = prepareLead(meta.mapped, context, await loadIngestLookups(actor.companyId));
  let leadId: string | undefined;
  if (decision.action === "UPDATE") {
    const dups = (ev.duplicateMatches as { id: string }[] | null) ?? [];
    leadId = decision.leadId ?? (dups.length === 1 ? dups[0].id : undefined);
    if (!leadId) throw new BusinessRuleError("VALIDATION_ERROR", "Choose which lead to update.");
  }
  const result = await resolveFlaggedLead(actor, prepared, context, decision.action === "UPDATE" ? { action: "UPDATE", leadId: leadId! } : { action: decision.action });
  const updated = await CrmCaptureRepository.updateEvent(id, {
    status: eventStatus(result),
    outcome: result.outcome,
    outcomeReason: result.reason,
    leadId: result.leadId,
    processedAt: new Date(),
  });
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "crm_ingest_events", recordId: id, action: "UPDATE", newValues: { event: "ingest.reviewed", action: decision.action, outcome: result.outcome } });
  return updated;
}

/** Manual retry of a failed submission (e.g. after fixing a setting). */
export async function retryIngestEventNow(actor: CrmActor, id: string) {
  const ev = await CrmCaptureRepository.findEvent({ id, companyId: actor.companyId });
  if (!ev) throw new BusinessRuleError("NOT_FOUND", "Submission not found.", { id });
  if (ev.status !== "FAILED") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Only failed submissions can be retried.");
  const { meta } = ev.payload as unknown as StoredPayload;
  const { event } = await processEvent(id, { ...meta.actor, branchId: null }, { ...meta.context }, meta.mapped, ev.attempts + 1);
  return event;
}

export type { CrmDuplicatePolicy };
