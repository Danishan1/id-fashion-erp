import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { campaignScopeWhere, getCampaignScope, loadCampaign } from "@/modules/sales-marketing/campaigns/campaign-common";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { checkContacts, markDuplicateAddresses, resolveCampaignAudience } from "./audience-eligibility";
import { auditDelivery, publicBaseUrl, recordDeliveryCampaignEvent, RUNS_TABLE, runtimeOf } from "./delivery-common";
import { runOutcomeCounts } from "./delivery-engine";
import { DELIVERY_STATUSES, MARKETING_PROVIDERS, OPEN_RUN_STATUSES, RUN_STATUSES, type ConsentPolicyKey, type MarketingChannelKey, type RunStatusKey } from "./delivery-registry";
import { checkTemplateForDelivery, loadUsableTemplate, providerMetadataOf, sampleRender } from "./delivery-render";
import { defaultProviderDeps, getProviderAdapter, type ProviderDeps } from "./providers";

/**
 * Campaign channels and delivery runs (Phase 10), the user side:
 * configure a campaign's channels, preview eligibility, test-send, start /
 * schedule / cancel / resume runs, resolve unknown outcomes, and read runs,
 * recipients and events. Execution itself is delivery-engine.ts.
 *
 * Rules: a run starts only for an ACTIVE campaign, by an explicit action of
 * someone with marketing_delivery.create — an active or approved campaign
 * never sends on its own. One open run per campaign channel.
 */

const CAMPAIGN_CHANNELS_TABLE = "marketing_campaign_channels";
const MAX_SCHEDULE_DAYS = 90;

const addChannelSchema = z.object({ connectionId: z.string().uuid("Choose a connection"), templateId: z.string().uuid("Choose a message template") }).strict();
const startRunSchema = z
  .object({
    scheduledFor: z.string().datetime({ offset: true }).optional().nullable(),
    idempotencyKey: z.string().trim().min(8).max(100).optional(),
    /** The user confirmed the eligibility preview they saw. */
    confirmed: z.literal(true, { message: "Confirm the recipient count before sending." }),
  })
  .strict();
const cancelSchema = z.object({ reason: z.string().trim().min(3, "Give a reason").max(500) }).strict();
const resolveUnknownSchema = z
  .object({
    resolution: z.enum(["MARK_FAILED", "RESEND"]),
    deliveryIds: z.array(z.string().uuid()).min(1).max(500).optional(),
    /** RESEND may duplicate a message the provider did receive. */
    acknowledgeDuplicateRisk: z.boolean().optional(),
    reason: z.string().trim().min(3, "Give a reason").max(500),
  })
  .strict();
const testSendSchema = z.object({ to: z.string().trim().min(3).max(254) }).strict();

// ── Visibility ─────────────────────────────────────────────────────

async function loadCampaignChannel(actor: SalesActor, id: string) {
  const ch = await prisma.marketingCampaignChannel.findFirst({ where: { id, companyId: actor.companyId }, include: { connection: true, template: { select: { id: true, name: true, channelType: true, status: true } } } });
  if (!ch) throw new BusinessRuleError("NOT_FOUND", "Campaign channel not found.", { id });
  const campaign = await loadCampaign(actor, ch.campaignId);
  return { ch, campaign };
}

async function loadRun(actor: SalesActor, id: string) {
  const run = await prisma.marketingDeliveryRun.findFirst({ where: { id, companyId: actor.companyId } });
  if (!run) throw new BusinessRuleError("NOT_FOUND", "Delivery run not found.", { id });
  const campaign = await loadCampaign(actor, run.campaignId).catch(() => {
    throw new BusinessRuleError("NOT_FOUND", "Delivery run not found.", { id });
  });
  return { run, campaign };
}

// ── Campaign channels ─────────────────────────────────────────────

