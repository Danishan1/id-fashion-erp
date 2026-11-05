import { randomUUID } from "crypto";
import type { MarketingDelivery, MarketingDeliveryRun, Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { logger } from "@/core/logging/logger";
import { checkContacts, markDuplicateAddresses } from "./audience-eligibility";
import { auditDelivery, publicBaseUrl, recordDeliveryCampaignEvent, RUNS_TABLE, runtimeOf, signUnsubscribeToken, unsubscribePath } from "./delivery-common";
import { MARKETING_PROVIDERS, type ConsentPolicyKey, type DeliveryStatusKey, type MarketingChannelKey, type RunStatusKey, type SkipReasonKey } from "./delivery-registry";
import { providerMetadataOf, recipientValues, renderForRecipient, withUnsubscribeFooter } from "./delivery-render";
import { enqueueRunStep } from "./delivery-queue";
import { defaultProviderDeps, getProviderAdapter, type ProviderDeps } from "./providers";
import type { SendOutcome } from "./providers/provider-contract";

/**
 * Delivery execution (Phase 10), run by the worker:
 *   run.prepare  → one delivery row per audience contact (PENDING, or
 *                  SUPPRESSED with a reason), then SCHEDULED / QUEUED.
 *   run.dispatch → sends PENDING deliveries in small batches under a run
 *                  lease, re-checking consent just before each batch.
 *
 * No duplicate sends: a delivery is claimed PENDING → SUBMITTING with a
 * guarded update before the provider is called; only the claimant writes
 * the result. A send that may or may not have reached the provider becomes
 * UNKNOWN and is never resent automatically. (run, contact) is unique, so a
 * re-prepared run can't create a second delivery for the same person.
 */

export const LEASE_MS = 5 * 60_000;
export const DISPATCH_BUDGET_MS = 45_000;
export const MAX_ATTEMPTS = 5;
const PREPARE_BATCH = 1000;
/** Consecutive "provider unreachable" results that open the circuit breaker. */
const BREAKER_THRESHOLD = 5;
const BREAKER_PAUSE_MS = 5 * 60_000;

export interface EngineDeps extends ProviderDeps {
  sleep: (ms: number) => Promise<void>;
  /** Re-enqueue a step (tests run steps by hand). */
  schedule: (step: "run.prepare" | "run.dispatch", runId: string, at?: Date | null) => Promise<boolean>;
}

export const defaultEngineDeps: EngineDeps = { ...defaultProviderDeps, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), schedule: enqueueRunStep };

/** Bounded exponential backoff with jitter: ~1m, 2m, 4m, 8m … max 30m. */
export function backoffMs(attempt: number, random = Math.random): number {
  const base = Math.min(30 * 60_000, 60_000 * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.8 + random() * 0.4));
}

interface Audience {
  segments: { evaluationId: string; role: "INCLUDE" | "EXCLUDE" }[];
}

async function claimRun(runId: string, statuses: RunStatusKey[], now: Date): Promise<{ run: MarketingDeliveryRun; token: string } | null> {
  const token = randomUUID();
  const res = await prisma.marketingDeliveryRun.updateMany({
    where: { id: runId, status: { in: statuses }, OR: [{ lockToken: null }, { lockedAt: { lt: new Date(now.getTime() - LEASE_MS) } }] },
    data: { lockToken: token, lockedAt: now },
  });
  if (res.count === 0) return null;
  return { run: await prisma.marketingDeliveryRun.findUniqueOrThrow({ where: { id: runId } }), token };
}

async function releaseRun(runId: string, token: string, data: Prisma.MarketingDeliveryRunUpdateManyMutationInput) {
  return prisma.marketingDeliveryRun.updateMany({ where: { id: runId, lockToken: token }, data: { ...data, lockToken: null, lockedAt: null } });
}

const systemActor = (run: MarketingDeliveryRun) => ({ companyId: run.companyId, userId: run.initiatedByUserId });

// ── Prepare ────────────────────────────────────────────────────────

