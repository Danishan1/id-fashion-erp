import { CRM_EVENT_TYPES, type CrmEventType } from "../core/crm-event-types";

/**
 * Phase 22 — the events an outgoing webhook subscription can receive, and the
 * JSON envelope every delivery uses. Client-safe (the settings UI renders the
 * catalogue and the sample payloads from this file, so documentation and
 * behaviour can't drift apart).
 *
 * The catalogue is the CRM event registry itself (crm-event-types.ts): every
 * event type listed there is written to the crm_events outbox by the service
 * that performs the change, and can be subscribed to. Nothing is listed that
 * the backend does not emit.
 */

export const WEBHOOK_USER_AGENT = "FashionERP-CRM-Webhooks/1";
export const WEBHOOK_SIGNATURE_HEADER = "X-CRM-Signature";
/** Back-off after attempt n (1-based) fails with a retryable error; after the last, the delivery is FAILED. */
export const WEBHOOK_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000];
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_RETRY_DELAYS_MS.length + 1;
export const WEBHOOK_TIMEOUT_SECONDS = 10;
export const WEBHOOK_MAX_SUBSCRIPTIONS = 20;
export const WEBHOOK_DELIVERY_RETENTION_DAYS = 30;
/** A subscription is shown as "Needs attention" after this many failed deliveries in a row. */
export const WEBHOOK_ATTENTION_THRESHOLD = 3;

/** Event types (in the CRM registry) that are only bookkeeping noise for an external system. */
const NOT_SUBSCRIBABLE = new Set<string>(["workflow.draft_saved", "workflow.draft_discarded"]);

export const WEBHOOK_EVENT_GROUPS: Record<string, string> = {
  LEAD: "Leads",
  CONTACT: "Contacts",
  COMPANY: "Companies",
  OPPORTUNITY: "Opportunities",
  ACTIVITY: "Tasks & activities",
  APPOINTMENT: "Appointments",
  CONVERSATION: "Conversations & messages",
  TEMPLATE: "Message templates",
  WORKFLOW: "Workflows",
};

export interface WebhookEventDef {
  type: CrmEventType;
  label: string;
  entityType: string;
  group: string;
}

function groupOf(type: string, entityType: string) {
  if (type.startsWith("appointment.")) return WEBHOOK_EVENT_GROUPS.APPOINTMENT;
  if (type.startsWith("message.")) return WEBHOOK_EVENT_GROUPS.CONVERSATION;
  return WEBHOOK_EVENT_GROUPS[entityType] ?? entityType;
}

export const WEBHOOK_EVENTS: WebhookEventDef[] = (Object.entries(CRM_EVENT_TYPES) as [CrmEventType, { label: string; entityType: string }][])
  .filter(([type]) => !NOT_SUBSCRIBABLE.has(type))
  .map(([type, def]) => ({ type, label: def.label, entityType: def.entityType, group: groupOf(type, def.entityType) }));

export const WEBHOOK_EVENT_TYPES = new Set<string>(WEBHOOK_EVENTS.map((e) => e.type));
export const isWebhookEventType = (t: unknown): t is CrmEventType => typeof t === "string" && WEBHOOK_EVENT_TYPES.has(t);

/** The JSON body of every delivery (and of the test delivery, with `test: true`). */
export interface WebhookEnvelope {
  /** The CRM event id — stable across retries; use it (or the Idempotency-Key header) to ignore duplicates. */
  id: string;
  type: string;
  occurredAt: string;
  test: boolean;
  data: {
    entity: { type: string; id: string };
    summary: string | null;
    /** Event-specific fields, e.g. { fromStatusId, toStatusId } — the same data shown on the record's timeline. */
    payload: Record<string, unknown>;
    actor: { userId: string | null };
  };
}

export function buildEnvelope(e: { id: string; eventType: string; occurredAt: Date | string; entityType: string; entityId: string; summary: string | null; payload: unknown; actorUserId: string | null }, test = false): WebhookEnvelope {
  return {
    id: e.id,
    type: e.eventType,
    occurredAt: new Date(e.occurredAt).toISOString(),
    test,
    data: {
      entity: { type: e.entityType, id: e.entityId },
      summary: e.summary,
      payload: e.payload && typeof e.payload === "object" && !Array.isArray(e.payload) ? (e.payload as Record<string, unknown>) : {},
      actor: { userId: e.actorUserId },
    },
  };
}

/** Synthetic example for the documentation and the test delivery. Values are samples, not real records. */
export function sampleEnvelope(type = "lead.created", test = true): WebhookEnvelope {
  const def = WEBHOOK_EVENTS.find((e) => e.type === type) ?? WEBHOOK_EVENTS[0];
  return buildEnvelope(
    {
      id: "00000000-0000-4000-8000-00000000e001",
      eventType: def.type,
      occurredAt: "2026-10-14T09:30:00.000Z",
      entityType: def.entityType,
      entityId: "00000000-0000-4000-8000-0000000000a1",
      summary: `${def.label} (sample)`,
      payload: def.type === "lead.status_changed" ? { fromStatusId: "00000000-0000-4000-8000-0000000000b1", toStatusId: "00000000-0000-4000-8000-0000000000b2" } : {},
      actorUserId: "00000000-0000-4000-8000-0000000000c1",
    },
    test
  );
}

/** Node.js receiver example (documentation; shown in Settings and in the docs). */
export const RECEIVER_EXAMPLE_NODE = `// Express receiver for CRM webhooks — verify BEFORE trusting or storing anything.
import crypto from "node:crypto";
import express from "express";

const app = express();
const SECRET = process.env.CRM_WEBHOOK_SECRET; // from your secret store — never hard-code or log it
const seen = new Set(); // use a database table in production

app.post("/crm-webhook", express.raw({ type: "application/json" }), (req, res) => {
  const header = req.get("X-CRM-Signature") ?? "";          // "t=1760434200,v1=5f1c…"
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  const body = req.body.toString("utf8");                    // the RAW body, exactly as received
  const expected = crypto.createHmac("sha256", SECRET).update(\`\${parts.t}.\${body}\`).digest("hex");
  const ok = parts.v1 && expected.length === parts.v1.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
  const fresh = Math.abs(Date.now() / 1000 - Number(parts.t)) < 300; // reject replays older than 5 minutes
  if (!ok || !fresh) return res.status(401).end();

  const deliveryId = req.get("Idempotency-Key");             // same value on every retry
  if (seen.has(deliveryId)) return res.status(200).end();    // duplicate: already processed
  seen.add(deliveryId);

  const event = JSON.parse(body);                            // { id, type, occurredAt, data: { entity, ... } }
  // Respond quickly (within 10 s); do slow work in a queue.
  queueForProcessing(event);
  res.status(204).end();
});`;