export async function listCampaignChannels(actor: SalesActor, campaignId: string) {
  await PermissionService.assert(actor.userId, "marketing_delivery", "view");
  const campaign = await loadCampaign(actor, campaignId);
  const rows = await prisma.marketingCampaignChannel.findMany({
    where: { campaignId: campaign.id, companyId: actor.companyId },
    include: { connection: true, template: { select: { id: true, name: true, channelType: true, status: true, currentVersion: { select: { versionNumber: true, subject: true, body: true, variables: true, providerMetadata: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  const runs = await prisma.marketingDeliveryRun.findMany({ where: { campaignId: campaign.id }, orderBy: { runNumber: "desc" }, select: { id: true, campaignChannelId: true, runNumber: true, status: true, scheduledFor: true, createdAt: true, finishedAt: true, plannedCount: true } });
  return {
    campaign: { id: campaign.id, code: campaign.code, status: campaign.status },
    channels: rows.map((r) => {
      const def = MARKETING_PROVIDERS[r.connection.providerKey];
      const v = r.template.currentVersion;
      const problems = [
        ...(r.connection.status !== "ACTIVE" ? ["The connection is disabled."] : []),
        ...(r.template.status !== "ACTIVE" ? [`The template is ${r.template.status.toLowerCase()}.`] : []),
        ...(v ? checkTemplateForDelivery(v) : ["The template has no version."]),
        ...(v ? getProviderAdapter(r.connection.providerKey).validateMessage({ ...sampleRender(v), providerMetadata: providerMetadataOf(v) }, r.connection.config as Record<string, string | number>) : []),
        ...(r.connection.channelType === "EMAIL" && !publicBaseUrl() ? ["The server has no public address for unsubscribe links (set APP_BASE_URL)."] : []),
      ];
      return {
        id: r.id,
        isActive: r.isActive,
        channelType: r.connection.channelType,
        connection: { id: r.connection.id, code: r.connection.code, name: r.connection.name, providerKey: r.connection.providerKey, providerLabel: def.label, status: r.connection.status, consentPolicy: r.connection.consentPolicy, capabilities: def.capabilities, liveVerified: def.liveVerified, lastTestStatus: r.connection.lastTestStatus },
        template: { id: r.template.id, name: r.template.name, status: r.template.status, versionNumber: v?.versionNumber ?? null },
        problems,
        runs: runs.filter((x) => x.campaignChannelId === r.id).map((x) => ({ ...x, scheduledFor: x.scheduledFor?.toISOString() ?? null, createdAt: x.createdAt.toISOString(), finishedAt: x.finishedAt?.toISOString() ?? null })),
      };
    }),
  };
}

export async function addCampaignChannel(actor: SalesActor, campaignId: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_delivery", "create");
  const input = addChannelSchema.parse(raw);
  const campaign = await loadCampaign(actor, campaignId);
  if (["COMPLETED", "CANCELLED"].includes(campaign.status)) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `The campaign is ${campaign.status.toLowerCase()}.`);
  const conn = await prisma.marketingChannelConnection.findFirst({ where: { id: input.connectionId, companyId: actor.companyId } });
  if (!conn || conn.status !== "ACTIVE") throw new BusinessRuleError("VALIDATION_ERROR", "Choose an active channel connection.", { fieldErrors: { connectionId: "Not active." } });
  const { template } = await loadUsableTemplate(actor.companyId, input.templateId, conn.channelType as MarketingChannelKey);
  try {
    return await prisma.$transaction(async (tx) => {
      const row = await tx.marketingCampaignChannel.create({ data: { companyId: actor.companyId, campaignId: campaign.id, connectionId: conn.id, templateId: template.id, createdByUserId: actor.userId } });
      await auditDelivery(tx, actor, CAMPAIGN_CHANNELS_TABLE, row.id, "CREATE", null, { campaignId: campaign.id, connectionId: conn.id, templateId: template.id });
      await recordDeliveryCampaignEvent(tx, actor, campaign.id, "CHANNEL_ADDED", null, { campaignChannelId: row.id, connection: conn.code, template: template.name });
      return row;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new BusinessRuleError("VALIDATION_ERROR", "This connection and template are already set up for the campaign.");
    throw e;
  }
}

export async function setCampaignChannelActive(actor: SalesActor, id: string, isActive: boolean) {
  await PermissionService.assert(actor.userId, "marketing_delivery", "edit");
  const { ch, campaign } = await loadCampaignChannel(actor, id);
  if (!isActive && (await prisma.marketingDeliveryRun.count({ where: { campaignChannelId: ch.id, status: { in: OPEN_RUN_STATUSES } } }))) throw new BusinessRuleError("REFERENCED_RECORD_IN_USE", "A run of this channel is scheduled or sending. Cancel it first.");
  await prisma.$transaction(async (tx) => {
    await tx.marketingCampaignChannel.update({ where: { id: ch.id }, data: { isActive } });
    await auditDelivery(tx, actor, CAMPAIGN_CHANNELS_TABLE, ch.id, "UPDATE", { isActive: ch.isActive }, { isActive });
    await recordDeliveryCampaignEvent(tx, actor, campaign.id, isActive ? "CHANNEL_ENABLED" : "CHANNEL_DISABLED", null, { campaignChannelId: ch.id });
  });
  return { id: ch.id, isActive };
}

// ── Eligibility preview ───────────────────────────────────────────

/** Counts only — who would be sent now, and why the rest wouldn't. Writes nothing. */
export async function previewEligibility(actor: SalesActor, campaignChannelId: string) {
  await PermissionService.assert(actor.userId, "marketing_delivery", "view");
  const { ch, campaign } = await loadCampaignChannel(actor, campaignChannelId);
  const audience = await resolveCampaignAudience(actor.companyId, campaign.id);
  const adapter = getProviderAdapter(ch.connection.providerKey);
  const reasons: Record<string, number> = {};
  let eligible = 0;
  const seen = new Set<string>();
  for (let i = 0; i < audience.contactIds.length; i += 1000) {
    const rows = markDuplicateAddresses(await checkContacts(actor.companyId, audience.contactIds.slice(i, i + 1000), ch.connection.channelType as MarketingChannelKey, adapter, ch.connection.config as Record<string, string | number>, ch.connection.consentPolicy as ConsentPolicyKey), seen);
    for (const r of rows) {
      if (r.ok) eligible += 1;
      else reasons[r.reason!] = (reasons[r.reason!] ?? 0) + 1;
    }
  }
  return {
    computedAt: new Date().toISOString(),
    segments: audience.segments,
    audience: audience.contactIds.length,
    removedByExclusions: audience.removedByExclusions,
    eligible,
    skipped: reasons,
    consentPolicy: ch.connection.consentPolicy,
  };
}

// ── Test send ─────────────────────────────────────────────────────

const testSends = new Map<string, number[]>();
const TEST_SENDS_PER_MINUTE = 5;

/**
 * Sends one message with sample data, marked [TEST], to an address the user
 * types. Not a delivery: nothing is stored except the audit row; counts never
 * include it.
 */
export async function sendTestMessage(actor: SalesActor, campaignChannelId: string, raw: unknown, deps: ProviderDeps = defaultProviderDeps) {
  await PermissionService.assert(actor.userId, "marketing_delivery", "create");
  const input = testSendSchema.parse(raw);
  const now = Date.now();
  const recent = (testSends.get(actor.userId) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= TEST_SENDS_PER_MINUTE) throw new BusinessRuleError("RATE_LIMITED", "Too many test messages. Wait a minute.");
  testSends.set(actor.userId, [...recent, now]);
  const { ch, campaign } = await loadCampaignChannel(actor, campaignChannelId);
  if (ch.connection.status !== "ACTIVE") throw new BusinessRuleError("VALIDATION_ERROR", "The connection is disabled.");
  const adapter = getProviderAdapter(ch.connection.providerKey);
  const config = ch.connection.config as Record<string, string | number>;
  const to = adapter.normalizeDestination(input.to, config);
  if (!to) throw new BusinessRuleError("VALIDATION_ERROR", ch.connection.channelType === "EMAIL" ? "Enter a valid email address." : "Enter the number with its country code, e.g. +91 98100 12345.", { fieldErrors: { to: "Not valid." } });
  const { version } = await loadUsableTemplate(actor.companyId, ch.templateId, ch.connection.channelType as MarketingChannelKey);
  const rendered = sampleRender(version);
  const msg = {
    deliveryId: randomUUID(),
    to,
    toName: null,
    subject: rendered.subject ? `[TEST] ${rendered.subject}` : null,
    body: ch.connection.channelType === "EMAIL" ? `[TEST — sample data, not a campaign message]\n\n${rendered.body}` : rendered.body,
    parameters: rendered.parameters,
    providerMetadata: providerMetadataOf(version),
    unsubscribeUrl: null,
    tag: `${campaign.code}-TEST`,
  };
  const problems = adapter.validateMessage(msg, config);
  if (problems.length) throw new BusinessRuleError("VALIDATION_ERROR", problems.join(" "));
  const outcome = await adapter.send(runtimeOf(ch.connection), msg, deps);
  await auditDelivery(prisma, actor, CAMPAIGN_CHANNELS_TABLE, ch.id, "UPDATE", null, { testSend: outcome.kind, code: "code" in outcome ? outcome.code : null });
  if (outcome.kind === "ACCEPTED") return { ok: true, message: "The provider accepted the test message. Check the inbox / phone — acceptance isn't proof of delivery." };
  return { ok: false, message: outcome.message };
}

// ── Runs ──────────────────────────────────────────────────────────

/** Creates a run (PREPARING). The caller enqueues `run.prepare`. Idempotent per key. */
export async function startRun(actor: SalesActor, campaignChannelId: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_delivery", "create");
  const input = startRunSchema.parse(raw);
  if (input.idempotencyKey) {
    const prior = await prisma.marketingDeliveryRun.findFirst({ where: { companyId: actor.companyId, idempotencyKey: input.idempotencyKey } });
    if (prior) return { run: prior, created: false };
  }
  const { ch, campaign } = await loadCampaignChannel(actor, campaignChannelId);
  if (campaign.status !== "ACTIVE") throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Only an active campaign can send. This one is ${campaign.status.toLowerCase().replace("_", " ")}.`);
  if (!ch.isActive) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This campaign channel is disabled.");
  const conn = ch.connection;
  if (conn.status !== "ACTIVE") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "The channel connection is disabled.");
  const channel = conn.channelType as MarketingChannelKey;
  const { template, version } = await loadUsableTemplate(actor.companyId, ch.templateId, channel);
  const problems = [...checkTemplateForDelivery(version), ...getProviderAdapter(conn.providerKey).validateMessage({ ...sampleRender(version), providerMetadata: providerMetadataOf(version) }, conn.config as Record<string, string | number>)];
  if (channel === "EMAIL" && !publicBaseUrl()) problems.push("The server has no public address for unsubscribe links. Set APP_BASE_URL (or NEXTAUTH_URL) to the app's public URL.");
  if (problems.length) throw new BusinessRuleError("VALIDATION_ERROR", problems.join(" "));
  let scheduledFor: Date | null = null;
  if (input.scheduledFor) {
    if (!process.env.REDIS_URL) throw new BusinessRuleError("VALIDATION_ERROR", "Scheduling needs the background worker (Redis), which isn't configured on this server. Send now instead, or ask an administrator to set it up.");
    scheduledFor = new Date(input.scheduledFor);
    const now = Date.now();
    if (scheduledFor.getTime() < now + 60_000) throw new BusinessRuleError("VALIDATION_ERROR", "Schedule at least a minute ahead, or send now.", { fieldErrors: { scheduledFor: "In the past." } });
    if (scheduledFor.getTime() > now + MAX_SCHEDULE_DAYS * 86_400_000) throw new BusinessRuleError("VALIDATION_ERROR", `Schedule within ${MAX_SCHEDULE_DAYS} days.`, { fieldErrors: { scheduledFor: "Too far ahead." } });
  }
  const audience = await resolveCampaignAudience(actor.companyId, campaign.id);
  if (!audience.contactIds.length) throw new BusinessRuleError("VALIDATION_ERROR", "The campaign audience is empty.");
  try {
    const run = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM marketing_campaigns WHERE id = ${campaign.id}::uuid FOR UPDATE`;
      const last = await tx.marketingDeliveryRun.findFirst({ where: { campaignId: campaign.id }, orderBy: { runNumber: "desc" }, select: { runNumber: true } });
      const r = await tx.marketingDeliveryRun.create({
        data: {
          companyId: actor.companyId,
          campaignId: campaign.id,
          campaignChannelId: ch.id,
          connectionId: conn.id,
          runNumber: (last?.runNumber ?? 0) + 1,
          channelType: conn.channelType,
          providerKey: conn.providerKey,
          templateId: template.id,
          templateVersionId: version.id,
          audienceJson: { segments: audience.segments, includedTotal: audience.includedTotal, removedByExclusions: audience.removedByExclusions } as unknown as Prisma.InputJsonValue,
          scheduledFor,
          idempotencyKey: input.idempotencyKey ?? null,
          initiatedByUserId: actor.userId,
          plannedCount: audience.contactIds.length,
        },
      });
      await auditDelivery(tx, actor, RUNS_TABLE, r.id, "CREATE", null, { campaignId: campaign.id, runNumber: r.runNumber, connection: conn.code, templateId: template.id, templateVersion: version.versionNumber, scheduledFor, audience: audience.segments.map((s) => ({ segment: s.code, role: s.role, evaluationId: s.evaluationId })) });
      await recordDeliveryCampaignEvent(tx, actor, campaign.id, scheduledFor ? "DELIVERY_RUN_SCHEDULED" : "DELIVERY_RUN_REQUESTED", null, { runId: r.id, runNumber: r.runNumber, connection: conn.code, scheduledFor: scheduledFor?.toISOString() ?? null, audience: audience.contactIds.length });
      return r;
    });
    return { run, created: true };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      if (input.idempotencyKey) {
        const prior = await prisma.marketingDeliveryRun.findFirst({ where: { companyId: actor.companyId, idempotencyKey: input.idempotencyKey } });
        if (prior) return { run: prior, created: false };
      }
      throw new BusinessRuleError("REQUEST_IN_PROGRESS", "This channel already has a run scheduled or sending. Wait for it to finish or cancel it.");
    }
    throw e;
  }
}

/**
 * Cancels what hasn't been sent. A scheduled / queued run is cancelled at once;
 * a preparing or sending run stops at the next recipient (messages already
 * handed to the provider are not recalled — providers don't support that).
 */
export async function cancelRun(actor: SalesActor, id: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_delivery", "cancel");
  const input = cancelSchema.parse(raw);
  const { run, campaign } = await loadRun(actor, id);
  if (!OPEN_RUN_STATUSES.includes(run.status as RunStatusKey)) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `The run is ${run.status.toLowerCase()} and can't be cancelled.`);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const res = await tx.marketingDeliveryRun.updateMany({ where: { id: run.id, status: { in: OPEN_RUN_STATUSES }, cancelRequestedAt: null }, data: { cancelRequestedAt: now, cancelledByUserId: actor.userId, cancelReason: input.reason } });
    if (res.count === 0) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "The run already finished or is being cancelled.");
    // Not being worked on right now (no lease): finish the cancellation here.
    const idle = await tx.marketingDeliveryRun.updateMany({ where: { id: run.id, status: { in: ["SCHEDULED", "QUEUED"] }, lockToken: null }, data: { status: "CANCELLED", finishedAt: now, nextDispatchAt: null } });
    if (idle.count) await tx.marketingDelivery.updateMany({ where: { runId: run.id, status: "PENDING" }, data: { status: "CANCELLED", statusAt: now, nextAttemptAt: null } });
    await auditDelivery(tx, actor, RUNS_TABLE, run.id, "UPDATE", { status: run.status }, { cancelRequested: true, reason: input.reason });
    await recordDeliveryCampaignEvent(tx, actor, campaign.id, "DELIVERY_RUN_CANCEL_REQUESTED", input.reason, { runId: run.id, runNumber: run.runNumber });
  });
  return getRun(actor, run.id);
}

