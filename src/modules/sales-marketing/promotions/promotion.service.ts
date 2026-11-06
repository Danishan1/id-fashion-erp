import { Prisma, type MarketingPromotion, type MarketingPromotionVersion } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/core/db/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { createNotification } from "@/core/notifications/NotificationService";
import { PermissionService } from "@/core/rbac/PermissionService";
import { toIsoDate, todayIsoDate } from "@/lib/date";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { usageCount } from "./promotion-eligibility";
import {
  PROMOTION_ACTIONS,
  canPromotionMove,
  displayStatus,
  promotionCreateSchema,
  promotionHeaderSchema,
  promotionTermsSchema,
  type PromotionAction,
  type PromotionTerms,
} from "./promotion-registry";

/**
 * Promotions (Sales & Marketing Phase 12). Header (code, applies automatically
 * or by code, on / paused / archived) + numbered versions holding the terms.
 * A version is edited only as a draft, submitted, and approved by someone
 * other than who prepared or submitted it; once approved it never changes
 * (a database trigger refuses it) — a change is a new version. Approving
 * doesn't switch a promotion on: "Switch on" is its own step. History goes to
 * pricing_events (entity PROMOTION) next to price lists and discount rules.
 */

const TABLE = "marketing_promotions";
const VERSION_TABLE = "marketing_promotion_versions";
type Tx = Prisma.TransactionClient;

const reasonSchema = z.object({ reason: z.string().trim().min(3, "Say why").max(1000) }).strict();
const commentSchema = z.object({ comment: z.string().trim().max(1000).optional().or(z.literal("")).nullable() }).strict();
export const headerUpdateSchema = promotionHeaderSchema.extend({ version: z.coerce.number().int() }).strict();
export const listQuerySchema = z.object({ status: z.string().optional(), search: z.string().trim().max(100).optional(), campaignId: z.string().uuid().optional() }).strict();

function event(tx: Tx, actor: SalesActor, promotionId: string, type: string, versionNumber: number | null = null, comment: string | null = null, metadata: Record<string, unknown> = {}) {
  return tx.pricingEvent.create({
    data: { companyId: actor.companyId, entityType: "PROMOTION", entityId: promotionId, versionNumber, type, comment, metadata: metadata as Prisma.InputJsonValue, createdByUserId: actor.userId },
  });
}

async function audit(tx: Tx, actor: SalesActor, tableName: string, recordId: string, action: "CREATE" | "UPDATE" | "APPROVE" | "REJECT", oldValues: unknown, newValues: unknown) {
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName, recordId, action, oldValues: oldValues as Record<string, unknown>, newValues: newValues as Record<string, unknown> }, tx);
}

async function loadPromotion(actor: SalesActor, id: string) {
  const p = await prisma.marketingPromotion.findFirst({ where: { id, companyId: actor.companyId } });
  if (!p) throw new BusinessRuleError("NOT_FOUND", "Promotion not found.", { id });
  return p;
}

async function loadVersion(actor: SalesActor, p: MarketingPromotion, versionId: string) {
  const v = await prisma.marketingPromotionVersion.findFirst({ where: { id: versionId, promotionId: p.id, companyId: actor.companyId } });
  if (!v) throw new BusinessRuleError("NOT_FOUND", "Promotion version not found.", { versionId });
  return v;
}

const notArchived = (p: MarketingPromotion) => {
  if (p.status === "ARCHIVED") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This promotion is archived — nothing about it can change.");
};

/** Approver: `approve`, and not whoever prepared, last saved or submitted the version (Super Admin excepted). */
async function canApprove(userId: string, v: Pick<MarketingPromotionVersion, "createdByUserId" | "updatedByUserId" | "submittedByUserId">) {
  const people = [...new Set([v.createdByUserId, v.updatedByUserId, v.submittedByUserId].filter((x): x is string => Boolean(x)))];
  if (!people.length) return PermissionService.can(userId, "marketing_promotions", "approve");
  for (const createdBy of people) if (!(await PermissionService.can(userId, "marketing_promotions", "approve", { createdBy }))) return false;
  return true;
}

// ── Terms validation (against the company's data) ────────────────

