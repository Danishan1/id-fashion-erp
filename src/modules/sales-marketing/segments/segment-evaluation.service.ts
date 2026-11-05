import { Prisma, type MarketingSegmentEvaluation } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { optionalText } from "@/modules/sales-marketing/performance/performance-common";
import { assertNotArchived, auditSegment, displayRows, loadDisplay, loadSegment, recordSegmentEvent } from "./segment-common";
import { MAX_EVALUATION_RECORDS, MAX_STATIC_MEMBERS, baseWhere, classifyBatch, delegate, getSegmentAccess, type Classified } from "./segment-query";
import { compileDefinition, evaluationView } from "./segment.service";

/**
 * Segment evaluations = membership snapshots (Phase 09, PHASE_09_SEGMENTS.md §5).
 *
 *  - A request creates a QUEUED evaluation pinned to the segment's CURRENT
 *    definition version; a partial unique index allows one queued / running
 *    evaluation per segment (a second request returns the one in progress).
 *  - The worker claims it (QUEUED → RUNNING), walks the candidates in id
 *    batches, classifies each record (included / excluded / ineligible + why)
 *    and writes snapshot entries. Entries are only ever read for COMPLETED
 *    evaluations, so a half-written snapshot can't be mistaken for a real one.
 *  - Finishing locks the segment row: if the definition moved on meanwhile the
 *    run becomes SUPERSEDED (entries dropped); otherwise COMPLETED, and the
 *    segment summary moves forward only if this run is newer than the one it
 *    shows. A failure keeps the previous summary but records the failure.
 *  - Retention: entries of completed snapshots are kept for the newest
 *    RETAIN_SNAPSHOTS per segment plus any snapshot that is kept / pinned by a
 *    campaign; older ones keep their counts but lose their entries.
 */

export const RETAIN_SNAPSHOTS = 5;
const BATCH = 1000;
const STALE_RUNNING_MS = 30 * 60_000;

export const requestEvaluationSchema = z.object({ idempotencyKey: z.string().trim().min(8).max(100).optional(), keep: z.boolean().optional(), label: optionalText(120) }).strict();
export const keepSnapshotSchema = z.object({ keep: z.boolean(), label: optionalText(120) }).strict();

const safeMessage = (e: unknown) => (e instanceof BusinessRuleError ? e.message : "The evaluation failed unexpectedly. Try again; if it keeps failing, contact support.");

/** Request an evaluation (snapshot) of the current definition. Idempotent per key; one active per segment. */
export async function requestSegmentEvaluation(actor: SalesActor, id: string, raw: unknown, trigger: "MANUAL" | "SNAPSHOT" = "MANUAL") {
  await PermissionService.assert(actor.userId, "marketing_segments", "edit");
  const input = requestEvaluationSchema.parse(raw ?? {});
  const seg = await loadSegment(actor, id);
  assertNotArchived(seg);
  await getSegmentAccess(actor.companyId, actor.userId, seg.sourceType);
  if (input.idempotencyKey) {
    const prior = await prisma.marketingSegmentEvaluation.findFirst({ where: { segmentId: seg.id, idempotencyKey: input.idempotencyKey } });
    if (prior) return { evaluation: prior, created: false };
  }
  try {
    const evaluation = await prisma.$transaction(async (tx) => {
      const e = await tx.marketingSegmentEvaluation.create({
        data: {
          companyId: actor.companyId,
          segmentId: seg.id,
          versionNumber: seg.currentVersionNumber,
          trigger: input.keep ? "SNAPSHOT" : trigger,
          runAsUserId: actor.userId,
          requestedByUserId: actor.userId,
          isKept: Boolean(input.keep),
          label: input.label || null,
          idempotencyKey: input.idempotencyKey ?? null,
        },
      });
      await recordSegmentEvent(tx, actor, seg.id, "EVALUATION_REQUESTED", input.label || null, { evaluationId: e.id, versionNumber: e.versionNumber, keep: e.isKept });
      return e;
    });
    return { evaluation, created: true };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const active = await prisma.marketingSegmentEvaluation.findFirst({ where: { segmentId: seg.id, status: { in: ["QUEUED", "RUNNING"] } } });
      if (active) return { evaluation: active, created: false };
      if (input.idempotencyKey) {
        const prior = await prisma.marketingSegmentEvaluation.findFirst({ where: { segmentId: seg.id, idempotencyKey: input.idempotencyKey } });
        if (prior) return { evaluation: prior, created: false };
      }
      throw new BusinessRuleError("REQUEST_IN_PROGRESS", "This segment is already being evaluated. Wait for it to finish.");
    }
    throw e;
  }
}