/**
 * Resumes a finished / stopped run: recipients that failed only because we
 * gave up retrying (RETRIES_EXHAUSTED) or were never sent (left PENDING by a
 * stop) go again. Definite rejections and unknown outcomes are not resent.
 */
export async function resumeRun(actor: SalesActor, id: string) {
  await PermissionService.assert(actor.userId, "marketing_delivery", "edit");
  const { run, campaign } = await loadRun(actor, id);
  if (!["COMPLETED", "PARTIALLY_COMPLETED", "FAILED"].includes(run.status)) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `A ${run.status.toLowerCase()} run can't be resumed.`);
  if (campaign.status !== "ACTIVE") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Only an active campaign can send.");
  if (!run.preparedAt) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This run never got its recipient list. Start a new run.");
  const now = new Date();
  try {
    return await prisma.$transaction(async (tx) => {
      const reset = await tx.marketingDelivery.updateMany({ where: { runId: run.id, status: "FAILED", errorCode: "RETRIES_EXHAUSTED" }, data: { status: "PENDING", attempts: 0, nextAttemptAt: null, statusAt: now } });
      const pending = await tx.marketingDelivery.count({ where: { runId: run.id, status: "PENDING" } });
      if (!pending) throw new BusinessRuleError("VALIDATION_ERROR", "Nothing to resend: every recipient was sent, definitely refused, skipped, or has an unknown outcome (resolve those separately).");
      const res = await tx.marketingDeliveryRun.updateMany({ where: { id: run.id, status: run.status }, data: { status: "QUEUED", nextDispatchAt: now, finishedAt: null, error: null, cancelRequestedAt: null } });
      if (res.count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "The run changed meanwhile. Reload.");
      await auditDelivery(tx, actor, RUNS_TABLE, run.id, "UPDATE", { status: run.status }, { status: "QUEUED", resumed: true, resent: reset.count, pending });
      await recordDeliveryCampaignEvent(tx, actor, campaign.id, "DELIVERY_RUN_RESUMED", null, { runId: run.id, runNumber: run.runNumber, pending });
      return { id: run.id, pending };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new BusinessRuleError("REQUEST_IN_PROGRESS", "Another run of this channel is scheduled or sending.");
    throw e;
  }
}

/**
 * Settles UNKNOWN outcomes by hand. MARK_FAILED closes them. RESEND puts them
 * back in the queue — only with an explicit acknowledgement, because the
 * provider may already have delivered the first attempt.
 */
export async function resolveUnknown(actor: SalesActor, id: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_delivery", "edit");
  const input = resolveUnknownSchema.parse(raw);
  const { run, campaign } = await loadRun(actor, id);
  if (OPEN_RUN_STATUSES.includes(run.status as RunStatusKey)) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Wait until the run stops sending.");
  if (input.resolution === "RESEND" && !input.acknowledgeDuplicateRisk) throw new BusinessRuleError("VALIDATION_ERROR", "Confirm that resending may give some people the message twice.");
  if (input.resolution === "RESEND" && campaign.status !== "ACTIVE") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Only an active campaign can send.");
  const where = { runId: run.id, status: "UNKNOWN" as const, ...(input.deliveryIds ? { id: { in: input.deliveryIds } } : {}) };
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const res =
      input.resolution === "MARK_FAILED"
        ? await tx.marketingDelivery.updateMany({ where, data: { status: "FAILED", errorCode: "UNKNOWN_CLOSED", errorMessage: `Closed by hand: ${input.reason}`.slice(0, 300), failedAt: now, statusAt: now } })
        : await tx.marketingDelivery.updateMany({ where, data: { status: "PENDING", attempts: 0, nextAttemptAt: null, errorCode: null, errorMessage: null, statusAt: now } });
    if (res.count === 0) throw new BusinessRuleError("VALIDATION_ERROR", "No unknown outcomes to resolve.");
    if (input.resolution === "RESEND") {
      const r = await tx.marketingDeliveryRun.updateMany({ where: { id: run.id, status: run.status }, data: { status: "QUEUED", nextDispatchAt: now, finishedAt: null, error: null } });
      if (r.count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "The run changed meanwhile. Reload.");
    }
    await auditDelivery(tx, actor, RUNS_TABLE, run.id, "UPDATE", null, { unknownResolved: input.resolution, count: res.count, reason: input.reason });
    await recordDeliveryCampaignEvent(tx, actor, campaign.id, input.resolution === "RESEND" ? "DELIVERY_UNKNOWN_RESENT" : "DELIVERY_UNKNOWN_CLOSED", input.reason, { runId: run.id, count: res.count });
    return { id: run.id, resolved: res.count, requeued: input.resolution === "RESEND" };
  });
}

