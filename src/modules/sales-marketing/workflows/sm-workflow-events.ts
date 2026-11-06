import { prisma } from "@/core/db/client";
import { SM_BULK_ENTITIES } from "@/modules/sales-marketing/bulk/sm-bulk-entities";
import { SM_WF_LIMITS, smWfEventSchema, smWfKey, type SmWfEvent, type SmWfEventType } from "./sm-workflow-registry";

/**
 * Phase 15 — event sources. There is no new event bus and no API to post an
 * event: every event is a row that an S&M service already writes IN THE SAME
 * TRANSACTION as the change it describes (so an event exists only for a
 * committed change):
 *
 *   enquiry     buyer_enquiry_activities (STAGE_CHANGED)
 *   quotation   quotation_events
 *   campaign    sales_performance_events (entity CAMPAIGN)
 *   budget      marketing_budget_alerts (raised_at / cleared_at)
 *   attribution marketing_attribution_runs (finished_at)
 *   bulk        bulk_jobs of S&M record types (finished_at)
 *
 * Each source is read from its checkpoint minus an overlap (a transaction
 * that commits late still gets read); the event log (unique source + key)
 * makes duplicates and re-reads harmless. Each row is normalised into the
 * versioned contract `smWfEventSchema` and validated — an invalid row is
 * logged as INVALID and never acted on.
 */

export interface SourceBatch {
  events: SmWfEvent[];
  invalid: { sourceKey: string; companyId: string; reason: string }[];
  /** Newest timestamp read (the new checkpoint). */
  maxSeen: Date | null;
}

interface SourceDef {
  name: string;
  read: (from: Date, to: Date, take: number) => Promise<{ rows: { at: Date; build: () => Promise<SmWfEvent | null> | SmWfEvent | null; key: string; companyId: string }[] }>;
}

const str = (v: unknown) => (typeof v === "string" ? v : null);

const QUOTATION_TYPES: Record<string, SmWfEventType> = {
  CREATED: "quotation.created",
  SUBMITTED: "quotation.submitted",
  APPROVED: "quotation.approved",
  APPROVAL_REJECTED: "quotation.approval_rejected",
  WITHDRAWN: "quotation.withdrawn",
  ISSUED: "quotation.issued",
  ACCEPTED: "quotation.accepted",
  REJECTED: "quotation.rejected",
  REVISED: "quotation.revised",
  CANCELLED: "quotation.cancelled",
  CONVERTED: "quotation.converted",
};
const CAMPAIGN_TYPES: Record<string, SmWfEventType> = {
  SUBMITTED: "campaign.submitted",
  AUTO_APPROVED: "campaign.approved",
  APPROVED: "campaign.approved",
  SENT_BACK: "campaign.sent_back",
  RETURNED_TO_DRAFT: "campaign.sent_back",
  ACTIVATED: "campaign.activated",
  COMPLETED: "campaign.completed",
  CANCELLED: "campaign.cancelled",
  CAMPAIGN_UPDATED: "campaign.changed",
  OWNER_CHANGED: "campaign.changed",
  REVISION_APPROVED: "campaign.changed",
  EXPENSE_LINKED: "campaign.changed",
  EXPENSE_UNLINKED: "campaign.changed",
};

const base = (source: string, sourceKey: string, companyId: string, at: Date, actor: string | null) => ({ schemaVersion: 1 as const, source, sourceKey, companyId, occurredAt: at, actorUserId: actor });