export async function prepareRun(runId: string, deps: EngineDeps = defaultEngineDeps): Promise<{ status: string }> {
  const now = deps.now();
  const claimed = await claimRun(runId, ["PREPARING"], now);
  if (!claimed) return { status: "SKIPPED" };
  const { run, token } = claimed;
  try {
    const connection = await prisma.marketingChannelConnection.findUniqueOrThrow({ where: { id: run.connectionId } });
    const adapter = getProviderAdapter(connection.providerKey);
    const audience = run.audienceJson as unknown as Audience;
    const inc = audience.segments.filter((s) => s.role === "INCLUDE").map((s) => s.evaluationId);
    const exc = audience.segments.filter((s) => s.role === "EXCLUDE").map((s) => s.evaluationId);
    const evals = await prisma.marketingSegmentEvaluation.findMany({ where: { id: { in: [...inc, ...exc] } }, select: { id: true, status: true, entriesPurgedAt: true } });
    if (evals.length !== inc.length + exc.length || evals.some((e) => e.status !== "COMPLETED" || e.entriesPurgedAt)) {
      await failRun(run, token, "An audience snapshot this run was created from is no longer available (retention removed it). Start a new run.");
      return { status: "FAILED" };
    }
    const [incRows, excRows] = await Promise.all([
      prisma.marketingSegmentSnapshotEntry.findMany({ where: { evaluationId: { in: inc }, outcome: "INCLUDED" }, select: { recordId: true } }),
      exc.length ? prisma.marketingSegmentSnapshotEntry.findMany({ where: { evaluationId: { in: exc }, outcome: "INCLUDED" }, select: { recordId: true } }) : Promise.resolve([]),
    ]);
    const excluded = new Set(excRows.map((r) => r.recordId));
    const ids = [...new Set(incRows.map((r) => r.recordId))].filter((id) => !excluded.has(id)).sort();
    const summary: Record<string, number> = {};
    const seen = new Set<string>();
    for (let i = 0; i < ids.length; i += PREPARE_BATCH) {
      const chunk = ids.slice(i, i + PREPARE_BATCH);
      const checked = markDuplicateAddresses(await checkContacts(run.companyId, chunk, run.channelType as MarketingChannelKey, adapter, connection.config as Record<string, string | number>, connection.consentPolicy as ConsentPolicyKey), seen);
      for (const c of checked) if (c.reason) summary[c.reason] = (summary[c.reason] ?? 0) + 1;
      await prisma.marketingDelivery.createMany({
        data: checked.map((c) => ({
          companyId: run.companyId,
          runId: run.id,
          connectionId: run.connectionId,
          contactId: c.contactId,
          // Skipped recipients keep no address.
          destination: c.ok ? c.destination : null,
          status: (c.ok ? "PENDING" : "SUPPRESSED") as DeliveryStatusKey,
          skipReason: c.reason,
          statusAt: now,
        })),
        skipDuplicates: true,
      });
    }
    const cancel = (await prisma.marketingDeliveryRun.findUniqueOrThrow({ where: { id: run.id }, select: { cancelRequestedAt: true } })).cancelRequestedAt;
    if (cancel) {
      await prisma.marketingDelivery.updateMany({ where: { runId: run.id, status: "PENDING" }, data: { status: "CANCELLED", statusAt: now } });
      await releaseRun(run.id, token, { status: "CANCELLED", finishedAt: now, plannedCount: ids.length, exclusionSummary: summary, preparedAt: now });
      return { status: "CANCELLED" };
    }
    const scheduled = run.scheduledFor && run.scheduledFor > now;
    const next: RunStatusKey = scheduled ? "SCHEDULED" : "QUEUED";
    const at = scheduled ? run.scheduledFor! : now;
    await releaseRun(run.id, token, { status: next, plannedCount: ids.length, exclusionSummary: summary, preparedAt: now, nextDispatchAt: at });
    await prisma.$transaction(async (tx) => {
      await recordDeliveryCampaignEvent(tx, systemActor(run), run.campaignId, "DELIVERY_RUN_PREPARED", null, { runId: run.id, runNumber: run.runNumber, recipients: ids.length, skipped: summary });
    });
    await deps.schedule("run.dispatch", run.id, at);
    return { status: next };
  } catch (e) {
    logger.error("Delivery run preparation failed", { runId, error: e as Error });
    await failRun(run, token, "Preparing the run failed unexpectedly. Start a new run or contact support.");
    return { status: "FAILED" };
  }
}

