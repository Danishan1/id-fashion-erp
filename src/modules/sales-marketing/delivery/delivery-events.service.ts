import type { MarketingDeliveryEvent, Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { logger } from "@/core/logging/logger";
import { recordSystemContactRestriction } from "@/modules/crm/contacts/crm-contacts.service";
import { runtimeOf, verifyUnsubscribeToken } from "./delivery-common";
import { DELIVERY_RANK, MARKETING_CHANNELS, type DeliveryStatusKey, type MarketingChannelKey } from "./delivery-registry";
import { getProviderAdapter } from "./providers";
import { safeEqual } from "./providers/http";
import type { NormalizedProviderEvent, WebhookRequest } from "./providers/provider-contract";

/**
 * Provider callbacks and unsubscribes (Phase 10).
 *  1. The route authenticates the connection (URL token, constant time) and
 *     the adapter checks the provider's own signature where it has one.
 *  2. Events are stored (unique per connection + event key, so repeats and
 *     replays are stored once) BEFORE we answer the provider.
 *  3. Processing (right after, and by the recovery job) correlates each event
 *     to a delivery and only moves it forward (DELIVERY_RANK); unsubscribes,
 *     complaints and hard bounces become CRM consent restrictions that can
 *     only ever get stricter.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_WEBHOOK_BYTES = 512 * 1024;

const STATUS_FOR_EVENT: Partial<Record<NormalizedProviderEvent, DeliveryStatusKey>> = {
  ACCEPTED: "ACCEPTED",
  SENT: "SENT",
  DELIVERED: "DELIVERED",
  BOUNCED: "BOUNCED",
  REJECTED: "REJECTED",
  FAILED: "FAILED",
};

async function connectionForWebhook(connectionId: string, token: string) {
  if (!UUID_RE.test(connectionId) || !/^[0-9a-f]{48}$/.test(token)) throw new BusinessRuleError("NOT_FOUND", "Webhook not found.");
  const c = await prisma.marketingChannelConnection.findUnique({ where: { id: connectionId } });
  if (!c || !safeEqual(c.webhookToken, token)) throw new BusinessRuleError("NOT_FOUND", "Webhook not found.");
  return c;
}

/** GET: provider subscription handshake (WhatsApp). Returns the text to echo. */
export async function webhookHandshake(connectionId: string, token: string, req: WebhookRequest): Promise<string> {
  const c = await connectionForWebhook(connectionId, token);
  const adapter = getProviderAdapter(c.providerKey);
  const answer = adapter.handshake?.(req, runtimeOf(c)) ?? null;
  if (answer == null) throw new BusinessRuleError("PERMISSION_DENIED", "Verification failed.");
  return answer;
}

/** POST: verify, store, acknowledge. Returns how many new events were stored. */
export async function receiveWebhook(connectionId: string, token: string, req: WebhookRequest): Promise<{ received: number; stored: number }> {
  const c = await connectionForWebhook(connectionId, token);
  const adapter = getProviderAdapter(c.providerKey);
  if (!adapter.parseWebhook) throw new BusinessRuleError("NOT_FOUND", "This provider has no callbacks.");
  const runtime = runtimeOf(c);
  const verified = adapter.verifyWebhook ? adapter.verifyWebhook(req, runtime) : ({ ok: true } as const);
  if (!verified.ok) {
    logger.warn("Marketing webhook rejected", { connectionId: c.id, provider: c.providerKey, reason: verified.reason });
    throw new BusinessRuleError("PERMISSION_DENIED", "Webhook signature is not valid.");
  }
  const events = adapter.parseWebhook(req, runtime);
  if (!events.length) return { received: 0, stored: 0 };
  const res = await prisma.marketingDeliveryEvent.createMany({
    data: events.slice(0, 1000).map((e) => ({
      companyId: c.companyId,
      connectionId: c.id,
      eventKey: e.eventKey,
      providerMessageId: e.providerMessageId?.slice(0, 200) ?? null,
      correlationId: e.correlationId && UUID_RE.test(e.correlationId) ? e.correlationId : null,
      eventType: e.eventType.slice(0, 60),
      normalizedStatus: e.normalized,
      occurredAt: e.occurredAt,
      errorCode: e.errorCode?.slice(0, 60) ?? null,
      detail: e.detail?.slice(0, 200) ?? null,
    })),
    skipDuplicates: true,
  });
  return { received: events.length, stored: res.count };
}

async function findDelivery(ev: MarketingDeliveryEvent) {
  if (ev.correlationId) {
    const d = await prisma.marketingDelivery.findFirst({ where: { id: ev.correlationId, connectionId: ev.connectionId } });
    if (d) return d;
  }
  if (ev.providerMessageId) return prisma.marketingDelivery.findFirst({ where: { connectionId: ev.connectionId, providerMessageId: ev.providerMessageId } });
  return null;
}

async function applyConsent(ev: MarketingDeliveryEvent, delivery: { companyId: string; contactId: string; runId: string }) {
  const run = await prisma.marketingDeliveryRun.findUnique({ where: { id: delivery.runId }, select: { channelType: true, campaign: { select: { code: true } } } });
  if (!run) return false;
  const channel = MARKETING_CHANNELS[run.channelType as MarketingChannelKey].consentChannel;
  const n = ev.normalizedStatus as NormalizedProviderEvent;
  if (n === "UNSUBSCRIBED") return recordSystemContactRestriction(delivery.companyId, delivery.contactId, channel, "UNSUBSCRIBED", `Unsubscribed through the email provider (campaign ${run.campaign.code}).`);
  if (n === "COMPLAINED") return recordSystemContactRestriction(delivery.companyId, delivery.contactId, channel, "UNSUBSCRIBED", `Marked a campaign message as spam (campaign ${run.campaign.code}).`);
  if (n === "BOUNCED" && channel === "EMAIL") return recordSystemContactRestriction(delivery.companyId, delivery.contactId, "EMAIL", "BOUNCED", `Hard bounce reported by the email provider (campaign ${run.campaign.code}).`);
  return false;
}

/** Applies one stored event. Safe to call again (processedAt guards it). */
export async function processDeliveryEvent(ev: MarketingDeliveryEvent): Promise<string> {
  let result = "IGNORED";
  try {
    const d = await findDelivery(ev);
    if (!d) result = "UNMATCHED";
    else {
      const target = ev.normalizedStatus ? STATUS_FOR_EVENT[ev.normalizedStatus as NormalizedProviderEvent] : undefined;
      if (target) {
        const current = d.status as DeliveryStatusKey;
        if (DELIVERY_RANK[target] > DELIVERY_RANK[current]) {
          const data: Prisma.MarketingDeliveryUpdateManyMutationInput = {
            status: target,
            statusAt: ev.occurredAt,
            providerStatus: ev.eventType,
            ...(d.providerMessageId ? {} : ev.providerMessageId ? { providerMessageId: ev.providerMessageId } : {}),
            ...(target === "DELIVERED" ? { deliveredAt: ev.occurredAt } : {}),
            ...(["BOUNCED", "REJECTED", "FAILED"].includes(target) ? { failedAt: ev.occurredAt, errorCode: ev.errorCode ?? target, errorMessage: ev.detail } : {}),
            ...(target !== "FAILED" && current === "UNKNOWN" ? { errorCode: null, errorMessage: null } : {}),
          };
          // Optimistic: only if nobody changed it meanwhile.
          const res = await prisma.marketingDelivery.updateMany({ where: { id: d.id, status: current }, data });
          result = res.count ? "APPLIED" : "RACED";
        } else result = "STALE";
      }
      const consentChanged = await applyConsent(ev, d);
      if (consentChanged) result = result === "APPLIED" ? "APPLIED_CONSENT" : "CONSENT_UPDATED";
      await prisma.marketingDeliveryEvent.update({ where: { id: ev.id }, data: { deliveryId: d.id } });
    }
  } catch (e) {
    logger.error("Marketing delivery event processing failed", { eventId: ev.id, error: (e as Error)?.message });
    result = "ERROR";
  }
  await prisma.marketingDeliveryEvent.updateMany({ where: { id: ev.id, processedAt: null }, data: { processedAt: new Date(), result } });
  return result;
}

/** Processes stored, unprocessed events oldest first (webhook route + recovery job). */
export async function processPendingEvents(limit = 500): Promise<number> {
  const events = await prisma.marketingDeliveryEvent.findMany({ where: { processedAt: null }, orderBy: [{ occurredAt: "asc" }, { receivedAt: "asc" }], take: limit });
  for (const ev of events) await processDeliveryEvent(ev);
  return events.length;
}

// ── Unsubscribe link ───────────────────────────────────────────────

/** Looks up what an unsubscribe link is for (no personal data beyond a masked address). */
export async function describeUnsubscribe(token: string) {
  const deliveryId = verifyUnsubscribeToken(token);
  if (!deliveryId) return null;
  const d = await prisma.marketingDelivery.findUnique({ where: { id: deliveryId }, select: { id: true, destination: true, run: { select: { channelType: true } } } });
  if (!d) return null;
  const masked = d.destination ? d.destination.replace(/^(.{1,2}).*(@.*)$/, "$1•••$2") : null;
  return { deliveryId: d.id, channel: d.run.channelType, maskedAddress: masked };
}

/** Records the unsubscribe as a CRM consent restriction (idempotent; never re-allows). */
export async function unsubscribeByToken(token: string): Promise<boolean> {
  const deliveryId = verifyUnsubscribeToken(token);
  if (!deliveryId) return false;
  const d = await prisma.marketingDelivery.findUnique({ where: { id: deliveryId }, select: { id: true, companyId: true, contactId: true, connectionId: true, run: { select: { channelType: true, campaign: { select: { code: true } } } } } });
  if (!d) return false;
  const channel = MARKETING_CHANNELS[d.run.channelType as MarketingChannelKey].consentChannel;
  await recordSystemContactRestriction(d.companyId, d.contactId, channel, "UNSUBSCRIBED", `Unsubscribed with the link in a campaign message (campaign ${d.run.campaign.code}).`);
  await prisma.marketingDeliveryEvent.createMany({
    data: [{ companyId: d.companyId, connectionId: d.connectionId, deliveryId: d.id, source: "APP", eventKey: `unsubscribe:${d.id}`, eventType: "unsubscribe_link", normalizedStatus: "UNSUBSCRIBED", occurredAt: new Date(), processedAt: new Date(), result: "CONSENT_UPDATED" }],
    skipDuplicates: true,
  });
  return true;
}
