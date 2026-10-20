import { randomBytes, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { encryptSecret } from "@/core/security/encryption";
import type { CrmActor } from "../core/crm-actor";
import { WebhookBlockedError, assertWebhookUrlShape, resolveSafeAddress } from "../workflows/workflow-webhook";
import { deliverNow } from "./webhook-delivery";
import { WEBHOOK_ATTENTION_THRESHOLD, WEBHOOK_EVENTS, WEBHOOK_MAX_SUBSCRIPTIONS, isWebhookEventType, sampleEnvelope } from "./webhook-events";

/**
 * Phase 22 — outgoing webhook subscriptions (CRM Settings → Webhooks →
 * Outgoing). Configuration only; delivery is in webhook-delivery.ts.
 *
 * Secret handling: the signing secret is generated with crypto.randomBytes,
 * stored encrypted (AES-GCM, core/security/encryption) because it is needed to
 * sign every request, and returned in plaintext ONLY in the create and
 * rotate responses. Every other read (list, detail, update, test, deliveries)
 * uses SAFE_SELECT, which never includes it; audit rows record that a secret
 * was created / rotated, never the secret.
 */

const SAFE_SELECT = {
  id: true,
  name: true,
  description: true,
  url: true,
  eventTypes: true,
  isActive: true,
  activeSince: true,
  secretRotatedAt: true,
  consecutiveFailures: true,
  lastDeliveryAt: true,
  lastDeliveryStatus: true,
  lastSuccessAt: true,
  lastError: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  createdByUserId: true,
} satisfies Prisma.CrmWebhookSubscriptionSelect;
type SafeRow = Prisma.CrmWebhookSubscriptionGetPayload<{ select: typeof SAFE_SELECT }>;

const newSecret = () => `whsec_${randomBytes(32).toString("base64url")}`;

const eventTypes = z
  .array(z.string())
  .min(1, "Choose at least one event.")
  .max(WEBHOOK_EVENTS.length)
  .transform((v) => [...new Set(v)])
  .refine((v) => v.every(isWebhookEventType), { message: "One or more events are not available." });

export const createSubscriptionSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(80),
    description: z.string().trim().max(500).optional().or(z.literal("")).nullable(),
    url: z.string().trim().min(1, "URL is required").max(2000),
    eventTypes,
    isActive: z.boolean().optional(),
  })
  .strict();

/** No secret field: an edit can never set or return the secret (rotation is its own action). */
export const updateSubscriptionSchema = z
  .object({
    version: z.number().int().min(1),
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(500).optional().or(z.literal("")).nullable(),
    url: z.string().trim().min(1).max(2000).optional(),
    eventTypes: eventTypes.optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

/** URL rules shared with the workflow webhook action: https, public address only, no credentials, standard ports, no redirects (at send time). */
export async function assertSafeDestination(raw: string) {
  try {
    const url = assertWebhookUrlShape(raw);
    await resolveSafeAddress(url);
    return url.toString();
  } catch (e) {
    if (e instanceof WebhookBlockedError) throw new BusinessRuleError("VALIDATION_ERROR", e.message, { fieldErrors: { url: e.message } });
    throw e;
  }
}

function present(row: SafeRow, names?: Map<string, string>) {
  const health = !row.isActive
    ? "DISABLED"
    : row.consecutiveFailures >= WEBHOOK_ATTENTION_THRESHOLD
      ? "NEEDS_ATTENTION"
      : row.lastDeliveryStatus === "FAILED"
        ? "LAST_FAILED"
        : row.lastDeliveryStatus === "SUCCEEDED"
          ? "HEALTHY"
          : "NO_DELIVERIES";
  return {
    ...row,
    // Only ever a status, never the value.
    secret: { configured: true, masked: "whsec_••••••••", rotatedAt: row.secretRotatedAt },
    health,
    createdBy: names?.get(row.createdByUserId) ?? null,
  };
}
export type WebhookSubscriptionDto = ReturnType<typeof present>;

async function load(actor: CrmActor, id: string): Promise<SafeRow> {
  const row = await prisma.crmWebhookSubscription.findFirst({ where: { id, companyId: actor.companyId }, select: SAFE_SELECT });
  if (!row) throw new BusinessRuleError("NOT_FOUND", "Webhook subscription not found.", { id });
  return row;
}

export async function listSubscriptions(actor: CrmActor) {
  const rows = await prisma.crmWebhookSubscription.findMany({ where: { companyId: actor.companyId }, select: SAFE_SELECT, orderBy: { createdAt: "asc" } });
  const names = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdByUserId))] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  return rows.map((r) => present(r, names));
}