async function failRun(run: MarketingDeliveryRun, token: string, error: string) {
  await releaseRun(run.id, token, { status: "FAILED", error: error.slice(0, 1000), finishedAt: new Date() });
  await prisma.$transaction(async (tx) => {
    await recordDeliveryCampaignEvent(tx, systemActor(run), run.campaignId, "DELIVERY_RUN_FAILED", error.slice(0, 500), { runId: run.id, runNumber: run.runNumber });
    await auditDelivery(tx, systemActor(run), RUNS_TABLE, run.id, "UPDATE", { status: run.status }, { status: "FAILED", error });
  });
}

// ── Dispatch ───────────────────────────────────────────────────────

/** Writes one attempt's result (only while this run still holds the delivery). */
async function settleAttempt(d: MarketingDelivery, claim: string, outcome: SendOutcome, now: Date, attempt: number): Promise<void> {
  const base = { lockToken: null, lastAttemptAt: now, statusAt: now } as const;
  let data: Prisma.MarketingDeliveryUpdateManyMutationInput;
  if (outcome.kind === "ACCEPTED") {
    data = { ...base, status: "ACCEPTED", acceptedAt: now, providerMessageId: outcome.providerMessageId, providerStatus: outcome.providerStatus ?? null, errorCode: null, errorMessage: null, nextAttemptAt: null };
  } else if (outcome.kind === "PERMANENT") {
    data = { ...base, status: "FAILED", failedAt: now, errorCode: outcome.code, errorMessage: outcome.message.slice(0, 300), providerStatus: outcome.providerStatus ?? null, nextAttemptAt: null };
  } else if (outcome.kind === "UNKNOWN") {
    data = { ...base, status: "UNKNOWN", errorCode: outcome.code, errorMessage: outcome.message.slice(0, 300), providerStatus: outcome.providerStatus ?? null, nextAttemptAt: null };
  } else if (outcome.kind === "CONNECTION") {
    // The provider refused the account, not the message: this attempt doesn't count.
    data = { ...base, status: "PENDING", attempts: { decrement: 1 }, errorCode: outcome.code, errorMessage: outcome.message.slice(0, 300), nextAttemptAt: null };
  } else if (attempt >= MAX_ATTEMPTS) {
    data = { ...base, status: "FAILED", failedAt: now, errorCode: "RETRIES_EXHAUSTED", errorMessage: `${outcome.message.slice(0, 200)} (gave up after ${attempt} attempts)`, nextAttemptAt: null };
  } else {
    const wait = outcome.kind === "THROTTLED" && outcome.retryAfterMs ? outcome.retryAfterMs : backoffMs(attempt);
    data = { ...base, status: "PENDING", errorCode: outcome.code, errorMessage: outcome.message.slice(0, 300), nextAttemptAt: new Date(now.getTime() + wait) };
  }
  const res = await prisma.marketingDelivery.updateMany({ where: { id: d.id, status: "SUBMITTING", lockToken: claim }, data });
  if (res.count === 0 && outcome.kind === "ACCEPTED") {
    // A provider callback already moved it further (correlated by our id) — keep that, just remember the provider id.
    await prisma.marketingDelivery.updateMany({ where: { id: d.id, providerMessageId: null }, data: { providerMessageId: outcome.providerMessageId, acceptedAt: now } });
  }
  await prisma.marketingDeliveryEvent.createMany({
    data: [
      {
        companyId: d.companyId,
        connectionId: d.connectionId,
        deliveryId: d.id,
        source: "APP",
        eventKey: `attempt:${d.id}:${attempt}:${claim.slice(0, 8)}`,
        providerMessageId: outcome.kind === "ACCEPTED" ? outcome.providerMessageId : null,
        eventType: `send_attempt_${outcome.kind.toLowerCase()}`,
        normalizedStatus: outcome.kind === "ACCEPTED" ? "ACCEPTED" : outcome.kind === "PERMANENT" ? "FAILED" : outcome.kind === "UNKNOWN" ? "UNKNOWN" : null,
        occurredAt: now,
        processedAt: now,
        result: "APPLIED",
        errorCode: outcome.kind === "ACCEPTED" ? null : outcome.code,
        detail: outcome.kind === "ACCEPTED" ? null : outcome.message.slice(0, 200),
      },
    ],
    skipDuplicates: true,
  });
}