async function validateTerms(actor: SalesActor, t: PromotionTerms) {
  const cid = actor.companyId;
  const count = async (n: Promise<number>, ids: string[], field: string, what: string) => {
    if (ids.length && (await n) !== ids.length) throw new BusinessRuleError("VALIDATION_ERROR", `One or more ${what} weren't found.`, { fieldErrors: { [field]: "Not found." } });
  };
  await Promise.all([
    count(prisma.product.count({ where: { id: { in: t.productIds }, companyId: cid, itemType: "STYLE", deletedAt: null } }), t.productIds, "productIds", "Styles"),
    count(prisma.product.count({ where: { id: { in: t.excludedProductIds }, companyId: cid, itemType: "STYLE", deletedAt: null } }), t.excludedProductIds, "excludedProductIds", "excluded Styles"),
    count(prisma.category.count({ where: { id: { in: t.categoryIds }, companyId: cid } }), t.categoryIds, "categoryIds", "categories"),
    count(prisma.customer.count({ where: { id: { in: t.customerIds }, companyId: cid, deletedAt: null } }), t.customerIds, "customerIds", "customers"),
    count(prisma.priceList.count({ where: { id: { in: t.priceListIds }, companyId: cid } }), t.priceListIds, "priceListIds", "price lists"),
    count(prisma.salesChannel.count({ where: { id: { in: t.salesChannelIds }, companyId: cid } }), t.salesChannelIds, "salesChannelIds", "sales channels"),
    count(prisma.marketingCampaign.count({ where: { id: { in: t.campaignIds }, companyId: cid } }), t.campaignIds, "campaignIds", "campaigns"),
  ]);
  if (!t.segmentEvaluationId) return { segmentId: null };
  const ev = await prisma.marketingSegmentEvaluation.findFirst({
    where: { id: t.segmentEvaluationId, companyId: cid },
    select: { status: true, entriesPurgedAt: true, segmentId: true, segment: { select: { sourceType: true } } },
  });
  if (!ev) throw new BusinessRuleError("VALIDATION_ERROR", "Segment snapshot not found.", { fieldErrors: { segmentEvaluationId: "Not found." } });
  if (ev.segment.sourceType !== "CUSTOMER") throw new BusinessRuleError("VALIDATION_ERROR", "Only a segment of ERP customers can decide who gets a promotion.", { fieldErrors: { segmentEvaluationId: "Not a customer segment." } });
  if (!["COMPLETED", "SUPERSEDED"].includes(ev.status) || ev.entriesPurgedAt) throw new BusinessRuleError("VALIDATION_ERROR", "Pick a completed snapshot whose member list is still kept.", { fieldErrors: { segmentEvaluationId: "Not usable." } });
  return { segmentId: ev.segmentId };
}

const termsData = (t: PromotionTerms, segmentId: string | null) => ({
  validFrom: new Date(t.validFrom),
  validTo: t.validTo ? new Date(t.validTo) : null,
  discountType: t.discountType,
  value: new Prisma.Decimal(t.value),
  stacking: t.stacking,
  priority: t.priority ?? 0,
  productIds: t.productIds,
  categoryIds: t.categoryIds,
  excludedProductIds: t.excludedProductIds,
  customerIds: t.customerIds,
  priceListIds: t.priceListIds,
  salesChannelIds: t.salesChannelIds,
  campaignIds: t.campaignIds,
  segmentId,
  segmentEvaluationId: t.segmentEvaluationId ?? null,
  minQuantity: t.minQuantity === null ? null : new Prisma.Decimal(t.minQuantity),
  minLineValue: t.minLineValue === null ? null : new Prisma.Decimal(t.minLineValue),
  maxRedemptions: t.maxRedemptions,
  maxRedemptionsPerCustomer: t.maxRedemptionsPerCustomer,
  changeNote: t.changeNote || null,
});

/** A stored version as an editor payload. */
export function termsOf(v: MarketingPromotionVersion) {
  return {
    validFrom: toIsoDate(v.validFrom),
    validTo: v.validTo ? toIsoDate(v.validTo) : null,
    discountType: v.discountType as PromotionTerms["discountType"],
    value: Number(v.value),
    stacking: v.stacking as PromotionTerms["stacking"],
    priority: v.priority,
    productIds: v.productIds,
    categoryIds: v.categoryIds,
    excludedProductIds: v.excludedProductIds,
    customerIds: v.customerIds,
    priceListIds: v.priceListIds,
    salesChannelIds: v.salesChannelIds,
    campaignIds: v.campaignIds,
    segmentEvaluationId: v.segmentEvaluationId,
    minQuantity: v.minQuantity === null ? null : Number(v.minQuantity),
    minLineValue: v.minLineValue === null ? null : Number(v.minLineValue),
    maxRedemptions: v.maxRedemptions,
    maxRedemptionsPerCustomer: v.maxRedemptionsPerCustomer,
    changeNote: v.changeNote,
  };
}

// ── List / detail ────────────────────────────────────────────────

