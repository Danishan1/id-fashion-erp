import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/core/db/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { todayIsoDate } from "@/lib/date";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { allocateMoney, eligibleTouches, weightsFor, windowStart, type Rules, type Touch } from "./attribution-math";
import { rulesOf } from "./attribution-model.service";
import { MAX_RUN_DAYS } from "./attribution-registry";
import { syncAttributionSources } from "./attribution-sync.service";

/**
 * Attribution runs (Phase 13): one approved model version over a period of
 * conversion dates. A run first syncs the sources, then writes one result per
 * conversion and one credit per eligible touch, in batches. Results are never
 * updated (DB trigger) — a recalculation is a new run; reports read each
 * model's newest completed run of its current version. One queued / running
 * run per model version (partial unique index); a run is claimed with a
 * guarded status change, so a retried job can't run it twice.
 */

const BATCH = 400;
const KEEP_COMPLETED_RUNS = 3;
const DAY_MS = 86_400_000;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
export const runRequestSchema = z.object({ from: isoDate, to: isoDate, idempotencyKey: z.string().trim().min(8).max(100).optional() }).strict();

const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** Queues a calculation. Returns the run and whether it was created now (false = same idempotency key). */
export async function requestRun(actor: SalesActor, modelId: string, raw: unknown, trigger: "MANUAL" | "SCHEDULED" = "MANUAL") {
  if (trigger === "MANUAL") await PermissionService.assert(actor.userId, "marketing_attribution", "edit");
  const input = runRequestSchema.parse(raw);
  if (input.to < input.from) throw new BusinessRuleError("VALIDATION_ERROR", "The period ends before it starts.", { fieldErrors: { to: "Before the start." } });
  if (days(input.from, input.to) > MAX_RUN_DAYS) throw new BusinessRuleError("VALIDATION_ERROR", `A run covers at most ${MAX_RUN_DAYS} days.`, { fieldErrors: { from: "Too long." } });
  if (input.to > todayIsoDate()) throw new BusinessRuleError("VALIDATION_ERROR", "The period can't end in the future.", { fieldErrors: { to: "In the future." } });
  const m = await prisma.marketingAttributionModel.findFirst({ where: { id: modelId, companyId: actor.companyId } });
  if (!m) throw new BusinessRuleError("NOT_FOUND", "Attribution model not found.", { id: modelId });
  if (m.status !== "ACTIVE" || !m.approvedVersionId) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Only a model with approved rules that isn't retired can be calculated.");
  if (input.idempotencyKey) {
    const existing = await prisma.marketingAttributionRun.findFirst({ where: { companyId: actor.companyId, idempotencyKey: input.idempotencyKey } });
    if (existing) return { run: existing, created: false };
  }
  try {
    const run = await prisma.$transaction(async (tx) => {
      const r = await tx.marketingAttributionRun.create({
        data: { companyId: actor.companyId, modelId: m.id, modelVersionId: m.approvedVersionId!, periodFrom: new Date(`${input.from}T00:00:00Z`), periodTo: new Date(`${input.to}T00:00:00Z`), trigger, requestedByUserId: trigger === "MANUAL" ? actor.userId : null, idempotencyKey: input.idempotencyKey ?? null },
      });
      if (trigger === "MANUAL") {
        await tx.salesPerformanceEvent.create({ data: { companyId: actor.companyId, entityType: "ATTRIBUTION_MODEL", entityId: m.id, type: "RECALCULATION_REQUESTED", metadata: { runId: r.id, from: input.from, to: input.to }, createdByUserId: actor.userId } });
        await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "marketing_attribution_runs", recordId: r.id, action: "CREATE", newValues: { modelId: m.id, modelVersionId: m.approvedVersionId, from: input.from, to: input.to } }, tx);
      }
      return r;
    });
    return { run, created: true };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      if (input.idempotencyKey) {
        const existing = await prisma.marketingAttributionRun.findFirst({ where: { companyId: actor.companyId, idempotencyKey: input.idempotencyKey } });
        if (existing) return { run: existing, created: false };
      }
      throw new BusinessRuleError("INVALID_STATE_TRANSITION", "A calculation of this model is already queued or running. Wait for it to finish.");
    }
    throw e;
  }
}

interface ConversionRow {
  id: string;
  conversionType: string;
  status: string;
  statusReason: string | null;
  occurredAt: Date;
  identityKeys: string[];
  quotedValue: Prisma.Decimal | null;
  orderValue: Prisma.Decimal | null;
  invoicedValue: Prisma.Decimal | null;
}