export const SM_WF_SOURCES: SourceDef[] = [
  {
    name: "enquiry",
    read: async (from, to, take) => {
      const rows = await prisma.buyerEnquiryActivity.findMany({ where: { type: "STAGE_CHANGED", createdAt: { gt: from, lte: to } }, orderBy: { createdAt: "asc" }, take });
      return {
        rows: rows.map((r) => ({
          at: r.createdAt,
          key: r.id,
          companyId: r.companyId,
          build: () => {
            const to = str((r.metadata as Record<string, unknown>)?.to);
            return { ...base("enquiry", r.id, r.companyId, r.createdAt, r.createdByUserId), type: to === "QUALIFIED" ? "enquiry.qualified" : "enquiry.stage_changed", entityType: "ENQUIRY", entityId: r.buyerEnquiryId, data: { toStage: to }, keys: [smWfKey("ENQUIRY", r.buyerEnquiryId)] };
          },
        })),
      };
    },
  },
  {
    name: "quotation",
    read: async (from, to, take) => {
      const rows = await prisma.quotationEvent.findMany({ where: { createdAt: { gt: from, lte: to } }, orderBy: { createdAt: "asc" }, take, include: { quotation: { select: { buyerEnquiryId: true } } } });
      return {
        rows: rows.map((r) => ({
          at: r.createdAt,
          key: r.id,
          companyId: r.companyId,
          build: () => {
            const type = QUOTATION_TYPES[r.type];
            if (!type) return null; // UPDATED, SENT, CUSTOMER_LINKED: nothing waits on them
            const keys = [smWfKey("QUOTATION", r.quotationId), ...(r.quotation.buyerEnquiryId ? [smWfKey("ENQUIRY", r.quotation.buyerEnquiryId)] : [])];
            return { ...base("quotation", r.id, r.companyId, r.createdAt, r.createdByUserId), type, entityType: "QUOTATION", entityId: r.quotationId, data: { revisionNumber: r.revisionNumber }, keys };
          },
        })),
      };
    },
  },
  {
    name: "campaign",
    read: async (from, to, take) => {
      const rows = await prisma.salesPerformanceEvent.findMany({ where: { entityType: "CAMPAIGN", createdAt: { gt: from, lte: to } }, orderBy: { createdAt: "asc" }, take });
      return {
        rows: rows.map((r) => ({
          at: r.createdAt,
          key: r.id,
          companyId: r.companyId,
          build: () => {
            const type = CAMPAIGN_TYPES[r.type];
            if (!type) return null;
            return { ...base("campaign", r.id, r.companyId, r.createdAt, r.createdByUserId), type, entityType: "CAMPAIGN", entityId: r.entityId, data: { eventType: r.type }, keys: [smWfKey("CAMPAIGN", r.entityId)] };
          },
        })),
      };
    },
  },
  {
    name: "budget",
    read: async (from, to, take) => {
      const [raised, cleared] = await Promise.all([
        prisma.marketingBudgetAlert.findMany({ where: { raisedAt: { gt: from, lte: to } }, orderBy: { raisedAt: "asc" }, take }),
        prisma.marketingBudgetAlert.findMany({ where: { clearedAt: { gt: from, lte: to } }, orderBy: { clearedAt: "asc" }, take }),
      ]);
      const out = [
        ...raised.map((a) => ({
          at: a.raisedAt,
          key: `${a.id}:raised`,
          companyId: a.companyId,
          build: () => ({ ...base("budget", `${a.id}:raised`, a.companyId, a.raisedAt, null), type: "budget.alert_raised" as const, entityType: "BUDGET_ALERT" as const, entityId: a.id, data: { kind: a.kind, campaignId: a.campaignId }, keys: [smWfKey("BUDGET_ALERT", a.id), smWfKey("CAMPAIGN", a.campaignId)] }),
        })),
        ...cleared.map((a) => ({
          at: a.clearedAt!,
          key: `${a.id}:cleared`,
          companyId: a.companyId,
          build: () => ({ ...base("budget", `${a.id}:cleared`, a.companyId, a.clearedAt!, null), type: "budget.alert_cleared" as const, entityType: "BUDGET_ALERT" as const, entityId: a.id, data: { kind: a.kind, campaignId: a.campaignId }, keys: [smWfKey("BUDGET_ALERT", a.id), smWfKey("CAMPAIGN", a.campaignId)] }),
        })),
      ];
      return { rows: out.sort((x, y) => x.at.getTime() - y.at.getTime()).slice(0, take) };
    },
  },
  {
    name: "attribution",
    read: async (from, to, take) => {
      const rows = await prisma.marketingAttributionRun.findMany({ where: { finishedAt: { gt: from, lte: to } }, orderBy: { finishedAt: "asc" }, take, select: { id: true, companyId: true, modelId: true, status: true, finishedAt: true, requestedByUserId: true, conversions: true, unattributed: true } });
      return {
        rows: rows.map((r) => ({
          at: r.finishedAt!,
          key: `${r.id}:finished`,
          companyId: r.companyId,
          build: () => ({
            ...base("attribution", `${r.id}:finished`, r.companyId, r.finishedAt!, r.requestedByUserId),
            type: "attribution.run_finished" as const,
            entityType: "ATTRIBUTION_RUN" as const,
            entityId: r.id,
            // PURGED = completed, details since removed by retention.
            data: { status: r.status === "PURGED" ? "COMPLETED" : r.status, modelId: r.modelId, conversions: r.conversions, unattributed: r.unattributed },
            keys: [smWfKey("ATTRIBUTION_RUN", r.id), smWfKey("ATTRIBUTION_MODEL", r.modelId)],
          }),
        })),
      };
    },
  },
  {
    name: "bulk",
    read: async (from, to, take) => {
      const rows = await prisma.bulkJob.findMany({
        where: { finishedAt: { gt: from, lte: to }, entityType: { in: [...SM_BULK_ENTITIES] }, dryRun: false },
        orderBy: { finishedAt: "asc" },
        take,
        select: { id: true, companyId: true, status: true, finishedAt: true, requestedByUserId: true, entityType: true, actionKey: true, failedCount: true, retryOfJobId: true },
      });
      return {
        rows: rows.map((r) => ({
          at: r.finishedAt!,
          key: `${r.id}:finished`,
          companyId: r.companyId,
          build: () => ({
            ...base("bulk", `${r.id}:finished`, r.companyId, r.finishedAt!, r.requestedByUserId),
            type: "bulk.job_finished" as const,
            entityType: "BULK_JOB" as const,
            entityId: r.id,
            data: { status: r.status, recordType: r.entityType, actionKey: r.actionKey, failedCount: r.failedCount, retryOfJobId: r.retryOfJobId },
            keys: [smWfKey("BULK_JOB", r.id), ...(r.retryOfJobId ? [smWfKey("BULK_JOB", r.retryOfJobId)] : [])],
          }),
        })),
      };
    },
  },
];

