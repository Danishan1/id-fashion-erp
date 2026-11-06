import { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { loadCampaign } from "@/modules/sales-marketing/campaigns/campaign-common";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { auditContent, notifyContentApprovers, notifyContentUsers, recordContentCampaignEvent, REVIEWS_TABLE, userNames, type Db } from "./content-common";
import { canReview, CONTENT_CHANNELS, REVIEW_ACTIONS, reviewActionSchema, reviewDecisionSchema, type ReviewAction, type ReviewStatus, type ReviewSubject } from "./content-registry";

/**
 * Reviews of immutable content versions (Phase 11): asset versions, CRM
 * template versions (approval for marketing use) and campaign content
 * versions. One review row per version + an event history. Approval belongs
 * to that exact version; changing content means a new version and a new
 * review. The author (or the submitter) can never decide — enforced here and
 * by a CHECK constraint. The ERP has no shared approval engine; this follows
 * the same pattern as campaign approvals (Phase 08).
 */

interface Subject {
  type: ReviewSubject;
  id: string;
  authorUserId: string;
  label: string;
  /** Campaign of a content version (history + visibility). */
  campaignId: string | null;
}

async function loadSubject(actor: SalesActor, type: ReviewSubject, id: string, db: Db = prisma): Promise<Subject> {
  const notFound = () => new BusinessRuleError("NOT_FOUND", "Version not found.", { id });
  if (type === "ASSET_VERSION") {
    const v = await db.marketingAssetVersion.findFirst({ where: { id, companyId: actor.companyId }, include: { asset: { select: { code: true, name: true, status: true } } } });
    if (!v) throw notFound();
    return { type, id, authorUserId: v.createdByUserId, label: `${v.asset.name} (${v.asset.code}) v${v.versionNumber}`, campaignId: null };
  }
  if (type === "TEMPLATE_VERSION") {
    const v = await db.crmMessageTemplateVersion.findFirst({ where: { id, companyId: actor.companyId }, include: { template: { select: { name: true, channelType: true } } } });
    if (!v || !(CONTENT_CHANNELS as readonly string[]).includes(v.template.channelType)) throw notFound();
    return { type, id, authorUserId: v.createdByUserId, label: `Template "${v.template.name}" v${v.versionNumber}`, campaignId: null };
  }
  const v = await db.marketingCampaignContentVersion.findFirst({ where: { id, companyId: actor.companyId }, include: { content: { select: { name: true, campaignId: true } } } });
  if (!v) throw notFound();
  // Campaign content is as visible as its campaign.
  await loadCampaign(actor, v.content.campaignId).catch(() => {
    throw notFound();
  });
  return { type, id, authorUserId: v.createdByUserId, label: `"${v.content.name}" v${v.versionNumber}`, campaignId: v.content.campaignId };
}

/** What must be true before a version can be approved. */
async function assertApprovable(tx: Prisma.TransactionClient, actor: SalesActor, s: Subject) {
  if (s.type === "ASSET_VERSION") {
    const v = await tx.marketingAssetVersion.findUniqueOrThrow({ where: { id: s.id }, include: { asset: { select: { status: true } } } });
    if (v.asset.status !== "ACTIVE") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "The asset is archived.");
  }
  if (s.type === "TEMPLATE_VERSION") {
    const v = await tx.crmMessageTemplateVersion.findUniqueOrThrow({ where: { id: s.id }, include: { template: { select: { status: true } } } });
    if (v.template.status === "ARCHIVED") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "The template is archived in the CRM.");
  }
  if (s.type === "CONTENT_VERSION") {
    // Every attached file must itself be an approved, usable asset version.
    const links = await tx.marketingContentVersionAsset.findMany({ where: { contentVersionId: s.id }, include: { assetVersion: { include: { asset: { select: { name: true, status: true, expiresOn: true } } } } } });
    const states = await reviewStates(links.map((l) => l.assetVersionId), "ASSET_VERSION", tx);
    for (const l of links) {
      if (states.get(l.assetVersionId)?.status !== "APPROVED") throw new BusinessRuleError("VALIDATION_ERROR", `Attachment "${l.assetVersion.asset.name}" v${l.assetVersion.versionNumber} isn't approved yet.`);
      if (l.assetVersion.asset.status !== "ACTIVE") throw new BusinessRuleError("VALIDATION_ERROR", `Attachment "${l.assetVersion.asset.name}" is archived.`);
      if (l.assetVersion.asset.expiresOn && l.assetVersion.asset.expiresOn < startOfToday()) throw new BusinessRuleError("VALIDATION_ERROR", `Attachment "${l.assetVersion.asset.name}" has expired.`);
    }
  }
  void actor;
}

const startOfToday = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