async function usageByPromotion(companyId: string, ids: string[]) {
  if (!ids.length) return new Map<string, { reserved: number; redeemed: number; discountRedeemed: number }>();
  const today = new Date(`${todayIsoDate()}T00:00:00Z`);
  const rows = await prisma.marketingPromotionRedemption.groupBy({
    by: ["promotionId", "status"],
    where: { companyId, promotionId: { in: ids }, OR: [{ status: "REDEEMED" }, { status: "RESERVED", expiresOn: { gte: today } }] },
    _count: { _all: true },
    _sum: { discountAmount: true },
  });
  const out = new Map<string, { reserved: number; redeemed: number; discountRedeemed: number }>();
  for (const id of ids) out.set(id, { reserved: 0, redeemed: 0, discountRedeemed: 0 });
  for (const r of rows) {
    const u = out.get(r.promotionId)!;
    if (r.status === "RESERVED") u.reserved = r._count._all;
    else {
      u.redeemed = r._count._all;
      u.discountRedeemed = Math.round(Number(r._sum.discountAmount ?? 0) * 100) / 100;
    }
  }
  return out;
}

/**
 * The list's filter → where (also used by bulk "all matching the filter",
 * Phase 14). The derived SCHEDULED / EXPIRED statuses are expressed on the
 * approved version's dates here, so the database answers them directly.
 */
export function buildPromotionListWhere(actor: SalesActor, q: z.infer<typeof listQuerySchema>, today: string): Prisma.MarketingPromotionWhereInput {
  const day = new Date(`${today}T00:00:00Z`);
  const status: Prisma.MarketingPromotionWhereInput =
    q.status && ["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"].includes(q.status)
      ? { status: q.status as MarketingPromotion["status"] }
      : q.status === "SCHEDULED"
        ? { status: "ACTIVE", approvedVersion: { validFrom: { gt: day } } }
        : q.status === "EXPIRED"
          ? { status: "ACTIVE", approvedVersion: { validTo: { lt: day } } }
          : q.status
            ? {}
            : { status: { not: "ARCHIVED" } };
  return {
    companyId: actor.companyId,
    ...status,
    ...(q.search ? { OR: [{ code: { contains: q.search, mode: "insensitive" } }, { name: { contains: q.search, mode: "insensitive" } }] } : {}),
    ...(q.campaignId ? { approvedVersion: { ...(status.approvedVersion as object | undefined), campaignIds: { has: q.campaignId } } } : {}),
  };
}

export async function listPromotions(actor: SalesActor, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_promotions", "view");
  const q = listQuerySchema.parse(raw ?? {});
  const today = todayIsoDate();
  const rows = await prisma.marketingPromotion.findMany({
    where: buildPromotionListWhere(actor, { ...q, status: q.status === "SCHEDULED" || q.status === "EXPIRED" ? undefined : q.status }, today),
    orderBy: [{ updatedAt: "desc" }],
    take: 500,
    include: { approvedVersion: true, owner: { select: { fullName: true } }, versions: { where: { status: { in: ["DRAFT", "PENDING_APPROVAL"] } }, select: { status: true, versionNumber: true } } },
  });
  const usage = await usageByPromotion(actor.companyId, rows.map((r) => r.id));
  const list = rows.map((p) => {
    const v = p.approvedVersion;
    const approved = v ? { validFrom: toIsoDate(v.validFrom), validTo: v.validTo ? toIsoDate(v.validTo) : null } : null;
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      applyMode: p.applyMode,
      status: p.status,
      displayStatus: displayStatus(p.status, approved, today),
      owner: p.owner.fullName,
      approvedVersion: v ? { number: v.versionNumber, discountType: v.discountType, value: Number(v.value), stacking: v.stacking, ...approved, maxRedemptions: v.maxRedemptions } : null,
      openVersion: p.versions[0] ? { number: p.versions[0].versionNumber, status: p.versions[0].status } : null,
      usage: usage.get(p.id)!,
    };
  });
  // SCHEDULED / EXPIRED / RUNNING are derived — filter them after computing.
  return q.status && ["SCHEDULED", "EXPIRED"].includes(q.status) ? list.filter((r) => r.displayStatus === q.status) : list;
}

async function names(companyId: string, versions: MarketingPromotionVersion[]) {
  const all = (k: keyof MarketingPromotionVersion) => [...new Set(versions.flatMap((v) => v[k] as string[]))];
  const [products, categories, customers, priceLists, channels, campaigns, evaluations] = await Promise.all([
    prisma.product.findMany({ where: { companyId, id: { in: [...all("productIds"), ...all("excludedProductIds")] } }, select: { id: true, styleCode: true, styleName: true } }),
    prisma.category.findMany({ where: { companyId, id: { in: all("categoryIds") } }, select: { id: true, name: true } }),
    prisma.customer.findMany({ where: { companyId, id: { in: all("customerIds") } }, select: { id: true, name: true } }),
    prisma.priceList.findMany({ where: { companyId, id: { in: all("priceListIds") } }, select: { id: true, name: true } }),
    prisma.salesChannel.findMany({ where: { companyId, id: { in: all("salesChannelIds") } }, select: { id: true, name: true } }),
    prisma.marketingCampaign.findMany({ where: { companyId, id: { in: all("campaignIds") } }, select: { id: true, code: true, name: true } }),
    prisma.marketingSegmentEvaluation.findMany({
      where: { companyId, id: { in: versions.map((v) => v.segmentEvaluationId).filter((x): x is string => Boolean(x)) } },
      select: { id: true, finishedAt: true, memberCount: true, entriesPurgedAt: true, segment: { select: { code: true, name: true } } },
    }),
  ]);
  const map: Record<string, string> = {};
  for (const p of products) map[p.id] = `${p.styleCode} · ${p.styleName}`;
  for (const x of [...categories, ...customers, ...priceLists, ...channels]) map[x.id] = x.name;
  for (const c of campaigns) map[c.id] = `${c.code} · ${c.name}`;
  for (const e of evaluations) map[e.id] = `${e.segment.code} · ${e.segment.name} (snapshot ${e.finishedAt ? toIsoDate(e.finishedAt) : "?"}, ${e.memberCount ?? 0} members${e.entriesPurgedAt ? " — member list removed, no customer qualifies" : ""})`;
  return map;
}

