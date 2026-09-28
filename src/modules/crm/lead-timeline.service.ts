import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { LeadRepository } from "./lead.repository";

export type LeadTimelineEntry = {
  id: string;
  at: Date;
  kind: "ACTIVITY" | "STAGE" | "ASSIGNMENT" | "FOLLOWUP" | "FILE";
  type: string;
  title: string;
  detail: string | null;
  user: string | null;
};

/**
 * One chronological, newest-first timeline for a lead, assembled from the
 * records that already exist (activities, stage history, assignment history,
 * follow-ups, uploaded files). Nothing is copied into a separate timeline
 * table, so the timeline can never disagree with its sources.
 */
export async function getLeadTimeline(companyId: string, id: string): Promise<LeadTimelineEntry[]> {
  const lead = await LeadRepository.findAnyById(companyId, id);
  if (!lead) throw new BusinessRuleError("NOT_FOUND", "Lead not found.", { id });

  const where = { companyId, relatedModule: "LEAD" as const, relatedRecordId: id };
  const [activities, stages, assignments, followups, files] = await Promise.all([
    prisma.crmActivity.findMany({ where, include: { performedBy: { select: { fullName: true } } } }),
    prisma.crmStageHistory.findMany({
      where,
      include: { fromStage: { select: { name: true } }, toStage: { select: { name: true } }, changedBy: { select: { fullName: true } } },
    }),
    prisma.crmAssignmentHistory.findMany({
      where,
      include: { toUser: { select: { fullName: true } }, fromUser: { select: { fullName: true } }, assignedBy: { select: { fullName: true } } },
    }),
    prisma.crmFollowup.findMany({
      where,
      include: { createdBy: { select: { fullName: true } }, assignedTo: { select: { fullName: true } } },
    }),
    prisma.attachment.findMany({
      where: { companyId, relatedModule: "LEAD", relatedRecordId: id },
      include: { uploadedBy: { select: { fullName: true } } },
    }),
  ]);

  const entries: LeadTimelineEntry[] = [
    // Stage-change notes are represented by the richer stage-history rows
    // below, so they are not listed twice.
    ...activities
      .filter((a) => !(a.activityType === "NOTE" && a.subject?.startsWith("Stage changed:")))
      .map((a) => ({
        id: `a-${a.id}`,
        at: a.activityAt,
        kind: "ACTIVITY" as const,
        type: a.activityType,
        title: a.subject ?? a.activityType,
        detail: a.body,
        user: a.performedBy.fullName,
      })),
    ...stages.map((s) => ({
      id: `s-${s.id}`,
      at: s.changedAt,
      kind: "STAGE" as const,
      type: s.fromStage ? "STAGE_CHANGED" : "LEAD_CREATED",
      title: s.fromStage ? `Stage: ${s.fromStage.name} → ${s.toStage.name}` : `Lead created in ${s.toStage.name}`,
      detail: s.comment,
      user: s.changedBy.fullName,
    })),
    ...assignments.map((a) => ({
      id: `as-${a.id}`,
      at: a.assignedAt,
      kind: "ASSIGNMENT" as const,
      type: "ASSIGNED",
      title: `Assigned to ${a.toUser?.fullName ?? "nobody"}${a.fromUser ? ` (from ${a.fromUser.fullName})` : ""}`,
      detail: a.reason,
      user: a.assignedBy.fullName,
    })),
    ...followups.flatMap((f) => {
      const scheduled: LeadTimelineEntry = {
        id: `f-${f.id}`,
        at: f.createdAt,
        kind: "FOLLOWUP",
        type: "FOLLOWUP_SCHEDULED",
        title: `Follow-up scheduled (${f.type})${f.assignedTo ? ` for ${f.assignedTo.fullName}` : ""}`,
        detail: [`Due ${f.followupDate.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`, f.notes].filter(Boolean).join(" · "),
        user: f.createdBy.fullName,
      };
      if (f.status === "PENDING" || !f.completedAt) return [scheduled];
      const closed: LeadTimelineEntry = {
        id: `fc-${f.id}`,
        at: f.completedAt,
        kind: "FOLLOWUP",
        type: f.status === "COMPLETED" ? "FOLLOWUP_COMPLETED" : "FOLLOWUP_CANCELLED",
        title: `Follow-up ${f.status === "COMPLETED" ? "completed" : "cancelled"} (${f.type})`,
        detail: null,
        user: f.assignedTo?.fullName ?? null,
      };
      return [scheduled, closed];
    }),
    ...files.map((f) => ({
      id: `file-${f.id}`,
      at: f.uploadedAt,
      kind: "FILE" as const,
      type: "DOCUMENT_UPLOADED",
      title: `Document uploaded: ${f.fileName}`,
      detail: null,
      user: f.uploadedBy.fullName,
    })),
  ];

  return entries.sort((a, b) => b.at.getTime() - a.at.getTime());
}