// ── Reads ─────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** "A,B" → the known keys only (an unknown value matches nothing rather than erroring). */
const pickKeys = (raw: string, known: Record<string, unknown>) => raw.split(",").map((x) => x.trim()).filter((x) => x in known);

function presentRun<E extends Record<string, unknown> = Record<never, never>>(run: Awaited<ReturnType<typeof loadRun>>["run"], extra: E = {} as E) {
  return {
    id: run.id,
    campaignId: run.campaignId,
    campaignChannelId: run.campaignChannelId,
    runNumber: run.runNumber,
    channelType: run.channelType,
    providerKey: run.providerKey,
    providerLabel: MARKETING_PROVIDERS[run.providerKey].label,
    status: run.status,
    scheduledFor: run.scheduledFor?.toISOString() ?? null,
    timezone: run.timezone,
    plannedCount: run.plannedCount,
    exclusionSummary: run.exclusionSummary as Record<string, number>,
    audience: run.audienceJson,
    cancelRequestedAt: run.cancelRequestedAt?.toISOString() ?? null,
    cancelReason: run.cancelReason,
    preparedAt: run.preparedAt?.toISOString() ?? null,
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    nextDispatchAt: run.nextDispatchAt?.toISOString() ?? null,
    error: run.error,
    createdAt: run.createdAt.toISOString(),
    ...extra,
  };
}