export async function getPromotion(actor: SalesActor, id: string) {
  await PermissionService.assert(actor.userId, "marketing_promotions", "view");
  const p = await prisma.marketingPromotion.findFirst({
    where: { id, companyId: actor.companyId },
    include: {
      owner: { select: { id: true, fullName: true } },
      versions: { orderBy: { versionNumber: "desc" } },
      redemptions: { orderBy: { reservedAt: "desc" }, take: 100 },
    },
  });
  if (!p) throw new BusinessRuleError("NOT_FOUND", "Promotion not found.", { id });
  const userIds = [...new Set(p.versions.flatMap((v) => [v.createdByUserId, v.submittedByUserId, v.decidedByUserId]).filter((x): x is string => Boolean(x)))];
  const [users, events, labels, quotations, customers, orders, usage, perms] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } }),
    prisma.pricingEvent.findMany({ where: { companyId: actor.companyId, entityType: "PROMOTION", entityId: p.id }, orderBy: { createdAt: "desc" }, take: 200, include: { createdBy: { select: { fullName: true } } } }),
    names(actor.companyId, p.versions),
    prisma.quotation.findMany({ where: { id: { in: p.redemptions.map((r) => r.quotationId) } }, select: { id: true, quotationNumber: true, prospectName: true } }),
    prisma.customer.findMany({ where: { id: { in: p.redemptions.map((r) => r.customerId).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } }),
    prisma.salesOrder.findMany({ where: { id: { in: p.redemptions.map((r) => r.salesOrderId).filter((x): x is string => Boolean(x)) } }, select: { id: true, orderNumber: true } }),
    usageByPromotion(actor.companyId, [p.id]),
    Promise.all((["create", "edit", "approve", "reject"] as const).map((a) => PermissionService.can(actor.userId, "marketing_promotions", a))),
  ]);
  const userName = new Map(users.map((u) => [u.id, u.fullName]));
  const [canCreate, canEdit, canApproveAny, canReject] = perms;
  const approved = p.versions.find((v) => v.id === p.approvedVersionId) ?? null;
  const today = todayIsoDate();
  const versions = await Promise.all(
    p.versions.map(async (v) => ({
      id: v.id,
      number: v.versionNumber,
      status: v.status,
      terms: termsOf(v),
      createdBy: userName.get(v.createdByUserId) ?? "—",
      createdAt: v.createdAt.toISOString(),
      submittedBy: v.submittedByUserId ? (userName.get(v.submittedByUserId) ?? "—") : null,
      submittedAt: v.submittedAt?.toISOString() ?? null,
      decidedBy: v.decidedByUserId ? (userName.get(v.decidedByUserId) ?? "—") : null,
      decidedAt: v.decidedAt?.toISOString() ?? null,
      decisionComment: v.decisionComment,
      canApproveThis: v.status === "PENDING_APPROVAL" && p.status !== "ARCHIVED" && (await canApprove(actor.userId, v)),
    }))
  );
  const qn = new Map(quotations.map((q) => [q.id, q]));
  const cn = new Map(customers.map((c) => [c.id, c.name]));
  const on = new Map(orders.map((o) => [o.id, o.orderNumber]));
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    description: p.description,
    objective: p.objective,
    owner: p.owner,
    applyMode: p.applyMode,
    status: p.status,
    version: p.version,
    displayStatus: displayStatus(p.status, approved ? { validFrom: toIsoDate(approved.validFrom), validTo: approved.validTo ? toIsoDate(approved.validTo) : null } : null, today),
    approvedVersionId: p.approvedVersionId,
    versions,
    labels,
    usage: usage.get(p.id)!,
    redemptions: p.redemptions.map((r) => ({
      id: r.id,
      status: r.status,
      quotationId: r.quotationId,
      quotationNumber: qn.get(r.quotationId)?.quotationNumber ?? "—",
      customer: r.customerId ? (cn.get(r.customerId) ?? "—") : (qn.get(r.quotationId)?.prospectName ?? "Prospect"),
      versionNumber: p.versions.find((v) => v.id === r.promotionVersionId)?.versionNumber ?? null,
      discount: Number(r.discountAmount),
      expiresOn: toIsoDate(r.expiresOn) === "9999-12-31" ? null : toIsoDate(r.expiresOn),
      reservedAt: r.reservedAt.toISOString(),
      salesOrderId: r.salesOrderId,
      salesOrderNumber: r.salesOrderId ? (on.get(r.salesOrderId) ?? null) : null,
      releaseReason: r.releaseReason,
    })),
    events: events.map((e) => ({ id: e.id, type: e.type, versionNumber: e.versionNumber, comment: e.comment, metadata: e.metadata, at: e.createdAt.toISOString(), by: e.createdBy.fullName })),
    can: {
      edit: canEdit && p.status !== "ARCHIVED",
      newVersion: (canCreate || canEdit) && p.status !== "ARCHIVED" && !p.versions.some((v) => v.status === "DRAFT" || v.status === "PENDING_APPROVAL"),
      reject: canReject,
      approve: canApproveAny,
      activate: canApproveAny && canPromotionMove(p.status, "activate") && Boolean(p.approvedVersionId),
      pause: canEdit && canPromotionMove(p.status, "pause"),
      archive: canEdit && canPromotionMove(p.status, "archive"),
    },
  };
}