/** After approval, the parent points at its newest approved version. */
async function afterApproval(tx: Prisma.TransactionClient, s: Subject) {
  if (s.type === "ASSET_VERSION") {
    const v = await tx.marketingAssetVersion.findUniqueOrThrow({ where: { id: s.id }, include: { asset: { select: { id: true, approvedVersion: { select: { versionNumber: true } } } } } });
    if (!v.asset.approvedVersion || v.asset.approvedVersion.versionNumber < v.versionNumber) await tx.marketingAsset.update({ where: { id: v.asset.id }, data: { approvedVersionId: v.id } });
  }
  if (s.type === "CONTENT_VERSION") {
    const v = await tx.marketingCampaignContentVersion.findUniqueOrThrow({ where: { id: s.id }, include: { content: { select: { id: true, approvedVersion: { select: { versionNumber: true } } } } } });
    if (!v.content.approvedVersion || v.content.approvedVersion.versionNumber < v.versionNumber) await tx.marketingCampaignContent.update({ where: { id: v.content.id }, data: { approvedVersionId: v.id } });
  }
}

export interface ReviewState {
  reviewId: string;
  status: ReviewStatus;
  submittedBy: string;
  submittedAt: Date;
  decidedBy: string | null;
  decidedAt: Date | null;
  comment: string | null;
}

/** Review state per version id ("DRAFT" when never submitted → not in the map). */
export async function reviewStates(ids: string[], type: ReviewSubject, db: Db = prisma): Promise<Map<string, ReviewState>> {
  if (!ids.length) return new Map();
  const rows = await db.marketingContentReview.findMany({ where: { subjectType: type, subjectId: { in: ids } } });
  return new Map(
    rows.map((r) => [r.subjectId, { reviewId: r.id, status: r.status as ReviewStatus, submittedBy: r.submittedByUserId, submittedAt: r.submittedAt, decidedBy: r.decidedByUserId, decidedAt: r.decidedAt, comment: r.decisionComment }])
  );
}

export const statusOf = (states: Map<string, ReviewState>, id: string): ReviewStatus => states.get(id)?.status ?? "DRAFT";

/** Submit, withdraw, approve, request changes or reject a version. */
export async function reviewVersion(actor: SalesActor, type: ReviewSubject, id: string, action: ReviewAction, raw: unknown) {
  const def = REVIEW_ACTIONS[action];
  await PermissionService.assert(actor.userId, "marketing_content", def.permission);
  const input = (action === "request_changes" || action === "reject" ? reviewDecisionSchema : reviewActionSchema).parse(raw ?? {});
  if ((action === "request_changes" || action === "reject") && !input.comment) throw new BusinessRuleError("VALIDATION_ERROR", "Say what needs to change.", { fieldErrors: { comment: "Required." } });
  const subject = await loadSubject(actor, type, id);
  const existing = await prisma.marketingContentReview.findUnique({ where: { subjectType_subjectId: { subjectType: type, subjectId: id } } });
  const status: ReviewStatus = (existing?.status as ReviewStatus | undefined) ?? "DRAFT";
  if (!canReview(status, action)) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Can't ${action.replace("_", " ")} a version that is ${status.toLowerCase().replace("_", " ")}.`, { status });
  const deciding = action === "approve" || action === "request_changes" || action === "reject";
  if (deciding && (actor.userId === subject.authorUserId || actor.userId === existing?.submittedByUserId)) {
    throw new BusinessRuleError("SELF_APPROVAL_NOT_ALLOWED", "Someone other than the person who wrote or submitted this version must decide it.");
  }
  if (action === "withdraw" && existing && existing.submittedByUserId !== actor.userId && existing.authorUserId !== actor.userId) {
    throw new BusinessRuleError("PERMISSION_DENIED", "Only the person who submitted it can withdraw it.");
  }
  const now = new Date();
  try {
    return await prisma.$transaction(async (tx) => {
      if (action === "approve") await assertApprovable(tx, actor, subject);
      let reviewId: string;
      if (!existing) {
        const r = await tx.marketingContentReview.create({ data: { companyId: actor.companyId, subjectType: type, subjectId: id, status: "PENDING", authorUserId: subject.authorUserId, submittedByUserId: actor.userId, submittedAt: now } });
        reviewId = r.id;
      } else {
        const data: Prisma.MarketingContentReviewUpdateManyMutationInput =
          action === "submit"
            ? { status: "PENDING", submittedByUserId: actor.userId, submittedAt: now, decidedByUserId: null, decidedAt: null, decisionComment: null, version: { increment: 1 } }
            : action === "withdraw"
              ? { status: "WITHDRAWN", version: { increment: 1 } }
              : { status: def.to, decidedByUserId: actor.userId, decidedAt: now, decisionComment: input.comment ?? null, version: { increment: 1 } };
        const { count } = await tx.marketingContentReview.updateMany({ where: { id: existing.id, status, version: existing.version }, data });
        if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This review was decided or changed just now. Reload.");
        reviewId = existing.id;
      }
      await tx.marketingContentReviewEvent.create({ data: { companyId: actor.companyId, reviewId, action: def.event, comment: input.comment ?? null, actorUserId: actor.userId } });
      if (action === "approve") await afterApproval(tx, subject);
      await auditContent(tx, actor, REVIEWS_TABLE, reviewId, action === "approve" ? "APPROVE" : action === "reject" ? "REJECT" : "UPDATE", { status }, { subjectType: type, subjectId: id, status: def.to, comment: input.comment ?? null });
      if (subject.campaignId) await recordContentCampaignEvent(tx, actor, subject.campaignId, `CONTENT_${def.event}`, input.comment ?? null, { subjectType: type, subjectId: id, label: subject.label });
      if (action === "submit") await notifyContentApprovers(tx, actor, [actor.userId, subject.authorUserId], "Marketing content waits for review", subject.label);
      if (deciding) await notifyContentUsers(tx, actor, [subject.authorUserId, existing?.submittedByUserId ?? null], `${subject.label}: ${def.to.toLowerCase().replace("_", " ")}`, input.comment ?? "");
      return { reviewId, subjectType: type, subjectId: id, status: def.to };
    });
  } catch (e) {
    // Two people submitting the same version at once: one wins.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This version was just submitted by someone else. Reload.");
    throw e;
  }
}

