import type { Prisma } from "@prisma/client";
import { getEntryStage, listPipelineStages } from "./crm-config.service";
import { getCrmSettings } from "./crm-settings.service";
import type { LeadSegment } from "./lead-segment-labels";

export { LEAD_SEGMENTS, LEAD_SEGMENT_LABELS, isLeadSegment, type LeadSegment } from "./lead-segment-labels";

/**
 * Named lead segments — the ONE definition shared by the CRM dashboard's
 * counts and the Leads list's `?segment=` filter, so a number on a dashboard
 * card is always exactly the rows you see when you click it.
 *
 * Every definition keys on real, stored facts (stage kind/sort order,
 * lastActivityAt, flags, score) — never on a stage's display name:
 * - CONTACTED / NEVER_CONTACTED: whether anything has ever been logged
 *   against the lead (`lastActivityAt`, set by every logged activity and
 *   every stage move). NEVER_CONTACTED is limited to still-open leads.
 * - QUALIFIED / QUOTATION: the lead has reached (or passed) the configured
 *   QUALIFICATION / QUOTATION_SENT stage by pipeline order, or is Won. If an
 *   admin has removed that anchor stage, only Won leads count.
 *
 * Resolves every segment's where-clause for one company in one pass (the
 * stage-order anchors and thresholds are read once, not per segment).
 */
export async function buildLeadSegmentWheres(companyId: string): Promise<Record<LeadSegment, Prisma.LeadWhereInput>> {
  const [stages, entryStage, settings] = await Promise.all([
    listPipelineStages(companyId, "LEAD"),
    getEntryStage(companyId).catch(() => null),
    getCrmSettings(companyId),
  ]);

  const reachedStage = (anchorCode: string): Prisma.LeadWhereInput => {
    const anchor = stages.find((s) => s.code === anchorCode && s.kind === "OPEN");
    return anchor
      ? { OR: [{ stage: { kind: "WON" } }, { stage: { kind: "OPEN", sortOrder: { gte: anchor.sortOrder } } }] }
      : { stage: { kind: "WON" } };
  };

  return {
    NEW: entryStage ? { stageId: entryStage.id } : { id: { in: [] } },
    CONTACTED: { lastActivityAt: { not: null } },
    NEVER_CONTACTED: { lastActivityAt: null, stage: { kind: "OPEN" } },
    QUALIFIED: reachedStage("QUALIFICATION"),
    QUOTATION: reachedStage("QUOTATION_SENT"),
    OPEN: { stage: { kind: "OPEN" } },
    WON: { stage: { kind: "WON" } },
    LOST: { stage: { kind: "LOST" } },
    DORMANT: { stage: { kind: "DORMANT" } },
    SAMPLING: { samplingRequired: true },
    HOT: { leadScore: { gte: settings.hotThreshold } },
  };
}

export async function buildLeadSegmentWhere(companyId: string, segment: LeadSegment): Promise<Prisma.LeadWhereInput> {
  return (await buildLeadSegmentWheres(companyId))[segment];
}

/** createdAt range shared by the dashboard and the Leads list. `dateTo` is a
 * plain YYYY-MM-DD the user picked — inclusive of that whole local day
 * (createdAt is a full timestamp, not a @db.Date column). */
export function createdRangeWhere(dateFrom?: string | null, dateTo?: string | null): Prisma.LeadWhereInput {
  const from = dateFrom ? new Date(`${dateFrom}T00:00:00`) : null;
  const to = dateTo ? new Date(`${dateTo}T23:59:59.999`) : null;
  const valid = (d: Date | null) => d && !Number.isNaN(d.getTime());
  if (!valid(from) && !valid(to)) return {};
  return { createdAt: { ...(valid(from) ? { gte: from! } : {}), ...(valid(to) ? { lte: to! } : {}) } };
}