/** Reads one source from its checkpoint (minus the overlap) and validates every event. */
export async function readSource(source: SourceDef, now: Date): Promise<SourceBatch> {
  const cp = await prisma.smWorkflowCheckpoint.findUnique({ where: { source: source.name } });
  const from = cp ? new Date(cp.lastSeenAt.getTime() - SM_WF_LIMITS.eventOverlapMs) : new Date(now.getTime() - SM_WF_LIMITS.firstReadLookbackMs);
  const { rows } = await source.read(from, now, SM_WF_LIMITS.eventBatch);
  const events: SmWfEvent[] = [];
  const invalid: SourceBatch["invalid"] = [];
  let maxSeen: Date | null = cp?.lastSeenAt ?? null;
  for (const r of rows) {
    if (!maxSeen || r.at > maxSeen) maxSeen = r.at;
    let built: SmWfEvent | null;
    try {
      built = await r.build();
    } catch (e) {
      invalid.push({ sourceKey: r.key, companyId: r.companyId, reason: (e as Error).message.slice(0, 200) });
      continue;
    }
    if (!built) continue;
    const parsed = smWfEventSchema.safeParse(built);
    if (parsed.success) events.push(parsed.data);
    else invalid.push({ sourceKey: r.key, companyId: r.companyId, reason: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 200) });
  }
  // A full page means there may be more: never move the checkpoint past what was read.
  return { events, invalid, maxSeen };
}