/** Results + credits of one batch, computed in memory (pure apart from the touch query). */
export function attributeBatch(conversions: ConversionRow[], touches: Touch[], rules: Rules) {
  const results: Omit<Prisma.MarketingAttributionResultCreateManyInput, "companyId" | "runId">[] = [];
  const credits: (Omit<Prisma.MarketingAttributionCreditCreateManyInput, "companyId" | "runId" | "resultId"> & { resultKey: string })[] = [];
  const quality = { noIdentity: 0, noValue: 0, unreconciled: 0 };
  for (const c of conversions) {
    const id = crypto.randomUUID();
    const base = { id, conversionId: c.id, conversionAt: c.occurredAt, windowStart: windowStart(c.occurredAt, rules.windowDays), quotedValue: c.quotedValue, orderValue: c.orderValue, invoicedValue: c.invoicedValue };
    if (c.status !== "ACTIVE") {
      results.push({ ...base, status: "EXCLUDED", reason: c.statusReason ?? c.status, touchpointCount: 0 });
      continue;
    }
    if (c.identityKeys.length <= 1) quality.noIdentity++; // only its own record: only a campaign set on that record can count
    if (c.conversionType === "SALES_ORDER_BOOKED" && (!c.orderValue || c.orderValue.isZero())) quality.noValue++;
    const eligible = eligibleTouches(touches, { at: c.occurredAt, identityKeys: c.identityKeys }, rules);
    if (!eligible.length) {
      results.push({ ...base, status: "UNATTRIBUTED", reason: "No eligible touch in the window.", touchpointCount: 0 });
      continue;
    }
    const w = weightsFor(eligible, c.occurredAt, rules);
    const split = (v: Prisma.Decimal | null) => (v === null ? null : allocateMoney(v, w));
    const [q, o, i] = [split(c.quotedValue), split(c.orderValue), split(c.invoicedValue)];
    // Reconciliation checks (written into the run summary; expected to stay 0).
    const sum = (a: Prisma.Decimal[]) => a.reduce((s, x) => s.add(x), new Prisma.Decimal(0));
    if (!sum(w).eq(1) || (q && !sum(q).eq(c.quotedValue!)) || (o && !sum(o).eq(c.orderValue!)) || (i && !sum(i).eq(c.invoicedValue!))) quality.unreconciled++;
    let written = 0;
    eligible.forEach((t, k) => {
      if (w[k].isZero()) return; // e.g. middle touches when first + last take 100%
      written++;
      credits.push({ resultKey: id, touchpointId: t.id, campaignId: t.campaignId, touchpointType: t.touchpointType, channelType: t.channelType, position: k + 1, weight: w[k], quotedCredit: q?.[k] ?? null, orderCredit: o?.[k] ?? null, invoicedCredit: i?.[k] ?? null });
    });
    results.push({ ...base, status: "ATTRIBUTED", reason: null, touchpointCount: written });
  }
  return { results, credits, quality };
}

/** Runs a queued calculation. Returns false when the run wasn't QUEUED (someone else has it). */
export async function executeRun(runId: string) {
  const claim = await prisma.marketingAttributionRun.updateMany({ where: { id: runId, status: "QUEUED" }, data: { status: "RUNNING", startedAt: new Date() } });
  if (claim.count === 0) return false;
  const run = await prisma.marketingAttributionRun.findUniqueOrThrow({ where: { id: runId }, include: { modelVersion: true } });
  try {
    const sync = await syncAttributionSources(run.companyId);
    // The data cut: records changed after this moment aren't in the run ("out of date" afterwards).
    await prisma.marketingAttributionRun.update({ where: { id: run.id }, data: { sourcesSyncedAt: new Date() } });
    const rules = rulesOf(run.modelVersion);
    const counts = { conversions: 0, attributed: 0, unattributed: 0, excluded: 0 };
    const quality = { noIdentity: 0, noValue: 0, unreconciled: 0, credits: 0 };
    let cursor: string | null = null;
    for (;;) {
      const conversions: ConversionRow[] = await prisma.marketingConversion.findMany({
        where: { companyId: run.companyId, conversionType: { in: rules.conversionTypes }, businessDate: { gte: run.periodFrom, lte: run.periodTo }, ...(cursor ? { id: { gt: cursor } } : {}) },
        orderBy: { id: "asc" },
        take: BATCH,
        select: { id: true, conversionType: true, status: true, statusReason: true, occurredAt: true, identityKeys: true, quotedValue: true, orderValue: true, invoicedValue: true },
      });
      if (!conversions.length) break;
      cursor = conversions.at(-1)!.id;
      const allKeys = [...new Set(conversions.flatMap((c) => c.identityKeys))];
      const earliest = new Date(Math.min(...conversions.map((c) => windowStart(c.occurredAt, rules.windowDays).getTime())));
      const latest = new Date(Math.max(...conversions.map((c) => c.occurredAt.getTime())));
      const touches = allKeys.length
        ? ((await prisma.marketingTouchpoint.findMany({
            where: { companyId: run.companyId, status: "VALID", identityKeys: { hasSome: allKeys }, occurredAt: { gte: earliest, lte: latest } },
            select: { id: true, campaignId: true, touchpointType: true, channelType: true, occurredAt: true, identityKeys: true, status: true },
          })) as Touch[])
        : [];
      const out = attributeBatch(conversions, touches, rules);
      await prisma.$transaction(async (tx) => {
        await tx.marketingAttributionResult.createMany({ data: out.results.map((r) => ({ ...r, companyId: run.companyId, runId: run.id })) });
        if (out.credits.length) await tx.marketingAttributionCredit.createMany({ data: out.credits.map(({ resultKey, ...c }) => ({ ...c, companyId: run.companyId, runId: run.id, resultId: resultKey })) });
      });
      counts.conversions += out.results.length;
      for (const r of out.results) counts[r.status === "ATTRIBUTED" ? "attributed" : r.status === "UNATTRIBUTED" ? "unattributed" : "excluded"]++;
      quality.noIdentity += out.quality.noIdentity;
      quality.noValue += out.quality.noValue;
      quality.unreconciled += out.quality.unreconciled;
      quality.credits += out.credits.length;
    }
    await prisma.marketingAttributionRun.update({
      where: { id: run.id },
      data: { status: "COMPLETED", finishedAt: new Date(), ...counts, summary: { ...quality, sync: sync.sources } as Prisma.InputJsonValue },
    });
    await purgeOldRuns(run.modelVersionId);
    return true;
  } catch (e) {
    // A failed run leaves no partial results behind; reports keep using the previous completed run.
    await prisma.marketingAttributionResult.deleteMany({ where: { runId: run.id } });
    await prisma.marketingAttributionRun.update({ where: { id: run.id }, data: { status: "FAILED", finishedAt: new Date(), error: (e as Error).message.slice(0, 1000) } });
    return false;
  }
}