// ── Create / edit ────────────────────────────────────────────────

export async function createPromotion(actor: SalesActor, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_promotions", "create");
  const input = promotionCreateSchema.parse(raw);
  const { segmentId } = await validateTerms(actor, input.terms);
  const ownerUserId = input.ownerUserId ?? actor.userId;
  if (input.ownerUserId && !(await prisma.user.findFirst({ where: { id: ownerUserId, companyId: actor.companyId, status: "ACTIVE" }, select: { id: true } }))) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Owner not found.", { fieldErrors: { ownerUserId: "Not found." } });
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const p = await tx.marketingPromotion.create({
        data: { companyId: actor.companyId, code: input.code, name: input.name, description: input.description || null, objective: input.objective || null, ownerUserId, applyMode: input.applyMode, status: "DRAFT", createdByUserId: actor.userId },
      });
      const v = await tx.marketingPromotionVersion.create({ data: { companyId: actor.companyId, promotionId: p.id, versionNumber: 1, status: "DRAFT", ...termsData(input.terms, segmentId), createdByUserId: actor.userId } });
      await event(tx, actor, p.id, "CREATED", 1);
      await audit(tx, actor, TABLE, p.id, "CREATE", null, { code: p.code, name: p.name, applyMode: p.applyMode });
      await audit(tx, actor, VERSION_TABLE, v.id, "CREATE", null, { versionNumber: 1, ...input.terms });
      return { id: p.id };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new BusinessRuleError("VALIDATION_ERROR", "A promotion with this code already exists.", { fieldErrors: { code: "Already used." } });
    throw e;
  }
}

export async function updatePromotionHeader(actor: SalesActor, id: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_promotions", "edit");
  const input = headerUpdateSchema.parse(raw);
  const p = await loadPromotion(actor, id);
  notArchived(p);
  if (p.version !== input.version) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "Someone else saved this promotion after you opened it. Reload.");
  if (input.ownerUserId && !(await prisma.user.findFirst({ where: { id: input.ownerUserId, companyId: actor.companyId, status: "ACTIVE" }, select: { id: true } }))) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Owner not found.", { fieldErrors: { ownerUserId: "Not found." } });
  }
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.marketingPromotion.updateMany({
      where: { id: p.id, version: p.version, status: { not: "ARCHIVED" } },
      data: { name: input.name, description: input.description || null, objective: input.objective || null, ...(input.ownerUserId ? { ownerUserId: input.ownerUserId } : {}), updatedByUserId: actor.userId, version: { increment: 1 } },
    });
    if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This promotion changed just now. Reload and try again.");
    await event(tx, actor, p.id, "HEADER_UPDATED");
    await audit(tx, actor, TABLE, p.id, "UPDATE", { name: p.name, description: p.description, objective: p.objective, ownerUserId: p.ownerUserId }, input);
  });
  return { id };
}