/** History of one version's review. */
export async function reviewHistory(actor: SalesActor, type: ReviewSubject, id: string) {
  await PermissionService.assert(actor.userId, "marketing_content", "view");
  await loadSubject(actor, type, id);
  const r = await prisma.marketingContentReview.findUnique({ where: { subjectType_subjectId: { subjectType: type, subjectId: id } }, include: { events: { orderBy: { createdAt: "asc" } } } });
  if (!r) return { status: "DRAFT" as ReviewStatus, events: [] };
  const names = await userNames(r.events.map((e) => e.actorUserId));
  return {
    status: r.status as ReviewStatus,
    events: r.events.map((e) => ({ id: e.id, action: e.action, comment: e.comment, by: names.get(e.actorUserId) ?? "—", at: e.createdAt.toISOString() })),
  };
}

/** The approver's queue: versions waiting for review (or with another status), newest first. */
export async function listReviews(actor: SalesActor, filter: { status?: string; subjectType?: string }, page = 1, pageSize = 25) {
  await PermissionService.assert(actor.userId, "marketing_content", "view");
  const where: Prisma.MarketingContentReviewWhereInput = {
    companyId: actor.companyId,
    status: filter.status && ["PENDING", "APPROVED", "CHANGES_REQUESTED", "REJECTED", "WITHDRAWN"].includes(filter.status) ? filter.status : "PENDING",
    ...(filter.subjectType && ["ASSET_VERSION", "TEMPLATE_VERSION", "CONTENT_VERSION"].includes(filter.subjectType) ? { subjectType: filter.subjectType } : {}),
  };
  const [total, rows] = await Promise.all([prisma.marketingContentReview.count({ where }), prisma.marketingContentReview.findMany({ where, orderBy: { submittedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize })]);
  const names = await userNames(rows.flatMap((r) => [r.submittedByUserId, r.decidedByUserId, r.authorUserId]));
  const data = [];
  for (const r of rows) {
    const s = await loadSubject(actor, r.subjectType as ReviewSubject, r.subjectId).catch(() => null);
    if (!s) continue; // e.g. content of a campaign this user can't see
    data.push({
      id: r.id,
      subjectType: r.subjectType,
      subjectId: r.subjectId,
      label: s.label,
      href: await subjectHref(s),
      status: r.status,
      author: names.get(r.authorUserId) ?? "—",
      submittedBy: names.get(r.submittedByUserId) ?? "—",
      submittedAt: r.submittedAt.toISOString(),
      decidedBy: r.decidedByUserId ? (names.get(r.decidedByUserId) ?? "—") : null,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      comment: r.decisionComment,
      mine: r.authorUserId === actor.userId || r.submittedByUserId === actor.userId,
    });
  }
  return { data, meta: { page, pageSize, totalCount: total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
}

async function subjectHref(s: Subject) {
  if (s.type === "ASSET_VERSION") {
    const v = await prisma.marketingAssetVersion.findUnique({ where: { id: s.id }, select: { assetId: true } });
    return `/sales-marketing/content/assets/${v?.assetId}`;
  }
  if (s.type === "TEMPLATE_VERSION") {
    const v = await prisma.crmMessageTemplateVersion.findUnique({ where: { id: s.id }, select: { templateId: true } });
    return `/sales-marketing/content/templates/${v?.templateId}`;
  }
  const v = await prisma.marketingCampaignContentVersion.findUnique({ where: { id: s.id }, select: { contentId: true } });
  return `/sales-marketing/content/items/${v?.contentId}`;
}
