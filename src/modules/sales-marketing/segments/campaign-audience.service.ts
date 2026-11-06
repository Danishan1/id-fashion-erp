import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { auditCampaign, loadCampaign, recordCampaignEvent } from "@/modules/sales-marketing/campaigns/campaign-common";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { getSegmentScope, loadSegment, recordSegmentEvent, segmentScopeWhere } from "./segment-common";
import { consentCheck } from "./segment-query";
import { SEGMENT_SOURCES, type EligibilityChannelKey } from "./segment-registry";

/**
 * Campaign audience (Phase 09, PHASE_09_SEGMENTS.md §6). A campaign picks one
 * or more INCLUDE segments and optional EXCLUDE segments, all of the same
 * record type. Each can be pinned to a completed snapshot for a reproducible
 * audience; unpinned rows use the segment's latest completed snapshot.
 *
 * Audience = (included members of every INCLUDE snapshot, deduplicated by
 * record id) minus (included members of every EXCLUDE snapshot). Nothing here
 * sends, publishes or launches anything — that is Phase 10+, and it must still
 * check consent itself: membership is never permission to contact.
 */

export const addAudienceSchema = z.object({ segmentId: z.string().uuid("Choose a segment"), role: z.enum(["INCLUDE", "EXCLUDE"]), pinLatest: z.boolean().optional() }).strict();
export const pinAudienceSchema = z.object({ evaluationId: z.string().uuid().nullable() }).strict();

const CLOSED = ["COMPLETED", "CANCELLED"] as const;

async function loadOpenCampaign(actor: SalesActor, campaignId: string) {
  const c = await loadCampaign(actor, campaignId);
  if ((CLOSED as readonly string[]).includes(c.status)) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `The campaign is ${c.status.toLowerCase()}; its audience can no longer change.`);
  return c;
}

export async function getCampaignAudience(actor: SalesActor, campaignId: string) {
  await PermissionService.assert(actor.userId, "marketing_campaigns", "view");
  const campaign = await loadCampaign(actor, campaignId);
  const rows = await prisma.marketingCampaignAudience.findMany({
    where: { campaignId: campaign.id },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    include: {
      segment: { include: { versions: { orderBy: { versionNumber: "desc" }, take: 1, select: { eligibilityChannel: true, versionNumber: true } } } },
      pinnedEvaluation: true,
    },
  });
  const canSeeSegments = await PermissionService.can(actor.userId, "marketing_segments", "view");
  const scope = canSeeSegments ? await getSegmentScope(actor) : null;
  const visibleIds = scope ? new Set((await prisma.marketingSegment.findMany({ where: { AND: [segmentScopeWhere(actor, scope), { id: { in: rows.map((r) => r.segmentId) } }] }, select: { id: true } })).map((s) => s.id)) : new Set<string>();
  const latestIds = rows.map((r) => r.segment.lastEvaluationId).filter((x): x is string => Boolean(x));
  const latest = new Map((await prisma.marketingSegmentEvaluation.findMany({ where: { id: { in: latestIds } } })).map((e) => [e.id, e]));

  const items = rows.map((r) => {
    const s = r.segment;
    const used = r.pinnedEvaluation ?? (s.lastEvaluationId ? (latest.get(s.lastEvaluationId) ?? null) : null);
    const channel = (s.versions[0]?.eligibilityChannel as EligibilityChannelKey | null) ?? null;
    return {
      id: r.id,
      role: r.role,
      segment: {
        id: s.id,
        code: s.code,
        name: visibleIds.has(s.id) ? s.name : "(segment not visible to you)",
        visible: visibleIds.has(s.id),
        status: s.status,
        sourceType: s.sourceType,
        segmentType: s.segmentType,
        currentVersionNumber: s.currentVersionNumber,
        lastEvaluatedAt: s.lastEvaluatedAt?.toISOString() ?? null,
        lastEvaluationStatus: s.lastEvaluationStatus,
        consentCheck: consentCheck(s.sourceType, channel),
        eligibilityChannel: channel,
      },
      pinned: Boolean(r.pinnedEvaluationId),
      snapshot: used
        ? {
            id: used.id,
            versionNumber: used.versionNumber,
            finishedAt: used.finishedAt?.toISOString() ?? null,
            memberCount: used.memberCount,
            entriesAvailable: used.status === "COMPLETED" && !used.entriesPurgedAt,
            /** The segment's definition has moved on since this snapshot. */
            definitionDiffers: used.versionNumber !== s.currentVersionNumber,
            /** A newer completed snapshot exists than the pinned one. */
            newerSnapshotExists: Boolean(r.pinnedEvaluationId && s.lastEvaluationId && s.lastEvaluationId !== r.pinnedEvaluationId && (latest.get(s.lastEvaluationId)?.requestedAt ?? 0) > used.requestedAt),
          }
        : null,
    };
  });

  // Combined count from the snapshots in use (no personal data, ids only).
  const include = items.filter((i) => i.role === "INCLUDE");
  const exclude = items.filter((i) => i.role === "EXCLUDE");
  const missing = items.filter((i) => !i.snapshot || !i.snapshot.entriesAvailable).map((i) => i.segment.code);
  let summary: { audience: number; includedTotal: number; duplicatesRemoved: number; removedByExclusions: number } | null = null;
  if (include.length && !missing.length) {
    const incIds = include.map((i) => i.snapshot!.id);
    const excIds = exclude.map((i) => i.snapshot!.id);
    const [row] = await prisma.$queryRaw<{ total: bigint; distinct_all: bigint; audience: bigint }[]>(Prisma.sql`
      WITH inc AS (
        SELECT record_id FROM marketing_segment_snapshot_entries WHERE evaluation_id = ANY(${incIds}::uuid[]) AND outcome = 'INCLUDED'
      ), exc AS (
        SELECT DISTINCT record_id FROM marketing_segment_snapshot_entries WHERE evaluation_id = ANY(${excIds}::uuid[]) AND outcome = 'INCLUDED'
      )
      SELECT
        (SELECT COUNT(*) FROM inc) AS total,
        (SELECT COUNT(DISTINCT record_id) FROM inc) AS distinct_all,
        (SELECT COUNT(DISTINCT record_id) FROM inc WHERE record_id NOT IN (SELECT record_id FROM exc)) AS audience`);
    const total = Number(row.total);
    const distinctAll = Number(row.distinct_all);
    const audience = Number(row.audience);
    summary = { audience, includedTotal: total, duplicatesRemoved: total - distinctAll, removedByExclusions: distinctAll - audience };
  }
  const sourceType = items[0]?.segment.sourceType ?? null;
  return {
    campaign: { id: campaign.id, code: campaign.code, status: campaign.status },
    sourceType,
    sourceLabel: sourceType ? SEGMENT_SOURCES[sourceType].label : null,
    items,
    summary,
    missingSnapshots: missing,
    consentNote:
      sourceType && sourceType !== "CONTACT"
        ? "Consent can't be verified for this record type — the audience is not cleared for marketing messages."
        : items.some((i) => i.segment.consentCheck === "NOT_CHECKED")
          ? "Some segments don't check a channel's address / consent. Being in the audience is not permission to contact."
          : null,
  };
}