/** Saves a DRAFT version's terms (the only version state that can be edited). */
export async function saveVersionTerms(actor: SalesActor, id: string, versionId: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_promotions", "edit");
  const terms = promotionTermsSchema.parse(raw);
  const p = await loadPromotion(actor, id);
  notArchived(p);
  const v = await loadVersion(actor, p, versionId);
  if (v.status !== "DRAFT") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Only a draft version can be edited. Make a new version to change approved terms.");
  const { segmentId } = await validateTerms(actor, terms);
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.marketingPromotionVersion.updateMany({ where: { id: v.id, status: "DRAFT", updatedAt: v.updatedAt }, data: { ...termsData(terms, segmentId), updatedByUserId: actor.userId } });
    if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This version changed just now. Reload and try again.");
    await event(tx, actor, p.id, "VERSION_SAVED", v.versionNumber);
    await audit(tx, actor, VERSION_TABLE, v.id, "UPDATE", termsOf(v), terms);
  });
  return { id };
}

/** Starts version n+1 as a draft copy of the latest one (one open version at a time). */
export async function newVersion(actor: SalesActor, id: string) {
  if (!(await PermissionService.can(actor.userId, "marketing_promotions", "edit"))) await PermissionService.assert(actor.userId, "marketing_promotions", "create");
  const p = await loadPromotion(actor, id);
  notArchived(p);
  const latest = await prisma.marketingPromotionVersion.findFirstOrThrow({ where: { promotionId: p.id }, orderBy: { versionNumber: "desc" } });
  try {
    await prisma.$transaction(async (tx) => {
      const next = p.currentVersionNumber + 1;
      const { count } = await tx.marketingPromotion.updateMany({ where: { id: p.id, currentVersionNumber: p.currentVersionNumber }, data: { currentVersionNumber: next, updatedByUserId: actor.userId, version: { increment: 1 } } });
      if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This promotion changed just now. Reload and try again.");
      const t = termsOf(latest);
      await tx.marketingPromotionVersion.create({
        data: { companyId: actor.companyId, promotionId: p.id, versionNumber: next, status: "DRAFT", ...termsData({ ...t, changeNote: null } as PromotionTerms, latest.segmentId), createdByUserId: actor.userId },
      });
      await event(tx, actor, p.id, "VERSION_CREATED", next, null, { from: latest.versionNumber });
    });
  } catch (e) {
    // marketing_promotion_versions_one_open: a draft / pending version already exists.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This promotion already has a version being prepared or approved. Finish that one first.");
    throw e;
  }
  return { id };
}

async function moveVersion(tx: Tx, v: MarketingPromotionVersion, data: Prisma.MarketingPromotionVersionUncheckedUpdateManyInput) {
  const { count } = await tx.marketingPromotionVersion.updateMany({ where: { id: v.id, status: v.status, updatedAt: v.updatedAt }, data });
  if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This version changed just now. Reload and try again.");
}

async function notifyApprovers(tx: Tx, actor: SalesActor, exclude: (string | null)[], title: string, body: string) {
  const users = await prisma.user.findMany({ where: { companyId: actor.companyId, status: "ACTIVE", supportForPlatformUserId: null }, select: { id: true } });
  const ok = await Promise.all(users.map((u) => PermissionService.can(u.id, "marketing_promotions", "approve")));
  for (const u of users.filter((x, i) => ok[i] && !exclude.includes(x.id))) await createNotification({ companyId: actor.companyId, userId: u.id, title, body }, tx);
}

export async function submitVersion(actor: SalesActor, id: string, versionId: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_promotions", "edit");
  const { comment } = commentSchema.parse(raw ?? {});
  const p = await loadPromotion(actor, id);
  notArchived(p);
  const v = await loadVersion(actor, p, versionId);
  if (v.status !== "DRAFT") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Only a draft version can be submitted.");
  // The stored terms are checked again — referenced records may have gone since the draft was saved.
  const terms = promotionTermsSchema.parse(termsOf(v));
  await validateTerms(actor, terms);
  await prisma.$transaction(async (tx) => {
    await moveVersion(tx, v, { status: "PENDING_APPROVAL", submittedByUserId: actor.userId, submittedAt: new Date() });
    await event(tx, actor, p.id, "SUBMITTED", v.versionNumber, comment || null);
    await audit(tx, actor, VERSION_TABLE, v.id, "UPDATE", { status: "DRAFT" }, { status: "PENDING_APPROVAL" });
    await notifyApprovers(tx, actor, [actor.userId, v.createdByUserId], `Promotion ${p.code} v${v.versionNumber} needs approval`, comment || p.name);
  });
  return { id };
}

/** Pending → draft again, by whoever submitted it or an approver (e.g. to correct it before a decision). */
export async function returnVersionToDraft(actor: SalesActor, id: string, versionId: string, raw: unknown) {
  const { comment } = commentSchema.parse(raw ?? {});
  const p = await loadPromotion(actor, id);
  const v = await loadVersion(actor, p, versionId);
  if (v.status !== "PENDING_APPROVAL") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Only a version waiting for approval can go back to draft.");
  if (v.submittedByUserId !== actor.userId) await PermissionService.assert(actor.userId, "marketing_promotions", "approve");
  else await PermissionService.assert(actor.userId, "marketing_promotions", "edit");
  await prisma.$transaction(async (tx) => {
    await moveVersion(tx, v, { status: "DRAFT", submittedByUserId: null, submittedAt: null });
    await event(tx, actor, p.id, "RETURNED_TO_DRAFT", v.versionNumber, comment || null);
    await audit(tx, actor, VERSION_TABLE, v.id, "UPDATE", { status: "PENDING_APPROVAL" }, { status: "DRAFT" });
  });
  return { id };
}