export async function getSubscription(actor: CrmActor, id: string) {
  const row = await load(actor, id);
  const [names, counts] = await Promise.all([
    prisma.user.findMany({ where: { id: row.createdByUserId }, select: { id: true, fullName: true } }),
    prisma.crmWebhookDelivery.groupBy({ by: ["status"], where: { subscriptionId: id }, _count: { _all: true } }),
  ]);
  return { ...present(row, new Map(names.map((u) => [u.id, u.fullName]))), deliveryCounts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) };
}

/** Creates a subscription; the response is the ONLY place its signing secret is ever returned. */
export async function createSubscription(actor: CrmActor, raw: unknown) {
  const input = createSubscriptionSchema.parse(raw);
  const url = await assertSafeDestination(input.url);
  const count = await prisma.crmWebhookSubscription.count({ where: { companyId: actor.companyId } });
  if (count >= WEBHOOK_MAX_SUBSCRIPTIONS) throw new BusinessRuleError("VALIDATION_ERROR", `A company can have at most ${WEBHOOK_MAX_SUBSCRIPTIONS} webhook subscriptions.`);
  const secret = newSecret();
  try {
    const row = await prisma.crmWebhookSubscription.create({
      data: {
        companyId: actor.companyId,
        name: input.name,
        description: input.description || null,
        url,
        eventTypes: input.eventTypes,
        isActive: input.isActive ?? true,
        secretEncrypted: encryptSecret(secret),
        createdByUserId: actor.userId,
      },
      select: SAFE_SELECT,
    });
    await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "crm_webhook_subscriptions", recordId: row.id, action: "CREATE", newValues: { name: row.name, url: row.url, eventTypes: row.eventTypes, isActive: row.isActive, secret: "generated" } });
    return { ...present(row), secretOnce: secret };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new BusinessRuleError("VALIDATION_ERROR", "Another webhook subscription already has this name.", { fieldErrors: { name: "Choose a different name." } });
    throw e;
  }
}

export async function updateSubscription(actor: CrmActor, id: string, raw: unknown) {
  const input = updateSubscriptionSchema.parse(raw);
  const before = await load(actor, id);
  const data: Prisma.CrmWebhookSubscriptionUpdateManyMutationInput = { updatedByUserId: actor.userId, version: { increment: 1 } };
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description || null;
  if (input.url !== undefined && input.url !== before.url) data.url = await assertSafeDestination(input.url);
  if (input.eventTypes !== undefined) data.eventTypes = input.eventTypes;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  // New event types and re-enabling start from now — nothing that happened before is replayed.
  const addedTypes = input.eventTypes?.some((t) => !before.eventTypes.includes(t));
  if ((input.isActive && !before.isActive) || addedTypes) data.activeSince = new Date();
  if (input.isActive && !before.isActive) data.consecutiveFailures = 0;
  try {
    const { count } = await prisma.crmWebhookSubscription.updateMany({ where: { id, companyId: actor.companyId, version: input.version }, data });
    if (!count) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This subscription was changed by someone else. Reload and try again.");
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new BusinessRuleError("VALIDATION_ERROR", "Another webhook subscription already has this name.", { fieldErrors: { name: "Choose a different name." } });
    throw e;
  }
  // Disabling drops what is still queued: re-enabling later never sends stale events.
  if (input.isActive === false && before.isActive)
    await prisma.crmWebhookDelivery.updateMany({ where: { subscriptionId: id, status: { in: ["PENDING", "RETRYING"] } }, data: { status: "CANCELLED", errorCode: "SUBSCRIPTION_DISABLED", errorMessage: "The subscription was disabled before this was sent.", lockedAt: null, lockToken: null } });
  const after = await load(actor, id);
  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "crm_webhook_subscriptions",
    recordId: id,
    action: "UPDATE",
    oldValues: { name: before.name, url: before.url, eventTypes: before.eventTypes, isActive: before.isActive },
    newValues: { name: after.name, url: after.url, eventTypes: after.eventTypes, isActive: after.isActive },
  });
  return present(after);
}

/**
 * Replaces the signing secret. The old secret stops working immediately (the
 * next delivery is signed with the new one), so update the receiver right
 * after rotating. The new secret is returned once, here.
 */