export async function addCampaignAudience(actor: SalesActor, campaignId: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_campaigns", "edit");
  await PermissionService.assert(actor.userId, "marketing_segments", "view");
  const input = addAudienceSchema.parse(raw);
  const campaign = await loadOpenCampaign(actor, campaignId);
  const seg = await loadSegment(actor, input.segmentId).catch(() => {
    throw new BusinessRuleError("VALIDATION_ERROR", "Segment not found or not visible to you.", { fieldErrors: { segmentId: "Not available." } });
  });
  if (seg.status !== "ACTIVE") throw new BusinessRuleError("VALIDATION_ERROR", `Only active segments can be used — ${seg.code} is ${seg.status.toLowerCase()}.`, { fieldErrors: { segmentId: "Not active." } });
  const existing = await prisma.marketingCampaignAudience.findMany({ where: { campaignId: campaign.id }, include: { segment: { select: { sourceType: true } } } });
  if (existing.some((e) => e.segmentId === seg.id)) throw new BusinessRuleError("VALIDATION_ERROR", "This segment is already part of the campaign's audience.");
  const other = existing.find((e) => e.segment.sourceType !== seg.sourceType);
  if (other) throw new BusinessRuleError("VALIDATION_ERROR", `This campaign's audience is made of ${SEGMENT_SOURCES[other.segment.sourceType].label}; a segment of ${SEGMENT_SOURCES[seg.sourceType].label} can't be combined with it.`);
  let pinnedEvaluationId: string | null = null;
  if (input.pinLatest) {
    if (!seg.lastEvaluationId) throw new BusinessRuleError("VALIDATION_ERROR", `${seg.code} has no completed snapshot yet — refresh it first, or add it without pinning.`);
    pinnedEvaluationId = seg.lastEvaluationId;
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const row = await tx.marketingCampaignAudience.create({ data: { companyId: actor.companyId, campaignId: campaign.id, segmentId: seg.id, role: input.role, pinnedEvaluationId, addedByUserId: actor.userId } });
      await auditCampaign(tx, actor, row.id, "CREATE", null, { campaignId: campaign.id, segmentId: seg.id, role: input.role, pinnedEvaluationId }, "marketing_campaign_audiences");
      await recordCampaignEvent(tx, actor, campaign.id, "AUDIENCE_ADDED", null, { segmentId: seg.id, code: seg.code, role: input.role, pinnedEvaluationId });
      await recordSegmentEvent(tx, actor, seg.id, "USED_BY_CAMPAIGN", null, { campaignId: campaign.id, code: campaign.code, role: input.role });
      return row;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new BusinessRuleError("VALIDATION_ERROR", "This segment is already part of the campaign's audience.");
    throw e;
  }
}