export async function approveVersion(actor: SalesActor, id: string, versionId: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_promotions", "approve");
  const { comment } = commentSchema.parse(raw ?? {});
  const p0 = await loadPromotion(actor, id);
  notArchived(p0);
  const v = await loadVersion(actor, p0, versionId);
  if (v.status !== "PENDING_APPROVAL") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Only a version waiting for approval can be approved.");
  if (!(await canApprove(actor.userId, v))) throw new BusinessRuleError("SELF_APPROVAL_NOT_ALLOWED", "Someone other than the person who prepared or submitted this version must approve it.");
  await prisma.$transaction(async (tx) => {
    // Lock the promotion so reservations (which also lock it) see either the old or the new terms, never a mix.
    await tx.$queryRaw`SELECT id FROM marketing_promotions WHERE id = ${p0.id}::uuid FOR UPDATE`;
    const p = await tx.marketingPromotion.findUniqueOrThrow({ where: { id: p0.id } });
    if (p.status === "ARCHIVED") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This promotion was archived just now.");
    await moveVersion(tx, v, { status: "APPROVED", decidedByUserId: actor.userId, decidedAt: new Date(), decisionComment: comment || null });
    if (p.approvedVersionId) await tx.marketingPromotionVersion.update({ where: { id: p.approvedVersionId }, data: { status: "SUPERSEDED" } });
    await tx.marketingPromotion.update({ where: { id: p.id }, data: { approvedVersionId: v.id, updatedByUserId: actor.userId, version: { increment: 1 } } });
    await event(tx, actor, p.id, "APPROVED", v.versionNumber, comment || null, { supersedes: p.approvedVersionId });
    await audit(tx, actor, VERSION_TABLE, v.id, "APPROVE", { status: "PENDING_APPROVAL" }, { status: "APPROVED", supersedes: p.approvedVersionId });
    const notify = [...new Set([v.submittedByUserId, v.createdByUserId, p.ownerUserId].filter((x): x is string => Boolean(x) && x !== actor.userId))];
    const tail = p.status === "ACTIVE" ? "It applies to new prices from now." : "Switch the promotion on when it should start applying.";
    for (const userId of notify) await createNotification({ companyId: actor.companyId, userId, title: `Promotion ${p.code} v${v.versionNumber} approved`, body: tail }, tx);
  });
  return { id };
}

export async function rejectVersion(actor: SalesActor, id: string, versionId: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_promotions", "reject");
  const { reason } = reasonSchema.parse(raw ?? {});
  const p = await loadPromotion(actor, id);
  const v = await loadVersion(actor, p, versionId);
  if (v.status !== "PENDING_APPROVAL") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Only a version waiting for approval can be rejected.");
  if ([v.createdByUserId, v.submittedByUserId].includes(actor.userId)) throw new BusinessRuleError("SELF_APPROVAL_NOT_ALLOWED", "You prepared or submitted this version — someone else must decide on it. Return it to draft instead.");
  await prisma.$transaction(async (tx) => {
    await moveVersion(tx, v, { status: "REJECTED", decidedByUserId: actor.userId, decidedAt: new Date(), decisionComment: reason });
    await event(tx, actor, p.id, "REJECTED", v.versionNumber, reason);
    await audit(tx, actor, VERSION_TABLE, v.id, "REJECT", { status: "PENDING_APPROVAL" }, { status: "REJECTED", reason });
    for (const userId of new Set([v.submittedByUserId, v.createdByUserId].filter((x): x is string => Boolean(x)))) {
      await createNotification({ companyId: actor.companyId, userId, title: `Promotion ${p.code} v${v.versionNumber} rejected`, body: reason }, tx);
    }
  });
  return { id };
}

// ── Header lifecycle ─────────────────────────────────────────────

const ACTION_PERMISSION: Record<PromotionAction, "approve" | "edit"> = { activate: "approve", pause: "edit", archive: "edit" };

/**
 * Switch on (needs an approved version; an approver's decision), pause, archive.
 * Pausing / archiving stops new prices only: quotations already issued keep
 * their prices and their reservations run their course.
 */