export async function getRun(actor: SalesActor, id: string) {
  await PermissionService.assert(actor.userId, "marketing_delivery", "view");
  const { run, campaign } = await loadRun(actor, id);
  const [counts, extras] = await Promise.all([
    runOutcomeCounts(run.id),
    prisma.marketingDeliveryRun.findUniqueOrThrow({
      where: { id: run.id },
      select: { connection: { select: { id: true, code: true, name: true } }, template: { select: { id: true, name: true } }, templateVersion: { select: { versionNumber: true } }, initiatedBy: { select: { fullName: true } } },
    }),
  ]);
  const errors = await prisma.marketingDelivery.groupBy({ by: ["errorCode"], where: { runId: run.id, status: { in: ["FAILED", "BOUNCED", "REJECTED", "UNKNOWN"] } }, _count: { _all: true } });
  return presentRun(run, {
    campaign: { id: campaign.id, code: campaign.code, name: campaign.name, status: campaign.status },
    connection: extras.connection,
    template: { ...extras.template, versionNumber: extras.templateVersion.versionNumber },
    initiatedBy: extras.initiatedBy.fullName,
    counts,
    errorSummary: errors.map((e) => ({ code: e.errorCode ?? "UNSPECIFIED", count: e._count._all })).sort((a, b) => b.count - a.count),
    capabilities: MARKETING_PROVIDERS[run.providerKey].capabilities,
  });
}

