import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { logger } from "@/core/logging/logger";
import { decryptSecret } from "@/core/security/encryption";
import { WebhookBlockedError, WebhookCallError, postSignedWebhook } from "../workflows/workflow-webhook";
import { WEBHOOK_DELIVERY_RETENTION_DAYS, WEBHOOK_MAX_ATTEMPTS, WEBHOOK_RETRY_DELAYS_MS, WEBHOOK_USER_AGENT, buildEnvelope, type WebhookEnvelope } from "./webhook-events";

/**
 * Phase 22 — outgoing webhook delivery, run by the worker every 15 seconds
 * (job `webhook.tick` on the CRM queue):
 *
 *   1. queue: one crm_webhook_deliveries row per (active subscription, matching
 *      crm_events row since the subscription became active, ≤ 24 h back) —
 *      unique (subscription, event), so an event is queued once;
 *   2. send: due rows are claimed with a lease (FOR UPDATE SKIP LOCKED — two
 *      workers never send the same row at the same time) and POSTed with the
 *      Phase 18 sender: https only, public addresses only (checked on every
 *      send, connection pinned to the vetted IP), no redirects, 10 s timeout,
 *      signed `X-CRM-Signature: t=…,v1=HMAC-SHA256(secret, "t.body")`;
 *   3. retry: network errors, timeouts, 408, 429 and 5xx are retried after
 *      1 min, 5 min, 30 min, 2 h and 6 h, then FAILED; other answers fail at
 *      once. Delivery is at-least-once (a timeout may still have been
 *      processed) — receivers de-duplicate on Idempotency-Key.
 *
 * Logged per delivery: status, attempts, HTTP status, duration and a short
 * reason — never the secret, the request body or the receiver's response.
 */

const LOOKBACK_MS = 24 * 3_600_000;
const QUEUE_BATCH = 1000;
const SEND_BATCH = 50;
const LEASE_MS = 2 * 60_000;

/** Creates delivery rows for new matching events. Returns how many were queued. */
export async function queueWebhookDeliveries(now: Date = new Date()): Promise<number> {
  const floor = new Date(now.getTime() - LOOKBACK_MS);
  return prisma.$executeRaw`
    INSERT INTO crm_webhook_deliveries (id, company_id, subscription_id, event_id, event_type, status, next_attempt_at, created_at)
    SELECT gen_random_uuid(), e.company_id, s.id, e.id, e.event_type, 'PENDING', ${now}, ${now}
    FROM crm_webhook_subscriptions s
    JOIN crm_events e ON e.company_id = s.company_id AND e.event_type = ANY(s.event_types)
    WHERE s.is_active
      AND e.occurred_at >= GREATEST(s.active_since, ${floor})
      AND NOT EXISTS (SELECT 1 FROM crm_webhook_deliveries d WHERE d.subscription_id = s.id AND d.event_id = e.id)
    ORDER BY e.occurred_at, e.id
    LIMIT ${QUEUE_BATCH}
    ON CONFLICT (subscription_id, event_id) DO NOTHING`;
}

/** Short, user-safe reason for a failure (no internal addresses, no receiver response bodies). */
export function describeFailure(e: unknown): { code: string; message: string; status: number | null; retryable: boolean } {
  if (e instanceof WebhookBlockedError) return { code: "DESTINATION_BLOCKED", message: e.message, status: null, retryable: false };
  if (e instanceof WebhookCallError) {
    if (e.status !== null) {
      const retryable = e.status === 408 || e.status === 429 || e.status >= 500;
      if (e.status >= 300 && e.status < 400) return { code: "REDIRECT_REFUSED", message: `The endpoint answered with a redirect (HTTP ${e.status}); redirects are not followed — register the final URL.`, status: e.status, retryable: false };
      return { code: `HTTP_${e.status}`, message: `The endpoint answered HTTP ${e.status}.`, status: e.status, retryable };
    }
    const m = e.message;
    const reason = /didn't answer within/.test(m)
      ? "The endpoint didn't answer within 10 seconds."
      : /ECONNREFUSED/.test(m)
        ? "Connection refused by the endpoint."
        : /ENOTFOUND|EAI_AGAIN/.test(m)
          ? "The endpoint's host name could not be resolved."
          : /certificate|CERT|SSL|TLS/i.test(m)
            ? "TLS / certificate problem at the endpoint."
            : /ECONNRESET|socket hang up/.test(m)
              ? "The connection was reset by the endpoint."
              : "The endpoint could not be reached.";
    return { code: "UNREACHABLE", message: reason, status: null, retryable: true };
  }
  return { code: "UNEXPECTED", message: "Unexpected error while sending.", status: null, retryable: true };
}

type DeliveryRow = Prisma.CrmWebhookDeliveryGetPayload<{ include: { subscription: { select: { id: true; url: true; isActive: true; secretEncrypted: true; companyId: true } } } }>;

async function envelopeFor(d: DeliveryRow): Promise<WebhookEnvelope | null> {
  if (d.isTest) return d.payload as unknown as WebhookEnvelope;
  if (!d.eventId) return null;
  const e = await prisma.crmEvent.findFirst({ where: { id: d.eventId, companyId: d.companyId } });
  return e ? buildEnvelope(e) : null;
}