/** Retention: the newest few completed runs of a model version keep their results; older ones keep only their totals. */
export async function purgeOldRuns(modelVersionId: string, keep = KEEP_COMPLETED_RUNS) {
  const old = await prisma.marketingAttributionRun.findMany({ where: { modelVersionId, status: "COMPLETED" }, orderBy: { finishedAt: "desc" }, skip: keep, select: { id: true } });
  for (const r of old) {
    await prisma.$transaction([
      prisma.marketingAttributionResult.deleteMany({ where: { runId: r.id } }),
      prisma.marketingAttributionRun.update({ where: { id: r.id }, data: { status: "PURGED", resultsPurgedAt: new Date() } }),
    ]);
  }
  return old.length;
}

/** Runs stuck in RUNNING (worker died) are failed so a new one can start; queued runs whose job got lost are returned for re-queueing. */
export async function recoverRuns(now = new Date()) {
  const stuck = await prisma.marketingAttributionRun.findMany({ where: { status: "RUNNING", startedAt: { lt: new Date(now.getTime() - 60 * 60_000) } }, select: { id: true } });
  for (const r of stuck) {
    await prisma.marketingAttributionResult.deleteMany({ where: { runId: r.id } });
    await prisma.marketingAttributionRun.updateMany({ where: { id: r.id, status: "RUNNING" }, data: { status: "FAILED", finishedAt: now, error: "Stopped without finishing (worker restarted?). Start the calculation again." } });
  }
  const lost = await prisma.marketingAttributionRun.findMany({ where: { status: "QUEUED", queuedAt: { lt: new Date(now.getTime() - 10 * 60_000) } }, select: { id: true }, take: 50 });
  return { failed: stuck.length, queued: lost.map((r) => r.id) };
}

/**
 * Nightly: for every model in use, recalculate the last 365 days (a new run,
 * so late events, corrections and reversals are picked up). Skipped when a
 * run is already queued / running. Returns the new run ids.
 */
export async function queueScheduledRuns() {
  const models = await prisma.marketingAttributionModel.findMany({ where: { status: "ACTIVE", approvedVersionId: { not: null } }, select: { id: true, companyId: true, ownerUserId: true } });
  const to = todayIsoDate();
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - 365 * DAY_MS).toISOString().slice(0, 10);
  const ids: string[] = [];
  for (const m of models) {
    try {
      const { run, created } = await requestRun({ companyId: m.companyId, userId: m.ownerUserId, branchId: null }, m.id, { from, to }, "SCHEDULED");
      if (created) ids.push(run.id);
    } catch (e) {
      if ((e as { code?: string }).code !== "INVALID_STATE_TRANSITION") throw e;
    }
  }
  return ids;
}

/** Changes in the run's period since it started (late events, corrections): shown as "out of date". */
export async function runChangesSince(run: { companyId: string; sourcesSyncedAt: Date | null; periodFrom: Date; periodTo: Date }) {
  const cut = run.sourcesSyncedAt;
  if (!cut) return { conversions: 0, touchpoints: 0 };
  const [conversions, touchpoints] = await Promise.all([
    prisma.marketingConversion.count({ where: { companyId: run.companyId, updatedAt: { gt: cut }, businessDate: { gte: run.periodFrom, lte: run.periodTo } } }),
    prisma.marketingTouchpoint.count({ where: { companyId: run.companyId, updatedAt: { gt: cut }, occurredAt: { lte: new Date(run.periodTo.getTime() + DAY_MS) } } }),
  ]);
  return { conversions, touchpoints };
}