export async function listRuns(actor: SalesActor, filter: { status?: string; campaignId?: string }, page = 1, pageSize = 25) {
  await PermissionService.assert(actor.userId, "marketing_delivery", "view");
  const scope = await getCampaignScope(actor);
  const where: Prisma.MarketingDeliveryRunWhereInput = {
    companyId: actor.companyId,
    ...(filter.status ? { status: { in: pickKeys(filter.status, RUN_STATUSES) as never } } : {}),
    ...(filter.campaignId && UUID.test(filter.campaignId) ? { campaignId: filter.campaignId } : {}),
    // Same visibility as the campaign itself, in one query.
    campaign: campaignScopeWhere(actor, scope),
  };
  const [total, rows] = await Promise.all([
    prisma.marketingDeliveryRun.count({ where }),
    prisma.marketingDeliveryRun.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, include: { campaign: { select: { code: true, name: true } }, connection: { select: { name: true } } } }),
  ]);
  const counts = await Promise.all(rows.map((r) => runOutcomeCounts(r.id)));
  return {
    data: rows.map((r, i) => ({ ...presentRun(r), campaign: r.campaign, connectionName: r.connection.name, counts: counts[i] })),
    meta: { page, pageSize, totalCount: total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

const maskAddress = (v: string | null) => (v ? (v.includes("@") ? v.replace(/^(.{1,2}).*(@.*)$/, "$1•••$2") : v.replace(/^(\d{2,4})\d*(\d{3})$/, "$1•••$2")) : null);

/** Recipients of a run. Full addresses and provider ids need marketing_delivery.view_all. */
export async function listRunDeliveries(actor: SalesActor, id: string, filter: { status?: string }, page = 1, pageSize = 50) {
  await PermissionService.assert(actor.userId, "marketing_delivery", "view");
  const { run } = await loadRun(actor, id);
  const full = await PermissionService.can(actor.userId, "marketing_delivery", "view_all");
  const where: Prisma.MarketingDeliveryWhereInput = { runId: run.id, ...(filter.status ? { status: { in: pickKeys(filter.status, DELIVERY_STATUSES) as never } } : {}) };
  const [total, rows] = await Promise.all([
    prisma.marketingDelivery.count({ where }),
    prisma.marketingDelivery.findMany({ where, orderBy: { id: "asc" }, skip: (page - 1) * pageSize, take: pageSize, include: { contact: { select: { fullName: true } } } }),
  ]);
  return {
    data: rows.map((d) => ({
      id: d.id,
      contactId: d.contactId,
      contactName: d.contact.fullName,
      destination: full ? d.destination : maskAddress(d.destination),
      status: d.status,
      skipReason: d.skipReason,
      attempts: d.attempts,
      lastAttemptAt: d.lastAttemptAt?.toISOString() ?? null,
      nextAttemptAt: d.nextAttemptAt?.toISOString() ?? null,
      providerMessageId: full ? d.providerMessageId : d.providerMessageId ? "•••" : null,
      providerStatus: d.providerStatus,
      errorCode: d.errorCode,
      errorMessage: d.errorMessage,
      statusAt: d.statusAt?.toISOString() ?? null,
    })),
    meta: { page, pageSize, totalCount: total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    fullDetails: full,
  };
}

export async function listDeliveryEvents(actor: SalesActor, runId: string, deliveryId: string) {
  await PermissionService.assert(actor.userId, "marketing_delivery", "view");
  const { run } = await loadRun(actor, runId);
  const d = await prisma.marketingDelivery.findFirst({ where: { id: deliveryId, runId: run.id }, select: { id: true } });
  if (!d) throw new BusinessRuleError("NOT_FOUND", "Recipient not found.");
  const full = await PermissionService.can(actor.userId, "marketing_delivery", "view_all");
  const events = await prisma.marketingDeliveryEvent.findMany({ where: { deliveryId: d.id }, orderBy: [{ occurredAt: "asc" }, { receivedAt: "asc" }], take: 200 });
  return events.map((e) => ({ id: e.id, source: e.source, eventType: e.eventType, normalizedStatus: e.normalizedStatus, occurredAt: e.occurredAt.toISOString(), receivedAt: e.receivedAt.toISOString(), result: e.result, errorCode: e.errorCode, detail: e.detail, providerMessageId: full ? e.providerMessageId : null }));
}

/** Choices for adding a channel to a campaign: active connections (no settings) and active templates per channel. */
export async function channelSetupOptions(actor: SalesActor) {
  await PermissionService.assert(actor.userId, "marketing_delivery", "create");
  const [connections, templates] = await Promise.all([
    prisma.marketingChannelConnection.findMany({ where: { companyId: actor.companyId, status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, code: true, name: true, channelType: true, providerKey: true, lastTestStatus: true } }),
    prisma.crmMessageTemplate.findMany({ where: { companyId: actor.companyId, status: "ACTIVE", channelType: { in: ["EMAIL", "SMS", "WHATSAPP"] }, currentVersionId: { not: null } }, orderBy: { name: "asc" }, select: { id: true, name: true, channelType: true } }),
  ]);
  return {
    connections: connections.map((c) => ({ ...c, providerLabel: MARKETING_PROVIDERS[c.providerKey].label, liveVerified: MARKETING_PROVIDERS[c.providerKey].liveVerified })),
    templates,
  };
}