export async function rotateSubscriptionSecret(actor: CrmActor, id: string, raw: unknown) {
  const { version } = z.object({ version: z.number().int().min(1) }).strict().parse(raw ?? {});
  await load(actor, id);
  const secret = newSecret();
  const { count } = await prisma.crmWebhookSubscription.updateMany({ where: { id, companyId: actor.companyId, version }, data: { secretEncrypted: encryptSecret(secret), secretRotatedAt: new Date(), version: { increment: 1 }, updatedByUserId: actor.userId } });
  if (!count) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This subscription was changed by someone else. Reload and try again.");
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "crm_webhook_subscriptions", recordId: id, action: "UPDATE", newValues: { secret: "rotated" } });
  return { ...present(await load(actor, id)), secretOnce: secret };
}

/** Deletes the subscription and its delivery log; queued deliveries are dropped. */
export async function deleteSubscription(actor: CrmActor, id: string) {
  const before = await load(actor, id);
  await prisma.crmWebhookSubscription.delete({ where: { id } });
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "crm_webhook_subscriptions", recordId: id, action: "DELETE", oldValues: { name: before.name, url: before.url, eventTypes: before.eventTypes } });
  return { deleted: true };
}

/**
 * Sends a signed, clearly-marked test event (test: true, synthetic data) right
 * now and returns the outcome. Recorded in the delivery log; never retried.
 */
export async function sendTestDelivery(actor: CrmActor, id: string, raw: unknown) {
  const { eventType } = z.object({ eventType: z.string().optional() }).strict().parse(raw ?? {});
  const sub = await load(actor, id);
  const type = eventType && isWebhookEventType(eventType) ? eventType : (sub.eventTypes[0] ?? "lead.created");
  const envelope = { ...sampleEnvelope(type, true), id: randomUUID() };
  const delivery = await prisma.crmWebhookDelivery.create({
    data: { companyId: actor.companyId, subscriptionId: id, eventId: null, eventType: type, isTest: true, payload: envelope as unknown as Prisma.InputJsonValue, status: "PENDING", nextAttemptAt: new Date() },
    select: { id: true },
  });
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "crm_webhook_subscriptions", recordId: id, action: "UPDATE", newValues: { testDelivery: delivery.id, eventType: type } });
  return deliverNow(delivery.id, { allowInactive: true, retry: false });
}

export const DELIVERY_STATUSES = { PENDING: "Queued", RETRYING: "Retrying", SUCCEEDED: "Delivered", FAILED: "Failed", CANCELLED: "Cancelled" } as const;

export async function listDeliveries(actor: CrmActor, id: string, q: { status?: string; skip: number; take: number }) {
  await load(actor, id);
  const where: Prisma.CrmWebhookDeliveryWhereInput = { subscriptionId: id, companyId: actor.companyId, ...(q.status && q.status in DELIVERY_STATUSES ? { status: q.status } : {}) };
  const [rows, totalCount] = await Promise.all([
    prisma.crmWebhookDelivery.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: q.skip,
      take: q.take,
      // Never the payload: delivery logs show outcomes, not record data.
      select: { id: true, eventId: true, eventType: true, isTest: true, status: true, attempts: true, nextAttemptAt: true, responseStatus: true, durationMs: true, errorCode: true, errorMessage: true, lastAttemptAt: true, deliveredAt: true, createdAt: true },
    }),
    prisma.crmWebhookDelivery.count({ where }),
  ]);
  return { rows: rows.map((r) => ({ ...r, statusLabel: DELIVERY_STATUSES[r.status as keyof typeof DELIVERY_STATUSES] ?? r.status, nextAttemptAt: r.status === "PENDING" || r.status === "RETRYING" ? r.nextAttemptAt : null })), totalCount };
}

/** Queues a failed (or delivered) event again, now. Receivers must de-duplicate on Idempotency-Key. */
export async function redeliver(actor: CrmActor, id: string, deliveryId: string) {
  const sub = await load(actor, id);
  if (!sub.isActive) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Enable the subscription before redelivering.");
  const d = await prisma.crmWebhookDelivery.findFirst({ where: { id: deliveryId, subscriptionId: id, companyId: actor.companyId }, select: { id: true, status: true, isTest: true } });
  if (!d) throw new BusinessRuleError("NOT_FOUND", "Delivery not found.");
  if (d.isTest) throw new BusinessRuleError("VALIDATION_ERROR", "Send a new test event instead.");
  if (d.status === "PENDING" || d.status === "RETRYING") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This delivery is already queued.");
  await prisma.crmWebhookDelivery.update({ where: { id: d.id }, data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date(), lockedAt: null, lockToken: null, errorCode: null, errorMessage: null } });
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "crm_webhook_subscriptions", recordId: id, action: "UPDATE", newValues: { redeliver: d.id } });
  return { queued: true };
}

/** Event catalogue for the settings UI (registry-derived; see webhook-events.ts). */
export function listWebhookEvents() {
  return WEBHOOK_EVENTS;
}