/** Sends one claimed delivery and records the outcome. */
async function send(d: DeliveryRow, opts: { allowInactive?: boolean; retry?: boolean } = {}) {
  const now = new Date();
  const finish = async (data: Prisma.CrmWebhookDeliveryUpdateInput, subUpdate?: Prisma.CrmWebhookSubscriptionUpdateInput) => {
    // updateMany: the subscription (and its deliveries) may have been deleted while this was sending.
    await prisma.crmWebhookDelivery.updateMany({ where: { id: d.id }, data: { ...(data as Prisma.CrmWebhookDeliveryUpdateManyMutationInput), lockedAt: null, lockToken: null } });
    if (subUpdate) await prisma.crmWebhookSubscription.update({ where: { id: d.subscriptionId }, data: subUpdate }).catch(() => undefined);
  };
  if (!d.subscription.isActive && !opts.allowInactive) return finish({ status: "CANCELLED", errorCode: "SUBSCRIPTION_DISABLED", errorMessage: "The subscription was disabled before this was sent." });
  const envelope = await envelopeFor(d);
  if (!envelope) return finish({ status: "CANCELLED", errorCode: "EVENT_MISSING", errorMessage: "The event no longer exists." });
  const attempt = d.attempts + 1;
  try {
    const res = await postSignedWebhook(d.subscription.url, envelope, {
      secret: decryptSecret(d.subscription.secretEncrypted),
      idempotencyKey: d.id,
      eventId: envelope.id,
      userAgent: WEBHOOK_USER_AGENT,
      extraHeaders: { "X-CRM-Event-Type": envelope.type, "X-CRM-Delivery-Id": d.id, "X-CRM-Delivery-Attempt": String(attempt) },
    });
    await finish(
      { status: "SUCCEEDED", attempts: attempt, responseStatus: res.status, durationMs: res.durationMs, errorCode: null, errorMessage: null, lastAttemptAt: now, deliveredAt: new Date() },
      { lastDeliveryAt: now, lastDeliveryStatus: "SUCCEEDED", lastSuccessAt: now, lastError: null, consecutiveFailures: 0 }
    );
    return { status: "SUCCEEDED" as const, responseStatus: res.status, durationMs: res.durationMs, message: null };
  } catch (e) {
    const f = describeFailure(e);
    if (f.code === "UNEXPECTED") logger.error("Webhook delivery failed unexpectedly", { deliveryId: d.id, error: (e as Error)?.message });
    const willRetry = (opts.retry ?? true) && f.retryable && attempt < WEBHOOK_MAX_ATTEMPTS;
    await finish(
      {
        status: willRetry ? "RETRYING" : "FAILED",
        attempts: attempt,
        responseStatus: f.status,
        durationMs: null,
        errorCode: f.code,
        errorMessage: f.message,
        lastAttemptAt: now,
        nextAttemptAt: willRetry ? new Date(now.getTime() + WEBHOOK_RETRY_DELAYS_MS[attempt - 1]) : now,
      },
      { lastDeliveryAt: now, lastDeliveryStatus: "FAILED", lastError: f.message, consecutiveFailures: { increment: 1 } }
    );
    return { status: willRetry ? ("RETRYING" as const) : ("FAILED" as const), responseStatus: f.status, durationMs: null, message: f.message };
  }
}

/** Claims and sends due deliveries. Returns how many were attempted. */
export async function sendDueWebhookDeliveries(now: Date = new Date()): Promise<number> {
  const token = randomUUID();
  const stale = new Date(now.getTime() - LEASE_MS);
  const claimed = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE crm_webhook_deliveries SET locked_at = ${now}, lock_token = ${token}::uuid
    WHERE id IN (
      SELECT id FROM crm_webhook_deliveries
      WHERE status IN ('PENDING', 'RETRYING') AND next_attempt_at <= ${now} AND (locked_at IS NULL OR locked_at < ${stale})
      ORDER BY next_attempt_at, created_at
      LIMIT ${SEND_BATCH}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id`;
  if (!claimed.length) return 0;
  const rows = await prisma.crmWebhookDelivery.findMany({
    where: { id: { in: claimed.map((c) => c.id) }, lockToken: token },
    include: { subscription: { select: { id: true, url: true, isActive: true, secretEncrypted: true, companyId: true } } },
    orderBy: [{ createdAt: "asc" }],
  });
  // Small concurrency: one slow endpoint shouldn't hold up everyone else's deliveries.
  const queue = [...rows];
  await Promise.all(
    Array.from({ length: Math.min(5, queue.length) }, async () => {
      for (let d = queue.shift(); d; d = queue.shift()) await send(d);
    })
  );
  return rows.length;
}

/** Sends one delivery immediately (test events). */
export async function deliverNow(deliveryId: string, opts: { allowInactive?: boolean; retry?: boolean } = {}) {
  const d = await prisma.crmWebhookDelivery.findUniqueOrThrow({ where: { id: deliveryId }, include: { subscription: { select: { id: true, url: true, isActive: true, secretEncrypted: true, companyId: true } } } });
  const r = await send(d, opts);
  return { deliveryId, ...(r ?? { status: "CANCELLED" as const, responseStatus: null, durationMs: null, message: null }) };
}

export async function purgeOldWebhookDeliveries(now: Date = new Date()) {
  const { count } = await prisma.crmWebhookDelivery.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - WEBHOOK_DELIVERY_RETENTION_DAYS * 86_400_000) }, status: { in: ["SUCCEEDED", "FAILED", "CANCELLED"] } } });
  return count;
}

/** Worker job `webhook.tick`. */
export async function tickWebhooks(now: Date = new Date()) {
  const queued = await queueWebhookDeliveries(now);
  const sent = await sendDueWebhookDeliveries(now);
  const purged = now.getUTCMinutes() === 7 && now.getUTCSeconds() < 20 ? await purgeOldWebhookDeliveries(now) : 0;
  return { queued, sent, purged };
}