/** The rules of a status action, without changing anything (Phase 14 bulk dry run). */
export async function checkPromotionAction(actor: SalesActor, id: string, actionRaw: string) {
  const action = z.enum(Object.keys(PROMOTION_ACTIONS) as [PromotionAction, ...PromotionAction[]]).parse(actionRaw);
  await PermissionService.assert(actor.userId, "marketing_promotions", ACTION_PERMISSION[action]);
  const p = await loadPromotion(actor, id);
  const def = PROMOTION_ACTIONS[action];
  if (!canPromotionMove(p.status, action)) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `A ${p.status.toLowerCase()} promotion can't be ${def.label.toLowerCase()}d.`, { status: p.status });
  if (action === "activate" && !p.approvedVersionId) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Approve a version first — a promotion without approved terms can't be switched on.");
  return { action, p, def };
}

export async function promotionAction(actor: SalesActor, id: string, actionRaw: string, raw: unknown) {
  const { comment } = commentSchema.parse(raw ?? {});
  const { action, p, def } = await checkPromotionAction(actor, id, actionRaw);
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.marketingPromotion.updateMany({
      where: { id: p.id, status: p.status, version: p.version },
      data: { status: def.to, ...(action === "archive" ? { archivedAt: new Date() } : {}), updatedByUserId: actor.userId, version: { increment: 1 } },
    });
    if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This promotion changed just now. Reload and try again.");
    await event(tx, actor, p.id, action.toUpperCase(), null, comment || null, { from: p.status, to: def.to });
    await audit(tx, actor, TABLE, p.id, "UPDATE", { status: p.status }, { status: def.to, comment: comment || null });
  });
  return { id };
}

// ── For other screens ────────────────────────────────────────────

/** Promotions whose approved terms name the campaign (campaign page). Read-only. */
export async function promotionsForCampaign(actor: SalesActor, campaignId: string) {
  if (!(await PermissionService.can(actor.userId, "marketing_promotions", "view"))) return null;
  return listPromotions(actor, { campaignId, status: undefined });
}

/** Current usage against the limits (the eligibility check uses the same count). */
export async function promotionUsage(companyId: string, promotionId: string, customerId?: string | null) {
  return usageCount(prisma, promotionId, customerId === undefined ? {} : { customerId });
}

/** Choices for the terms editor: Styles, categories, customers, price lists, channels, campaigns, customer-segment snapshots, owners. */
export async function promotionFormOptions(actor: SalesActor) {
  await PermissionService.assert(actor.userId, "marketing_promotions", "view");
  const cid = actor.companyId;
  const [styles, categories, customers, priceLists, channels, campaigns, snapshots, users] = await Promise.all([
    prisma.product.findMany({ where: { companyId: cid, itemType: "STYLE", deletedAt: null, isActive: true }, select: { id: true, styleCode: true, styleName: true }, orderBy: { styleName: "asc" }, take: 2000 }),
    prisma.category.findMany({ where: { companyId: cid, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.customer.findMany({ where: { companyId: cid, deletedAt: null, isActive: true }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" }, take: 2000 }),
    prisma.priceList.findMany({ where: { companyId: cid }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" } }),
    prisma.salesChannel.findMany({ where: { companyId: cid, isActive: true }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" } }),
    prisma.marketingCampaign.findMany({ where: { companyId: cid, status: { notIn: ["CANCELLED", "COMPLETED"] } }, select: { id: true, code: true, name: true }, orderBy: { plannedStartDate: "desc" }, take: 500 }),
    prisma.marketingSegmentEvaluation.findMany({
      where: { companyId: cid, status: { in: ["COMPLETED", "SUPERSEDED"] }, entriesPurgedAt: null, segment: { sourceType: "CUSTOMER" } },
      select: { id: true, finishedAt: true, memberCount: true, status: true, segment: { select: { code: true, name: true } } },
      orderBy: { finishedAt: "desc" },
      take: 200,
    }),
    prisma.user.findMany({ where: { companyId: cid, status: "ACTIVE", supportForPlatformUserId: null }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
  ]);
  return {
    styles: styles.map((s) => ({ id: s.id, label: s.styleName, sublabel: s.styleCode })),
    categories: categories.map((c) => ({ id: c.id, label: c.name })),
    customers: customers.map((c) => ({ id: c.id, label: c.name, sublabel: c.code })),
    priceLists: priceLists.map((p) => ({ id: p.id, label: p.name, sublabel: p.code })),
    salesChannels: channels.map((c) => ({ id: c.id, label: c.name, sublabel: c.code })),
    campaigns: campaigns.map((c) => ({ id: c.id, label: c.name, sublabel: c.code })),
    segmentSnapshots: snapshots.map((s) => ({
      id: s.id,
      label: `${s.segment.name} — ${s.finishedAt ? toIsoDate(s.finishedAt) : "?"}`,
      sublabel: `${s.segment.code} · ${s.memberCount ?? 0} customers${s.status === "SUPERSEDED" ? " · older snapshot" : ""}`,
    })),
    users: users.map((u) => ({ id: u.id, label: u.fullName })),
  };
}