/**
 * One slice of sending (≤ DISPATCH_BUDGET_MS). Re-enqueues itself while
 * work remains; finishes the run when nothing is left to send.
 */
export async function dispatchRun(runId: string, deps: EngineDeps = defaultEngineDeps): Promise<{ status: string; sent?: number }> {
  const start = deps.now();
  const claimed = await claimRun(runId, ["SCHEDULED", "QUEUED", "RUNNING"], start);
  if (!claimed) return { status: "SKIPPED" };
  const { run, token } = claimed;
  if (run.nextDispatchAt && run.nextDispatchAt > start) {
    await releaseRun(run.id, token, {});
    await deps.schedule("run.dispatch", run.id, run.nextDispatchAt);
    return { status: "NOT_DUE" };
  }
  try {
    if (run.cancelRequestedAt) return await finishCancelled(run, token, start);
    const [campaign, connection, version] = await Promise.all([
      prisma.marketingCampaign.findUniqueOrThrow({ where: { id: run.campaignId }, select: { status: true, code: true } }),
      prisma.marketingChannelConnection.findUniqueOrThrow({ where: { id: run.connectionId } }),
      prisma.crmMessageTemplateVersion.findUniqueOrThrow({ where: { id: run.templateVersionId } }),
    ]);
    if (campaign.status !== "ACTIVE") return await stopRun(run, token, `The campaign is ${campaign.status.toLowerCase()}, not active. Messages already sent are unaffected; resume the run after reactivating the campaign.`);
    if (connection.status !== "ACTIVE") return await stopRun(run, token, "The channel connection is disabled. Enable it and resume the run.");
    if (connection.circuitOpenUntil && connection.circuitOpenUntil > start) {
      await releaseRun(run.id, token, { status: "QUEUED", nextDispatchAt: connection.circuitOpenUntil });
      await deps.schedule("run.dispatch", run.id, connection.circuitOpenUntil);
      return { status: "PAUSED_PROVIDER" };
    }
    if (run.status !== "RUNNING") {
      await prisma.marketingDeliveryRun.updateMany({ where: { id: run.id, lockToken: token }, data: { status: "RUNNING", startedAt: run.startedAt ?? start } });
      if (!run.startedAt) await prisma.$transaction((tx) => recordDeliveryCampaignEvent(tx, systemActor(run), run.campaignId, "DELIVERY_RUN_STARTED", null, { runId: run.id, runNumber: run.runNumber }));
    }

    const adapter = getProviderAdapter(connection.providerKey);
    const runtime = runtimeOf(connection);
    const channel = run.channelType as MarketingChannelKey;
    const providerMetadata = providerMetadataOf(version);
    const baseUrl = publicBaseUrl();
    const intervalMs = Math.ceil(60_000 / connection.ratePerMinute);
    let lastSendAt = 0;
    let sent = 0;
    let unreachableStreak = 0;

    for (;;) {
      if (deps.now().getTime() - start.getTime() > DISPATCH_BUDGET_MS) break;
      const fresh = await prisma.marketingDeliveryRun.findUniqueOrThrow({ where: { id: run.id }, select: { cancelRequestedAt: true, lockToken: true } });
      if (fresh.lockToken !== token) return { status: "LEASE_LOST", sent };
      if (fresh.cancelRequestedAt) return await finishCancelled(run, token, deps.now());
      const now = deps.now();
      const batch = await prisma.marketingDelivery.findMany({
        where: { runId: run.id, status: "PENDING", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
        orderBy: { id: "asc" },
        take: connection.batchSize,
      });
      if (!batch.length) break;
      // Consent and address are checked again just before sending.
      const rechecked = new Map((await checkContacts(run.companyId, batch.map((b) => b.contactId), channel, adapter, runtime.config, connection.consentPolicy as ConsentPolicyKey)).map((c) => [c.contactId, c]));
      const values = await recipientValues(run.companyId, batch.map((b) => b.contactId), run.initiatedByUserId);
      let stop: { reason: "THROTTLED" | "CONNECTION" | "BREAKER"; until?: Date; message?: string } | null = null;
      for (const d of batch) {
        const check = rechecked.get(d.contactId);
        if (!check?.ok || !check.destination) {
          const reason: SkipReasonKey = check?.reason ?? "RECORD_UNAVAILABLE";
          await prisma.marketingDelivery.updateMany({ where: { id: d.id, status: "PENDING" }, data: { status: "SUPPRESSED", skipReason: reason, destination: null, statusAt: deps.now() } });
          continue;
        }
        const claim = randomUUID();
        const attempt = d.attempts + 1;
        // The address in the CRM now (it may have been corrected since the run was prepared).
        const claimed = await prisma.marketingDelivery.updateMany({ where: { id: d.id, status: "PENDING" }, data: { status: "SUBMITTING", lockToken: claim, attempts: { increment: 1 }, lastAttemptAt: deps.now(), destination: check.destination } });
        if (claimed.count === 0) continue;
        const v = values.get(d.contactId) ?? {};
        const rendered = renderForRecipient(version, v, "company.name" in v);
        if (rendered.issues.some((i) => i.severity === "error")) {
          await prisma.marketingDelivery.updateMany({ where: { id: d.id, lockToken: claim }, data: { status: "SUPPRESSED", skipReason: "RENDER_FAILED", lockToken: null, statusAt: deps.now() } });
          continue;
        }
        const unsubscribeUrl = channel === "EMAIL" && baseUrl ? `${baseUrl}${unsubscribePath(signUnsubscribeToken(d.id))}` : null;
        const body = channel === "EMAIL" && unsubscribeUrl ? withUnsubscribeFooter(rendered.body, unsubscribeUrl) : rendered.body;
        const msg = { deliveryId: d.id, to: check.destination, toName: check.name, subject: rendered.subject, body, parameters: rendered.parameters, providerMetadata, unsubscribeUrl, tag: campaign.code };
        const problems = adapter.validateMessage(msg, runtime.config);
        let outcome: SendOutcome;
        if (problems.length) outcome = { kind: "PERMANENT", code: "INVALID_MESSAGE", message: problems.join(" ") };
        else {
          const wait = lastSendAt + intervalMs - deps.now().getTime();
          if (wait > 0) await deps.sleep(wait);
          lastSendAt = deps.now().getTime();
          try {
            outcome = await adapter.send(runtime, msg, deps);
          } catch (e) {
            logger.error("Provider adapter threw", { runId: run.id, deliveryId: d.id, provider: connection.providerKey, error: (e as Error)?.message });
            outcome = { kind: "UNKNOWN", code: "ADAPTER_ERROR", message: "Sending failed unexpectedly — the provider may or may not have received it." };
          }
        }
        await settleAttempt(d, claim, outcome, deps.now(), attempt);
        logger.info("Marketing delivery attempt", { runId: run.id, deliveryId: d.id, provider: connection.providerKey, outcome: outcome.kind, code: "code" in outcome ? outcome.code : undefined });
        if (outcome.kind === "ACCEPTED") {
          sent += 1;
          unreachableStreak = 0;
        } else if (outcome.kind === "RETRYABLE") {
          unreachableStreak += 1;
          if (unreachableStreak >= BREAKER_THRESHOLD) {
            stop = { reason: "BREAKER", until: new Date(deps.now().getTime() + BREAKER_PAUSE_MS) };
            break;
          }
        } else if (outcome.kind === "THROTTLED") {
          stop = { reason: "THROTTLED", until: new Date(deps.now().getTime() + (outcome.retryAfterMs ?? 60_000)) };
          break;
        } else if (outcome.kind === "CONNECTION") {
          stop = { reason: "CONNECTION", message: outcome.message };
          break;
        }
      }
      await prisma.marketingChannelConnection.update({
        where: { id: connection.id },
        data: {
          lastSendAt: sent ? deps.now() : undefined,
          ...(stop?.reason === "BREAKER" ? { consecutiveFailures: { increment: 1 }, circuitOpenUntil: stop.until } : sent ? { consecutiveFailures: 0 } : {}),
          ...(stop?.reason === "CONNECTION" ? { consecutiveFailures: { increment: 1 }, lastTestStatus: "FAILED", lastTestMessage: stop.message?.slice(0, 300) ?? null, lastTestedAt: deps.now() } : {}),
        },
      });
      if (stop?.reason === "CONNECTION") return await stopRun(run, token, `${stop.message ?? "The provider rejected the account."} Fix the connection and resume the run.`, sent);
      if (stop?.until) {
        await releaseRun(run.id, token, { status: "RUNNING", nextDispatchAt: stop.until });
        await deps.schedule("run.dispatch", run.id, stop.until);
        return { status: stop.reason, sent };
      }
    }
    return await afterSlice(run, token, deps, sent);
  } catch (e) {
    logger.error("Delivery dispatch failed", { runId, error: e as Error });
    // Leave deliveries as they are; the recovery job re-dispatches once the lease expires.
    await releaseRun(run.id, token, { nextDispatchAt: new Date(deps.now().getTime() + 60_000) });
    await deps.schedule("run.dispatch", run.id, new Date(deps.now().getTime() + 60_000));
    return { status: "ERROR" };
  }
}

/** Decide what happens after a slice: more now, more later, or done. */
async function afterSlice(run: MarketingDeliveryRun, token: string, deps: EngineDeps, sent: number) {
  const now = deps.now();
  const [readyNow, later] = await Promise.all([
    prisma.marketingDelivery.count({ where: { runId: run.id, status: "PENDING", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] } }),
    prisma.marketingDelivery.findFirst({ where: { runId: run.id, status: "PENDING", nextAttemptAt: { gt: now } }, orderBy: { nextAttemptAt: "asc" }, select: { nextAttemptAt: true } }),
  ]);
  if (readyNow) {
    await releaseRun(run.id, token, { status: "RUNNING", nextDispatchAt: now });
    await deps.schedule("run.dispatch", run.id, now);
    return { status: "CONTINUING", sent };
  }
  if (later?.nextAttemptAt) {
    await releaseRun(run.id, token, { status: "RUNNING", nextDispatchAt: later.nextAttemptAt });
    await deps.schedule("run.dispatch", run.id, later.nextAttemptAt);
    return { status: "WAITING_RETRY", sent };
  }
  return finishRun(run, token, now, sent);
}