async function loadAudienceRow(actor: SalesActor, campaignId: string, audienceId: string) {
  const row = await prisma.marketingCampaignAudience.findFirst({ where: { id: audienceId, campaignId, companyId: actor.companyId }, include: { segment: { select: { id: true, code: true } } } });
  if (!row) throw new BusinessRuleError("NOT_FOUND", "Audience entry not found.");
  return row;
}

/** Pin to a specific completed snapshot (null = follow the latest). */
export async function pinCampaignAudience(actor: SalesActor, campaignId: string, audienceId: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_campaigns", "edit");
  const input = pinAudienceSchema.parse(raw);
  const campaign = await loadOpenCampaign(actor, campaignId);
  const row = await loadAudienceRow(actor, campaign.id, audienceId);
  if (input.evaluationId) {
    const e = await prisma.marketingSegmentEvaluation.findFirst({ where: { id: input.evaluationId, segmentId: row.segmentId, companyId: actor.companyId } });
    if (!e || e.status !== "COMPLETED") throw new BusinessRuleError("VALIDATION_ERROR", "Choose a completed snapshot of this segment.");
    if (e.entriesPurgedAt) throw new BusinessRuleError("VALIDATION_ERROR", "That snapshot's member list was removed by the retention rule; pick a newer one.");
  }
  await prisma.$transaction(async (tx) => {
    await tx.marketingCampaignAudience.update({ where: { id: row.id }, data: { pinnedEvaluationId: input.evaluationId } });
    await auditCampaign(tx, actor, row.id, "UPDATE", { pinnedEvaluationId: row.pinnedEvaluationId }, { pinnedEvaluationId: input.evaluationId }, "marketing_campaign_audiences");
    await recordCampaignEvent(tx, actor, campaign.id, input.evaluationId ? "AUDIENCE_PINNED" : "AUDIENCE_UNPINNED", null, { segmentId: row.segmentId, code: row.segment.code, evaluationId: input.evaluationId });
  });
  return getCampaignAudience(actor, campaign.id);
}

export async function removeCampaignAudience(actor: SalesActor, campaignId: string, audienceId: string) {
  await PermissionService.assert(actor.userId, "marketing_campaigns", "edit");
  const campaign = await loadOpenCampaign(actor, campaignId);
  const row = await loadAudienceRow(actor, campaign.id, audienceId);
  await prisma.$transaction(async (tx) => {
    await tx.marketingCampaignAudience.delete({ where: { id: row.id } });
    await auditCampaign(tx, actor, row.id, "DELETE", { campaignId: campaign.id, segmentId: row.segmentId, role: row.role, pinnedEvaluationId: row.pinnedEvaluationId }, null, "marketing_campaign_audiences");
    await recordCampaignEvent(tx, actor, campaign.id, "AUDIENCE_REMOVED", null, { segmentId: row.segmentId, code: row.segment.code, role: row.role });
  });
  return getCampaignAudience(actor, campaign.id);
}

/** Segments the user can pick for a campaign (active, visible). */
export async function audienceSegmentOptions(actor: SalesActor) {
  await PermissionService.assert(actor.userId, "marketing_segments", "view");
  const scope = await getSegmentScope(actor);
  const rows = await prisma.marketingSegment.findMany({ where: { AND: [segmentScopeWhere(actor, scope), { status: "ACTIVE" }] }, orderBy: { code: "asc" }, take: 500, select: { id: true, code: true, name: true, sourceType: true, segmentType: true, memberCount: true, lastEvaluatedAt: true, lastEvaluationId: true } });
  return rows.map((r) => ({ ...r, lastEvaluatedAt: r.lastEvaluatedAt?.toISOString() ?? null }));
}