async function finishFailed(evaluation: Pick<MarketingSegmentEvaluation, "id" | "segmentId" | "companyId" | "runAsUserId">, message: string) {
  await prisma.$transaction(async (tx) => {
    await tx.marketingSegmentSnapshotEntry.deleteMany({ where: { evaluationId: evaluation.id } });
    await tx.marketingSegmentEvaluation.updateMany({ where: { id: evaluation.id, status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "FAILED", error: message.slice(0, 1000), finishedAt: new Date() } });
    await tx.marketingSegment.update({ where: { id: evaluation.segmentId }, data: { lastEvaluationStatus: "FAILED", lastError: message.slice(0, 1000) } });
    await recordSegmentEvent(tx, { companyId: evaluation.companyId, userId: evaluation.runAsUserId }, evaluation.segmentId, "EVALUATION_FAILED", message.slice(0, 500), { evaluationId: evaluation.id });
  });
}

/**
 * Runs one evaluation (worker job `segment.evaluate`). Safe to call twice:
 * only a QUEUED row can be claimed, and a retried RUNNING row (lost worker)
 * is re-claimed after STALE_RUNNING_MS by the recovery sweep.
 */
export async function runSegmentEvaluation(evaluationId: string): Promise<{ status: string; memberCount?: number }> {
  const claimed = await prisma.marketingSegmentEvaluation.updateMany({ where: { id: evaluationId, status: "QUEUED" }, data: { status: "RUNNING", startedAt: new Date(), attempts: { increment: 1 } } });
  if (claimed.count === 0) return { status: "SKIPPED" };
  const evaluation = await prisma.marketingSegmentEvaluation.findUniqueOrThrow({ where: { id: evaluationId } });
  try {
    const seg = await prisma.marketingSegment.findUniqueOrThrow({ where: { id: evaluation.segmentId } });
    if (seg.status === "ARCHIVED") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "The segment was archived.");
    // The run uses the live access of the person it runs as (requester / owner), checked now, not when queued.
    const runAs = await prisma.user.findFirst({ where: { id: evaluation.runAsUserId, companyId: seg.companyId, status: "ACTIVE" }, select: { id: true } });
    if (!runAs || !(await PermissionService.can(runAs.id, "marketing_segments", "view"))) throw new BusinessRuleError("PERMISSION_DENIED", "The person this evaluation runs as no longer has access to segments.");
    const access = await getSegmentAccess(seg.companyId, runAs.id, seg.sourceType);
    const version = await prisma.marketingSegmentVersion.findUniqueOrThrow({ where: { segmentId_versionNumber: { segmentId: seg.id, versionNumber: evaluation.versionNumber } } });
    const def = await compileDefinition(prisma, access, seg, { criteria: version.criteria, exclusionCriteria: version.exclusionCriteria, eligibilityChannel: version.eligibilityChannel });
    await prisma.marketingSegmentSnapshotEntry.deleteMany({ where: { evaluationId } });

    const counts = { matched: 0, INCLUDED: 0, EXCLUDED: 0, INELIGIBLE: 0 };
    const write = async (rows: Classified[]) => {
      if (!rows.length) return;
      await prisma.marketingSegmentSnapshotEntry.createMany({ data: rows.map((r) => ({ evaluationId, recordId: r.recordId, outcome: r.outcome, origin: r.origin, reason: r.reason })), skipDuplicates: true });
      for (const r of rows) counts[r.outcome] += 1;
    };

    if (seg.segmentType === "DYNAMIC") {
      const d = delegate(prisma, seg.sourceType);
      const where = { AND: [baseWhere(access), def.criteria] };
      let cursor: string | undefined;
      for (;;) {
        const batch = await d.findMany({ where, select: { id: true }, orderBy: { id: "asc" }, take: BATCH, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
        if (!batch.length) break;
        counts.matched += batch.length;
        if (counts.matched > MAX_EVALUATION_RECORDS) throw new BusinessRuleError("VALIDATION_ERROR", `More than ${MAX_EVALUATION_RECORDS.toLocaleString("en-IN")} records match — narrow the rules.`);
        await write(await classifyBatch(prisma, def, batch.map((b) => b.id), "CRITERIA"));
        cursor = batch[batch.length - 1].id;
        if (batch.length < BATCH) break;
      }
    } else {
      let cursor: string | undefined;
      for (;;) {
        const batch = await prisma.marketingSegmentMember.findMany({ where: { segmentId: seg.id, kind: "INCLUDED", removedAt: null }, select: { id: true, recordId: true }, orderBy: { id: "asc" }, take: BATCH, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
        if (!batch.length) break;
        counts.matched += batch.length;
        if (counts.matched > MAX_STATIC_MEMBERS) throw new BusinessRuleError("VALIDATION_ERROR", `A static segment can hold at most ${MAX_STATIC_MEMBERS.toLocaleString("en-IN")} members.`);
        await write(await classifyBatch(prisma, def, batch.map((b) => b.recordId), "STATIC"));
        cursor = batch[batch.length - 1].id;
        if (batch.length < BATCH) break;
      }
    }

    const outcome = await prisma.$transaction(async (tx) => {
      // Serialise against definition changes and other finishing runs.
      await tx.$queryRaw`SELECT id FROM marketing_segments WHERE id = ${seg.id}::uuid FOR UPDATE`;
      const fresh = await tx.marketingSegment.findUniqueOrThrow({ where: { id: seg.id } });
      if (fresh.currentVersionNumber !== evaluation.versionNumber) {
        await tx.marketingSegmentSnapshotEntry.deleteMany({ where: { evaluationId } });
        await tx.marketingSegmentEvaluation.update({ where: { id: evaluationId }, data: { status: "SUPERSEDED", finishedAt: new Date(), error: "The definition changed while this evaluation was running." } });
        return "SUPERSEDED";
      }
      const finishedAt = new Date();
      await tx.marketingSegmentEvaluation.update({
        where: { id: evaluationId },
        data: { status: "COMPLETED", finishedAt, matchedCount: counts.matched, memberCount: counts.INCLUDED, excludedCount: counts.EXCLUDED, ineligibleCount: counts.INELIGIBLE, error: null },
      });
      // Move the summary forward only if this run is newer than the one shown.
      const shown = fresh.lastEvaluationId ? await tx.marketingSegmentEvaluation.findUnique({ where: { id: fresh.lastEvaluationId }, select: { requestedAt: true } }) : null;
      if (!shown || shown.requestedAt <= evaluation.requestedAt) {
        await tx.marketingSegment.update({ where: { id: seg.id }, data: { lastEvaluationId: evaluationId, lastEvaluatedAt: finishedAt, lastEvaluationStatus: "COMPLETED", lastError: null, memberCount: counts.INCLUDED } });
      }
      await auditSegment(tx, { companyId: seg.companyId, userId: evaluation.runAsUserId }, evaluationId, "CREATE", null, { segmentId: seg.id, versionNumber: evaluation.versionNumber, matched: counts.matched, members: counts.INCLUDED, excluded: counts.EXCLUDED, ineligible: counts.INELIGIBLE }, "marketing_segment_evaluations");
      await recordSegmentEvent(tx, { companyId: seg.companyId, userId: evaluation.runAsUserId }, seg.id, "EVALUATION_COMPLETED", null, { evaluationId, members: counts.INCLUDED, excluded: counts.EXCLUDED, ineligible: counts.INELIGIBLE });
      return "COMPLETED";
    });
    await purgeOldSnapshots(seg.id);
    return { status: outcome, memberCount: counts.INCLUDED };
  } catch (e) {
    const message = safeMessage(e);
    if (!(e instanceof BusinessRuleError)) console.error(JSON.stringify({ level: "error", message: "Segment evaluation failed", evaluationId, error: (e as Error)?.message }));
    await finishFailed(evaluation, message);
    return { status: "FAILED" };
  }
}

/** Drops entries of old, unkept, unpinned completed snapshots (counts stay). */
export async function purgeOldSnapshots(segmentId: string) {
  const completed = await prisma.marketingSegmentEvaluation.findMany({
    where: { segmentId, status: "COMPLETED", entriesPurgedAt: null },
    orderBy: { finishedAt: "desc" },
    select: { id: true, isKept: true, _count: { select: { pinnedBy: true } } },
  });
  const seg = await prisma.marketingSegment.findUnique({ where: { id: segmentId }, select: { lastEvaluationId: true } });
  const purge = completed.slice(RETAIN_SNAPSHOTS).filter((e) => !e.isKept && e._count.pinnedBy === 0 && e.id !== seg?.lastEvaluationId);
  for (const e of purge) {
    await prisma.$transaction([prisma.marketingSegmentSnapshotEntry.deleteMany({ where: { evaluationId: e.id } }), prisma.marketingSegmentEvaluation.update({ where: { id: e.id }, data: { entriesPurgedAt: new Date() } })]);
  }
  return purge.length;
}

/** Recovery: runs stuck in RUNNING (lost worker) fail cleanly so a new one can be requested. */
export async function failStaleEvaluations(now = new Date()) {
  const stale = await prisma.marketingSegmentEvaluation.findMany({ where: { status: "RUNNING", startedAt: { lt: new Date(now.getTime() - STALE_RUNNING_MS) } } });
  for (const e of stale) await finishFailed(e, "The evaluation was interrupted (worker stopped). Refresh again.");
  return stale.length;
}

/** Nightly refresh: ACTIVE segments set to NIGHTLY, run as their owner. Returns the evaluation ids queued. */
export async function queueNightlyEvaluations(): Promise<string[]> {
  const segments = await prisma.marketingSegment.findMany({ where: { status: "ACTIVE", refreshSchedule: "NIGHTLY" }, select: { id: true, companyId: true, ownerUserId: true, currentVersionNumber: true } });
  const ids: string[] = [];
  const day = new Date().toISOString().slice(0, 10);
  for (const s of segments) {
    try {
      const e = await prisma.marketingSegmentEvaluation.create({
        data: { companyId: s.companyId, segmentId: s.id, versionNumber: s.currentVersionNumber, trigger: "NIGHTLY", runAsUserId: s.ownerUserId, idempotencyKey: `nightly:${day}` },
      });
      ids.push(e.id);
    } catch (err) {
      // Already queued / running, or already done tonight — fine.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    }
  }
  return ids;
}

// ── Reading snapshots ───────────────────────────────────────────────

async function loadEvaluation(actor: SalesActor, evaluationId: string) {
  const e = await prisma.marketingSegmentEvaluation.findFirst({ where: { id: evaluationId, companyId: actor.companyId } });
  if (!e) throw new BusinessRuleError("NOT_FOUND", "Snapshot not found.");
  const seg = await loadSegment(actor, e.segmentId); // visibility of the segment
  return { e, seg };
}

export async function getSegmentEvaluation(actor: SalesActor, evaluationId: string) {
  await PermissionService.assert(actor.userId, "marketing_segments", "view");
  const { e, seg } = await loadEvaluation(actor, evaluationId);
  const users = new Map((await prisma.user.findMany({ where: { id: { in: [e.runAsUserId, e.requestedByUserId].filter((x): x is string => Boolean(x)) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  const reasons = e.status === "COMPLETED" ? await prisma.marketingSegmentSnapshotEntry.groupBy({ by: ["outcome", "reason"], where: { evaluationId: e.id }, _count: { _all: true } }) : [];
  return {
    ...evaluationView(e, users),
    segment: { id: seg.id, code: seg.code, name: seg.name, sourceType: seg.sourceType, currentVersionNumber: seg.currentVersionNumber },
    isCurrentVersion: e.versionNumber === seg.currentVersionNumber,
    breakdown: reasons.map((r) => ({ outcome: r.outcome, reason: r.reason, count: r._count._all })),
  };
}

/** Snapshot entries — only for COMPLETED snapshots whose entries are retained. */
export async function listSnapshotEntries(actor: SalesActor, evaluationId: string, outcome: "INCLUDED" | "EXCLUDED" | "INELIGIBLE", page = 1, pageSize = 25) {
  await PermissionService.assert(actor.userId, "marketing_segments", "view");
  const { e, seg } = await loadEvaluation(actor, evaluationId);
  if (e.status !== "COMPLETED") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Only completed snapshots have a member list.");
  if (e.entriesPurgedAt) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This old snapshot's member list was removed by the retention rule; only its counts remain.");
  const where = { evaluationId: e.id, outcome };
  const [total, rows] = await Promise.all([prisma.marketingSegmentSnapshotEntry.count({ where }), prisma.marketingSegmentSnapshotEntry.findMany({ where, orderBy: { recordId: "asc" }, skip: (page - 1) * pageSize, take: pageSize })]);
  const display = await loadDisplay(prisma, actor.companyId, seg.sourceType, rows.map((r) => r.recordId));
  // Names only for records the viewer can see now.
  let visible = new Set<string>();
  try {
    const access = await getSegmentAccess(actor.companyId, actor.userId, seg.sourceType);
    visible = new Set((await delegate(prisma, seg.sourceType).findMany({ where: { AND: [baseWhere(access), { id: { in: rows.map((r) => r.recordId) } }] }, select: { id: true } })).map((r) => r.id));
  } catch {
    visible = new Set();
  }
  const reason = new Map(rows.map((r) => [r.recordId, r]));
  return {
    data: displayRows(rows.map((r) => r.recordId), display).map((d) => {
      const shown = visible.has(d.id) || d.name.startsWith("(record") ? d : { ...d, name: "(not visible to you)", organization: null, owner: null, location: null, href: "" };
      return { ...shown, outcome: reason.get(d.id)?.outcome, reason: reason.get(d.id)?.reason ?? null, origin: reason.get(d.id)?.origin };
    }),
    meta: { page, pageSize, totalCount: total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

export async function keepSnapshot(actor: SalesActor, evaluationId: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_segments", "edit");
  const input = keepSnapshotSchema.parse(raw);
  const { e, seg } = await loadEvaluation(actor, evaluationId);
  if (e.status !== "COMPLETED") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Only completed snapshots can be kept.");
  if (input.keep && e.entriesPurgedAt) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This snapshot's member list was already removed; it can't be kept.");
  await prisma.$transaction(async (tx) => {
    await tx.marketingSegmentEvaluation.update({ where: { id: e.id }, data: { isKept: input.keep, label: input.label === undefined ? e.label : input.label || null } });
    await auditSegment(tx, actor, e.id, "UPDATE", { isKept: e.isKept, label: e.label }, { isKept: input.keep, label: input.label ?? e.label }, "marketing_segment_evaluations");
    await recordSegmentEvent(tx, actor, seg.id, input.keep ? "SNAPSHOT_KEPT" : "SNAPSHOT_RELEASED", input.label || null, { evaluationId: e.id });
  });
  if (!input.keep) await purgeOldSnapshots(seg.id);
  return getSegmentEvaluation(actor, evaluationId);
}