export async function runOutcomeCounts(runId: string) {
  const rows = await prisma.marketingDelivery.groupBy({ by: ["status"], where: { runId }, _count: { _all: true } });
  const by = Object.fromEntries(rows.map((r) => [r.status, r._count._all])) as Partial<Record<DeliveryStatusKey, number>>;
  const n = (k: DeliveryStatusKey) => by[k] ?? 0;
  return {
    byStatus: by,
    planned: rows.reduce((a, r) => a + r._count._all, 0),
    eligible: rows.reduce((a, r) => a + r._count._all, 0) - n("SUPPRESSED"),
    excluded: n("SUPPRESSED"),
    pending: n("PENDING") + n("SUBMITTING"),
    accepted: n("ACCEPTED") + n("SENT") + n("DELIVERED"),
    delivered: n("DELIVERED"),
    failed: n("FAILED") + n("BOUNCED") + n("REJECTED"),
    unknown: n("UNKNOWN"),
    cancelled: n("CANCELLED"),
  };
}

async function finishRun(run: MarketingDeliveryRun, token: string, now: Date, sent: number) {
  const c = await runOutcomeCounts(run.id);
  const status: RunStatusKey = c.accepted === 0 && c.failed + c.unknown > 0 ? "FAILED" : c.failed + c.unknown > 0 ? "PARTIALLY_COMPLETED" : "COMPLETED";
  await releaseRun(run.id, token, { status, finishedAt: now, nextDispatchAt: null, error: status === "FAILED" ? "No message was accepted by the provider." : null });
  await prisma.$transaction(async (tx) => {
    await recordDeliveryCampaignEvent(tx, systemActor(run), run.campaignId, "DELIVERY_RUN_FINISHED", null, { runId: run.id, runNumber: run.runNumber, status, accepted: c.accepted, failed: c.failed, unknown: c.unknown, skipped: c.excluded });
    await auditDelivery(tx, systemActor(run), RUNS_TABLE, run.id, "UPDATE", { status: run.status }, { status, counts: { accepted: c.accepted, failed: c.failed, unknown: c.unknown, skipped: c.excluded } });
  });
  return { status, sent };
}

async function stopRun(run: MarketingDeliveryRun, token: string, error: string, sent = 0) {
  await releaseRun(run.id, token, { status: "FAILED", error: error.slice(0, 1000), finishedAt: new Date(), nextDispatchAt: null });
  await prisma.$transaction(async (tx) => {
    await recordDeliveryCampaignEvent(tx, systemActor(run), run.campaignId, "DELIVERY_RUN_STOPPED", error.slice(0, 500), { runId: run.id, runNumber: run.runNumber });
    await auditDelivery(tx, systemActor(run), RUNS_TABLE, run.id, "UPDATE", { status: run.status }, { status: "FAILED", error });
  });
  return { status: "STOPPED", sent };
}

async function finishCancelled(run: MarketingDeliveryRun, token: string, now: Date) {
  const res = await prisma.marketingDelivery.updateMany({ where: { runId: run.id, status: "PENDING" }, data: { status: "CANCELLED", statusAt: now, nextAttemptAt: null } });
  await releaseRun(run.id, token, { status: "CANCELLED", finishedAt: now, nextDispatchAt: null });
  await prisma.$transaction((tx) => recordDeliveryCampaignEvent(tx, systemActor(run), run.campaignId, "DELIVERY_RUN_CANCELLED", null, { runId: run.id, runNumber: run.runNumber, notSent: res.count }));
  return { status: "CANCELLED" };
}

// ── Recovery ───────────────────────────────────────────────────────

/**
 * Every few minutes: deliveries stuck SUBMITTING (worker died mid-send) become
 * UNKNOWN — never PENDING, since the provider may have the message; due or
 * lost runs are re-enqueued.
 */
export async function recoverDelivery(deps: EngineDeps = defaultEngineDeps) {
  const now = deps.now();
  const stuck = await prisma.marketingDelivery.updateMany({
    where: { status: "SUBMITTING", lastAttemptAt: { lt: new Date(now.getTime() - 10 * 60_000) } },
    data: { status: "UNKNOWN", lockToken: null, errorCode: "INTERRUPTED", errorMessage: "Sending was interrupted — the provider may or may not have received it.", statusAt: now },
  });
  const due = await prisma.marketingDeliveryRun.findMany({
    where: {
      OR: [
        { status: { in: ["SCHEDULED", "QUEUED", "RUNNING"] }, nextDispatchAt: { lte: now }, OR: [{ lockToken: null }, { lockedAt: { lt: new Date(now.getTime() - LEASE_MS) } }] },
        { status: "PREPARING", OR: [{ lockToken: null }, { lockedAt: { lt: new Date(now.getTime() - LEASE_MS) } }], createdAt: { lt: new Date(now.getTime() - 2 * 60_000) } },
      ],
    },
    select: { id: true, status: true },
    take: 100,
  });
  for (const r of due) await deps.schedule(r.status === "PREPARING" ? "run.prepare" : "run.dispatch", r.id, now);
  return { interrupted: stuck.count, requeued: due.length };
}

export { MARKETING_PROVIDERS };
