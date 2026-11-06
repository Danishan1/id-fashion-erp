import { Prisma, type MarketingCampaign } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { todayIsoDate } from "@/lib/date";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { dbDate, isoDateSchema, optionalText, toDbDate } from "@/modules/sales-marketing/performance/performance-common";
import { getSalesMarketingSettings } from "@/modules/sales-marketing/settings/sales-marketing-settings.service";
import {
  auditCampaign,
  campaignScopeWhere,
  canApproveCampaign,
  getCampaignScope,
  guardedCampaignUpdate,
  loadCampaign,
  notifyCampaignApprovers,
  notifyUsers,
  recordCampaignEvent,
  type CampaignScope,
} from "./campaign-common";
import { ensureCampaignLookups } from "./campaign-lookup.service";
import { CAMPAIGN_ACTIONS, CAMPAIGN_STATUSES, CAMPAIGN_STATUS_KEYS, type CampaignActionKey, type CampaignStatusKey } from "./campaign-registry";

/**
 * Marketing campaigns (Phase 08, PHASE_08_CAMPAIGNS.md §2–§3): create / edit,
 * an explicit lifecycle service (no workflow engine), numbered plan revisions
 * for approval and re-approval of dates and budget.
 */

const money = z.union([z.literal(""), z.null(), z.coerce.number().min(0, "Can't be negative").max(9_999_999_999.99)]).optional();
const uuidOrBlank = z.string().uuid().optional().or(z.literal("")).nullable();
const num = (v: number | string | "" | null | undefined) => (v === "" || v === null || v === undefined ? null : Number(v));
const commentSchema = z.object({ comment: optionalText(1000) }).strict();
const reasonSchema = z.object({ reason: z.string().trim().min(3, "Say why").max(1000) }).strict();

const detailFields = {
  name: z.string().trim().min(1, "Enter a name").max(200),
  description: optionalText(4000),
  typeId: z.string().uuid("Choose a type"),
  objectiveId: z.string().uuid("Choose an objective"),
  ownerUserId: z.string().uuid("Choose an owner"),
  departmentId: uuidOrBlank,
  salesChannelId: uuidOrBlank,
  parentCampaignId: uuidOrBlank,
  priority: z.enum(["LOW", "NORMAL", "HIGH"]).default("NORMAL"),
};
const planFields = {
  plannedStartDate: isoDateSchema,
  plannedEndDate: isoDateSchema,
  plannedBudget: money,
  budgetNotes: optionalText(2000),
};
export const campaignCreateSchema = z
  .object({
    code: z.string().trim().min(1, "Enter a code").max(40).regex(/^[A-Za-z0-9._-]+$/, "Letters, digits, . _ - only"),
    ...detailFields,
    ...planFields,
    idempotencyKey: z.string().trim().min(8).max(100).optional(),
  })
  .strict();
export const campaignUpdateSchema = z
  .object({
    ...detailFields,
    plannedStartDate: isoDateSchema.optional(),
    plannedEndDate: isoDateSchema.optional(),
    plannedBudget: money,
    budgetNotes: optionalText(2000),
    version: z.number().int().min(1),
  })
  .strict();
export const planChangeSchema = z.object({ ...planFields, reason: z.string().trim().min(3, "Say why the plan changes").max(1000) }).strict();
export const listCampaignsSchema = z.object({
  status: z.string().optional(),
  typeId: z.string().uuid().optional().or(z.literal("")),
  objectiveId: z.string().uuid().optional().or(z.literal("")),
  ownerUserId: z.string().uuid().optional().or(z.literal("")),
  departmentId: z.string().uuid().optional().or(z.literal("")),
  salesChannelId: z.string().uuid().optional().or(z.literal("")),
  from: isoDateSchema.optional().or(z.literal("")),
  to: isoDateSchema.optional().or(z.literal("")),
  search: z.string().trim().max(100).optional(),
});

const r2 = (v: number) => Math.round(v * 100) / 100;

function checkPlan(p: { plannedStartDate: string; plannedEndDate: string }) {
  if (p.plannedEndDate < p.plannedStartDate) throw new BusinessRuleError("VALIDATION_ERROR", "The planned end is before the planned start.", { fieldErrors: { plannedEndDate: "Before the start." } });
}

/** Type / objective, owner, department, channel and parent must be real, active records of this company. */
async function validateRefs(actor: SalesActor, input: z.infer<z.ZodObject<typeof detailFields>>, current?: MarketingCampaign) {
  const [type, objective, owner, dept, channel] = await Promise.all([
    prisma.marketingCampaignLookup.findFirst({ where: { id: input.typeId, companyId: actor.companyId, kind: "TYPE" } }),
    prisma.marketingCampaignLookup.findFirst({ where: { id: input.objectiveId, companyId: actor.companyId, kind: "OBJECTIVE" } }),
    prisma.user.findFirst({ where: { id: input.ownerUserId, companyId: actor.companyId, status: "ACTIVE", supportForPlatformUserId: null }, select: { id: true, fullName: true } }),
    input.departmentId ? prisma.department.findFirst({ where: { id: input.departmentId, companyId: actor.companyId }, select: { id: true } }) : null,
    input.salesChannelId ? prisma.salesChannel.findFirst({ where: { id: input.salesChannelId, companyId: actor.companyId }, select: { id: true, isActive: true } }) : null,
  ]);
  const keep = (id: string | null | undefined, cur: string | null | undefined) => Boolean(current) && id === cur;
  if (!type || (!type.isActive && !keep(input.typeId, current?.typeId))) throw new BusinessRuleError("VALIDATION_ERROR", "Choose an active campaign type.", { fieldErrors: { typeId: "Not an active type." } });
  if (!objective || (!objective.isActive && !keep(input.objectiveId, current?.objectiveId))) throw new BusinessRuleError("VALIDATION_ERROR", "Choose an active objective.", { fieldErrors: { objectiveId: "Not an active objective." } });
  if (!owner) throw new BusinessRuleError("VALIDATION_ERROR", "Choose an active user as owner.", { fieldErrors: { ownerUserId: "Not an active user." } });
  if (!keep(input.ownerUserId, current?.ownerUserId) && !(await PermissionService.can(owner.id, "marketing_campaigns", "view"))) {
    throw new BusinessRuleError("VALIDATION_ERROR", `${owner.fullName} doesn't have access to Campaigns.`, { fieldErrors: { ownerUserId: "No access to Campaigns." } });
  }
  if (input.departmentId && !dept) throw new BusinessRuleError("VALIDATION_ERROR", "Department not found.", { fieldErrors: { departmentId: "Not found." } });
  if (input.salesChannelId && (!channel || (!channel.isActive && !keep(input.salesChannelId, current?.salesChannelId)))) throw new BusinessRuleError("VALIDATION_ERROR", "Choose an active sales channel.", { fieldErrors: { salesChannelId: "Not an active channel." } });
  if (input.parentCampaignId) {
    const parent = await prisma.marketingCampaign.findFirst({ where: { id: input.parentCampaignId, companyId: actor.companyId }, select: { id: true, status: true, parentCampaignId: true } });
    if (!parent) throw new BusinessRuleError("VALIDATION_ERROR", "Parent campaign not found.", { fieldErrors: { parentCampaignId: "Not found." } });
    if (parent.status === "CANCELLED" && !keep(input.parentCampaignId, current?.parentCampaignId)) throw new BusinessRuleError("VALIDATION_ERROR", "The parent campaign is cancelled.", { fieldErrors: { parentCampaignId: "Cancelled." } });
    if (current) {
      // No loops: walk up from the new parent; meeting this campaign means a cycle.
      let cursor: string | null = parent.id;
      for (let depth = 0; cursor && depth < 50; depth++) {
        if (cursor === current.id) throw new BusinessRuleError("VALIDATION_ERROR", "A campaign can't sit under itself or one of its own sub-campaigns.", { fieldErrors: { parentCampaignId: "Would make a loop." } });
        const next: { parentCampaignId: string | null } | null = await prisma.marketingCampaign.findFirst({ where: { id: cursor, companyId: actor.companyId }, select: { parentCampaignId: true } });
        cursor = next?.parentCampaignId ?? null;
      }
    }
  }
  return { owner };
}

const detailData = (input: z.infer<z.ZodObject<typeof detailFields>>) => ({
  name: input.name,
  description: input.description || null,
  typeId: input.typeId,
  objectiveId: input.objectiveId,
  ownerUserId: input.ownerUserId,
  departmentId: input.departmentId || null,
  salesChannelId: input.salesChannelId || null,
  parentCampaignId: input.parentCampaignId || null,
  priority: input.priority,
});

export async function createCampaign(actor: SalesActor, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_campaigns", "create");
  const input = campaignCreateSchema.parse(raw);
  if (input.idempotencyKey) {
    const existing = await prisma.marketingCampaign.findFirst({ where: { companyId: actor.companyId, idempotencyKey: input.idempotencyKey }, select: { id: true } });
    if (existing) return { id: existing.id, replayed: true as const };
  }
  checkPlan(input);
  await ensureCampaignLookups(actor.companyId);
  await validateRefs(actor, input);
  const company = await prisma.company.findUniqueOrThrow({ where: { id: actor.companyId }, select: { baseCurrencyCode: true } });
  try {
    const c = await prisma.$transaction(async (tx) => {
      const created = await tx.marketingCampaign.create({
        data: {
          companyId: actor.companyId,
          code: input.code.toUpperCase(),
          ...detailData(input),
          plannedStartDate: toDbDate(input.plannedStartDate),
          plannedEndDate: toDbDate(input.plannedEndDate),
          plannedBudget: num(input.plannedBudget),
          budgetNotes: input.budgetNotes || null,
          currencyCode: company.baseCurrencyCode,
          idempotencyKey: input.idempotencyKey ?? null,
          createdByUserId: actor.userId,
          updatedByUserId: actor.userId,
        },
      });
      await recordCampaignEvent(tx, actor, created.id, "CAMPAIGN_CREATED", null, { code: created.code });
      await auditCampaign(tx, actor, created.id, "CREATE", null, { ...input, idempotencyKey: undefined });
      return created;
    });
    return { id: c.id, replayed: false as const };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const t = JSON.stringify(error.meta ?? {});
      if (t.includes("idempotency")) {
        const again = await prisma.marketingCampaign.findFirst({ where: { companyId: actor.companyId, idempotencyKey: input.idempotencyKey }, select: { id: true } });
        if (again) return { id: again.id, replayed: true as const };
      }
      throw new BusinessRuleError("VALIDATION_ERROR", "A campaign with this code already exists.", { fieldErrors: { code: "Already used." } });
    }
    throw error;
  }
}

const isClosed = (s: string) => s === "COMPLETED" || s === "CANCELLED";

export async function updateCampaign(actor: SalesActor, id: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_campaigns", "edit");
  const input = campaignUpdateSchema.parse(raw);
  const c = await loadCampaign(actor, id);
  if (c.companyId !== actor.companyId) throw new BusinessRuleError("NOT_FOUND", "Campaign not found.", { id });
  if (isClosed(c.status)) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "A completed or cancelled campaign can't be edited.");
  if (c.version !== input.version) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "Someone else saved this campaign after you opened it. Reload to see their changes.");
  const planData: Prisma.MarketingCampaignUncheckedUpdateManyInput = {};
  const planTouched = input.plannedStartDate !== undefined || input.plannedEndDate !== undefined || input.plannedBudget !== undefined || input.budgetNotes !== undefined;
  if (planTouched) {
    const next = {
      plannedStartDate: input.plannedStartDate ?? dbDate(c.plannedStartDate),
      plannedEndDate: input.plannedEndDate ?? dbDate(c.plannedEndDate),
      plannedBudget: input.plannedBudget === undefined ? (c.plannedBudget === null ? null : Number(c.plannedBudget)) : num(input.plannedBudget),
      budgetNotes: input.budgetNotes === undefined ? c.budgetNotes : input.budgetNotes || null,
    };
    const changed =
      next.plannedStartDate !== dbDate(c.plannedStartDate) ||
      next.plannedEndDate !== dbDate(c.plannedEndDate) ||
      next.plannedBudget !== (c.plannedBudget === null ? null : Number(c.plannedBudget)) ||
      (next.budgetNotes ?? null) !== (c.budgetNotes ?? null);
    if (changed && c.status !== "DRAFT") {
      throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Planned dates and budget of an approved campaign change through a plan change that someone approves.", { fieldErrors: { plannedBudget: "Request a plan change." } });
    }
    if (changed) {
      checkPlan(next);
      Object.assign(planData, { plannedStartDate: toDbDate(next.plannedStartDate), plannedEndDate: toDbDate(next.plannedEndDate), plannedBudget: next.plannedBudget, budgetNotes: next.budgetNotes });
    }
  }
  const { owner } = await validateRefs(actor, input, c);
  const data = { ...detailData(input), ...planData };
  await prisma.$transaction(async (tx) => {
    await guardedCampaignUpdate(tx, actor, c, data);
    if (c.ownerUserId !== input.ownerUserId) {
      const prev = await tx.user.findUnique({ where: { id: c.ownerUserId }, select: { fullName: true } });
      await recordCampaignEvent(tx, actor, c.id, "OWNER_CHANGED", null, { from: prev?.fullName ?? null, to: owner.fullName });
      await notifyUsers(tx, actor, [input.ownerUserId], `You now own campaign ${c.code}`, input.name);
    }
    await recordCampaignEvent(tx, actor, c.id, "CAMPAIGN_UPDATED");
    await auditCampaign(tx, actor, c.id, "UPDATE", { ...c, version: undefined }, data);
  });
  return { id };
}

/** Only an empty draft can be deleted; anything with history or links is cancelled instead. */
export async function deleteCampaign(actor: SalesActor, id: string) {
  await PermissionService.assert(actor.userId, "marketing_campaigns", "edit");
  const c = await loadCampaign(actor, id);
  if (c.status !== "DRAFT") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Only a draft campaign can be deleted. Cancel it instead.");
  const [revisions, leads, enquiries, quotations, orders, expenses, children, activities] = await Promise.all([
    prisma.marketingCampaignRevision.count({ where: { campaignId: id } }),
    prisma.crmLead.count({ where: { companyId: actor.companyId, campaignId: id } }),
    prisma.buyerEnquiry.count({ where: { companyId: actor.companyId, campaignId: id } }),
    prisma.quotation.count({ where: { companyId: actor.companyId, campaignId: id } }),
    prisma.salesOrder.count({ where: { companyId: actor.companyId, campaignId: id } }),
    prisma.expense.count({ where: { companyId: actor.companyId, campaignId: id } }),
    prisma.marketingCampaign.count({ where: { companyId: actor.companyId, parentCampaignId: id } }),
    prisma.crmActivityLink.count({ where: { companyId: actor.companyId, entityType: "CAMPAIGN", entityId: id } }),
  ]);
  if (revisions + leads + enquiries + quotations + orders + expenses + children + activities > 0) {
    throw new BusinessRuleError("REFERENCED_RECORD_IN_USE", "This campaign has history, linked records, sub-campaigns or activities. Cancel it instead so they keep their campaign.");
  }
  await prisma.$transaction(async (tx) => {
    await tx.salesPerformanceEvent.deleteMany({ where: { companyId: actor.companyId, entityType: "CAMPAIGN", entityId: id } });
    await tx.marketingCampaign.deleteMany({ where: { id, companyId: actor.companyId, status: "DRAFT", version: c.version } });
    await auditCampaign(tx, actor, id, "DELETE", { code: c.code, name: c.name }, null);
  });
  return { id, deleted: true as const };
}

// ── Lifecycle ────────────────────────────────────────────────────

const activateSchema = z.object({ actualStartDate: isoDateSchema.optional().or(z.literal("")), comment: optionalText(1000) }).strict();
const completeSchema = z.object({ actualEndDate: isoDateSchema.optional().or(z.literal("")), comment: optionalText(1000) }).strict();

function planSnapshot(c: MarketingCampaign) {
  return { plannedStartDate: c.plannedStartDate, plannedEndDate: c.plannedEndDate, plannedBudget: c.plannedBudget, budgetNotes: c.budgetNotes };
}

async function nextRevisionNumber(tx: Prisma.TransactionClient, campaignId: string) {
  const last = await tx.marketingCampaignRevision.findFirst({ where: { campaignId }, orderBy: { revisionNumber: "desc" }, select: { revisionNumber: true } });
  return (last?.revisionNumber ?? 0) + 1;
}

function uniquePending(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This campaign already has a plan change waiting for approval.");
  throw error;
}

export async function campaignAction(actor: SalesActor, id: string, action: string, raw: unknown) {
  if (!(action in CAMPAIGN_ACTIONS)) throw new BusinessRuleError("NOT_FOUND", "Unknown campaign action.", { action });
  const def = CAMPAIGN_ACTIONS[action as CampaignActionKey];
  const c = await loadCampaign(actor, id);
  if (!(def.from as readonly string[]).includes(c.status)) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `This campaign is ${CAMPAIGN_STATUSES[c.status].label.toLowerCase()}, so "${def.label}" isn't possible.`, { status: c.status, action });
  }
  const today = todayIsoDate();
  const pending = await prisma.marketingCampaignRevision.findFirst({ where: { campaignId: c.id, status: "PENDING_APPROVAL" } });

  switch (action as CampaignActionKey) {
    case "submit": {
      await PermissionService.assert(actor.userId, "marketing_campaigns", "edit");
      const { comment } = commentSchema.parse(raw ?? {});
      const settings = await getSalesMarketingSettings(actor.companyId);
      try {
        await prisma.$transaction(async (tx) => {
          const n = await nextRevisionNumber(tx, c.id);
          const auto = !settings.campaignApprovalRequired;
          await tx.marketingCampaignRevision.create({
            data: {
              campaignId: c.id,
              revisionNumber: n,
              ...planSnapshot(c),
              reason: comment || (n === 1 ? "First plan" : "Resubmitted plan"),
              requestedByUserId: actor.userId,
              ...(auto ? { status: "APPROVED" as const, autoApproved: true, decidedAt: new Date() } : {}),
            },
          });
          await guardedCampaignUpdate(tx, actor, c, auto ? { status: "APPROVED", approvedRevisionNumber: n, statusReason: null } : { status: "PENDING_APPROVAL", statusReason: null });
          await recordCampaignEvent(tx, actor, c.id, auto ? "AUTO_APPROVED" : "SUBMITTED", comment || null, { revision: n });
          await auditCampaign(tx, actor, c.id, auto ? "APPROVE" : "UPDATE", { status: c.status }, { status: auto ? "APPROVED" : "PENDING_APPROVAL", revision: n });
          if (!auto) await notifyCampaignApprovers(tx, actor, [actor.userId, c.createdByUserId], `Campaign ${c.code} waits for approval`, c.name);
        });
      } catch (e) {
        uniquePending(e);
      }
      break;
    }
    case "return-to-draft":
    case "send-back": {
      const isSendBack = action === "send-back";
      await PermissionService.assert(actor.userId, "marketing_campaigns", isSendBack ? "reject" : "edit");
      const reason = isSendBack ? reasonSchema.parse(raw ?? {}).reason : null;
      await prisma.$transaction(async (tx) => {
        if (pending) await tx.marketingCampaignRevision.updateMany({ where: { id: pending.id, status: "PENDING_APPROVAL" }, data: { status: isSendBack ? "REJECTED" : "WITHDRAWN", decidedByUserId: actor.userId, decidedAt: new Date(), decisionComment: reason } });
        await guardedCampaignUpdate(tx, actor, c, { status: "DRAFT", statusReason: reason });
        await recordCampaignEvent(tx, actor, c.id, isSendBack ? "SENT_BACK" : "RETURNED_TO_DRAFT", reason, { revision: pending?.revisionNumber ?? null });
        await auditCampaign(tx, actor, c.id, isSendBack ? "REJECT" : "UPDATE", { status: c.status }, { status: "DRAFT", reason });
        if (isSendBack) await notifyUsers(tx, actor, [c.createdByUserId, pending?.requestedByUserId, c.ownerUserId], `Campaign ${c.code} sent back`, reason ?? "");
      });
      break;
    }
    case "approve": {
      await PermissionService.assert(actor.userId, "marketing_campaigns", "approve");
      const { comment } = commentSchema.parse(raw ?? {});
      if (!pending) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Nothing is waiting for approval.");
      if (!(await canApproveCampaign(actor.userId, [c.createdByUserId, pending.requestedByUserId]))) {
        throw new BusinessRuleError("SELF_APPROVAL_NOT_ALLOWED", "Someone other than the person who prepared or submitted this campaign must approve it.");
      }
      await prisma.$transaction(async (tx) => {
        const { count } = await tx.marketingCampaignRevision.updateMany({ where: { id: pending.id, status: "PENDING_APPROVAL" }, data: { status: "APPROVED", decidedByUserId: actor.userId, decidedAt: new Date(), decisionComment: comment || null } });
        if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This approval was decided just now. Reload.");
        await guardedCampaignUpdate(tx, actor, c, { status: "APPROVED", approvedRevisionNumber: pending.revisionNumber, statusReason: null });
        await recordCampaignEvent(tx, actor, c.id, "APPROVED", comment || null, { revision: pending.revisionNumber });
        await auditCampaign(tx, actor, c.id, "APPROVE", { status: c.status }, { status: "APPROVED", revision: pending.revisionNumber });
        await notifyUsers(tx, actor, [c.createdByUserId, pending.requestedByUserId, c.ownerUserId], `Campaign ${c.code} approved`, c.name);
      });
      break;
    }
    case "activate": {
      await PermissionService.assert(actor.userId, "marketing_campaigns", "edit");
      const input = activateSchema.parse(raw ?? {});
      const start = input.actualStartDate || today;
      if (start > today) throw new BusinessRuleError("VALIDATION_ERROR", "The actual start can't be in the future. Activate the campaign when it starts.", { fieldErrors: { actualStartDate: "In the future." } });
      await prisma.$transaction(async (tx) => {
        await guardedCampaignUpdate(tx, actor, c, { status: "ACTIVE", actualStartDate: toDbDate(start), statusReason: null });
        await recordCampaignEvent(tx, actor, c.id, "ACTIVATED", input.comment || null, { actualStartDate: start });
        await auditCampaign(tx, actor, c.id, "UPDATE", { status: c.status }, { status: "ACTIVE", actualStartDate: start });
      });
      break;
    }
    case "pause":
    case "resume": {
      await PermissionService.assert(actor.userId, "marketing_campaigns", "edit");
      const reason = action === "pause" ? reasonSchema.parse(raw ?? {}).reason : (commentSchema.parse(raw ?? {}).comment ?? null);
      const to: CampaignStatusKey = action === "pause" ? "PAUSED" : "ACTIVE";
      await prisma.$transaction(async (tx) => {
        await guardedCampaignUpdate(tx, actor, c, { status: to, statusReason: action === "pause" ? reason : null });
        await recordCampaignEvent(tx, actor, c.id, action === "pause" ? "PAUSED" : "RESUMED", reason || null);
        await auditCampaign(tx, actor, c.id, "UPDATE", { status: c.status }, { status: to, reason });
      });
      break;
    }
    case "complete": {
      await PermissionService.assert(actor.userId, "marketing_campaigns", "edit");
      const input = completeSchema.parse(raw ?? {});
      const end = input.actualEndDate || today;
      if (end > today) throw new BusinessRuleError("VALIDATION_ERROR", "The actual end can't be in the future.", { fieldErrors: { actualEndDate: "In the future." } });
      if (c.actualStartDate && end < dbDate(c.actualStartDate)) throw new BusinessRuleError("VALIDATION_ERROR", `The actual end is before the actual start (${dbDate(c.actualStartDate)}).`, { fieldErrors: { actualEndDate: "Before the start." } });
      if (pending) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "A plan change is waiting for approval. Decide or withdraw it first.");
      await prisma.$transaction(async (tx) => {
        await guardedCampaignUpdate(tx, actor, c, { status: "COMPLETED", actualEndDate: toDbDate(end), statusReason: null });
        await recordCampaignEvent(tx, actor, c.id, "COMPLETED", input.comment || null, { actualEndDate: end });
        await auditCampaign(tx, actor, c.id, "UPDATE", { status: c.status }, { status: "COMPLETED", actualEndDate: end });
      });
      break;
    }
    case "cancel": {
      await PermissionService.assert(actor.userId, "marketing_campaigns", "cancel");
      const { reason } = reasonSchema.parse(raw ?? {});
      await prisma.$transaction(async (tx) => {
        if (pending) await tx.marketingCampaignRevision.updateMany({ where: { id: pending.id, status: "PENDING_APPROVAL" }, data: { status: "WITHDRAWN", decidedByUserId: actor.userId, decidedAt: new Date(), decisionComment: "Campaign cancelled" } });
        // A running campaign that is cancelled ends today.
        const ended = c.actualStartDate && !c.actualEndDate ? { actualEndDate: toDbDate(today < dbDate(c.actualStartDate) ? dbDate(c.actualStartDate) : today) } : {};
        await guardedCampaignUpdate(tx, actor, c, { status: "CANCELLED", statusReason: reason, ...ended });
        await recordCampaignEvent(tx, actor, c.id, "CANCELLED", reason);
        await auditCampaign(tx, actor, c.id, "UPDATE", { status: c.status }, { status: "CANCELLED", reason });
        await notifyUsers(tx, actor, [c.ownerUserId, c.createdByUserId], `Campaign ${c.code} cancelled`, reason);
      });
      break;
    }
  }
  return { id };
}

// ── Plan changes after approval (re-approval) ────────────────────

export async function requestPlanChange(actor: SalesActor, id: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_campaigns", "edit");
  const input = planChangeSchema.parse(raw);
  checkPlan(input);
  const c = await loadCampaign(actor, id);
  if (!["APPROVED", "ACTIVE", "PAUSED"].includes(c.status)) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", c.status === "DRAFT" ? "Edit a draft's dates and budget directly." : "This campaign's plan can't be changed now.");
  }
  const budget = num(input.plannedBudget);
  const same =
    input.plannedStartDate === dbDate(c.plannedStartDate) &&
    input.plannedEndDate === dbDate(c.plannedEndDate) &&
    budget === (c.plannedBudget === null ? null : Number(c.plannedBudget)) &&
    (input.budgetNotes || null) === (c.budgetNotes ?? null);
  if (same) throw new BusinessRuleError("VALIDATION_ERROR", "Nothing changed — the plan is the same as the approved one.");
  const settings = await getSalesMarketingSettings(actor.companyId);
  const auto = !settings.campaignApprovalRequired;
  try {
    await prisma.$transaction(async (tx) => {
      const n = await nextRevisionNumber(tx, c.id);
      const plan = { plannedStartDate: toDbDate(input.plannedStartDate), plannedEndDate: toDbDate(input.plannedEndDate), plannedBudget: budget, budgetNotes: input.budgetNotes || null };
      await tx.marketingCampaignRevision.create({
        data: { campaignId: c.id, revisionNumber: n, ...plan, reason: input.reason, requestedByUserId: actor.userId, ...(auto ? { status: "APPROVED" as const, autoApproved: true, decidedAt: new Date() } : {}) },
      });
      const before = { plannedStartDate: dbDate(c.plannedStartDate), plannedEndDate: dbDate(c.plannedEndDate), plannedBudget: c.plannedBudget === null ? null : Number(c.plannedBudget) };
      const after = { plannedStartDate: input.plannedStartDate, plannedEndDate: input.plannedEndDate, plannedBudget: budget };
      if (auto) {
        await guardedCampaignUpdate(tx, actor, c, { ...plan, approvedRevisionNumber: n });
        await recordCampaignEvent(tx, actor, c.id, "REVISION_APPROVED", input.reason, { revision: n, before, after, auto: true });
      } else {
        await recordCampaignEvent(tx, actor, c.id, "REVISION_REQUESTED", input.reason, { revision: n, before, after });
        await notifyCampaignApprovers(tx, actor, [actor.userId], `Campaign ${c.code}: plan change waits for approval`, input.reason);
      }
      await auditCampaign(tx, actor, c.id, auto ? "APPROVE" : "UPDATE", before, { ...after, revision: n, reason: input.reason });
    });
  } catch (e) {
    uniquePending(e);
  }
  return { id };
}

export async function revisionAction(actor: SalesActor, id: string, revisionId: string, action: string, raw: unknown) {
  const c = await loadCampaign(actor, id);
  const rev = await prisma.marketingCampaignRevision.findFirst({ where: { id: revisionId, campaignId: c.id } });
  if (!rev) throw new BusinessRuleError("NOT_FOUND", "Plan change not found.", { revisionId });
  if (rev.status !== "PENDING_APPROVAL") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This plan change was already decided.");
  if (c.status === "PENDING_APPROVAL" || c.status === "DRAFT") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Use the campaign's own approve / send back for its first plan.");
  const decide = async (status: "APPROVED" | "REJECTED" | "WITHDRAWN", comment: string | null, apply: boolean, eventType: string) => {
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.marketingCampaignRevision.updateMany({ where: { id: rev.id, status: "PENDING_APPROVAL" }, data: { status, decidedByUserId: actor.userId, decidedAt: new Date(), decisionComment: comment } });
      if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This plan change was decided just now. Reload.");
      if (apply) {
        await guardedCampaignUpdate(tx, actor, c, { plannedStartDate: rev.plannedStartDate, plannedEndDate: rev.plannedEndDate, plannedBudget: rev.plannedBudget, budgetNotes: rev.budgetNotes, approvedRevisionNumber: rev.revisionNumber });
      }
      await recordCampaignEvent(tx, actor, c.id, eventType, comment, { revision: rev.revisionNumber });
      await auditCampaign(tx, actor, c.id, status === "APPROVED" ? "APPROVE" : status === "REJECTED" ? "REJECT" : "UPDATE", { revision: rev.revisionNumber, status: rev.status }, { revision: rev.revisionNumber, status, comment });
      if (status !== "WITHDRAWN") await notifyUsers(tx, actor, [rev.requestedByUserId], `Campaign ${c.code}: plan change ${status === "APPROVED" ? "approved" : "sent back"}`, comment ?? "");
    });
  };
  switch (action) {
    case "approve": {
      await PermissionService.assert(actor.userId, "marketing_campaigns", "approve");
      const { comment } = commentSchema.parse(raw ?? {});
      if (!(await canApproveCampaign(actor.userId, [rev.requestedByUserId]))) throw new BusinessRuleError("SELF_APPROVAL_NOT_ALLOWED", "Someone other than the person who asked for this plan change must approve it.");
      await decide("APPROVED", comment || null, true, "REVISION_APPROVED");
      break;
    }
    case "send-back": {
      await PermissionService.assert(actor.userId, "marketing_campaigns", "reject");
      const { reason } = reasonSchema.parse(raw ?? {});
      await decide("REJECTED", reason, false, "REVISION_REJECTED");
      break;
    }
    case "withdraw": {
      await PermissionService.assert(actor.userId, "marketing_campaigns", "edit");
      await decide("WITHDRAWN", null, false, "REVISION_WITHDRAWN");
      break;
    }
    default:
      throw new BusinessRuleError("NOT_FOUND", "Unknown action.", { action });
  }
  return { id };
}

// ── List ─────────────────────────────────────────────────────────

/** The list's filter → where (also used by bulk "all matching the filter", Phase 14). */
export function buildCampaignListWhere(actor: SalesActor, scope: CampaignScope, f: z.infer<typeof listCampaignsSchema>): Prisma.MarketingCampaignWhereInput {
  const statuses = (f.status ?? "").split(",").filter((s): s is CampaignStatusKey => (CAMPAIGN_STATUS_KEYS as string[]).includes(s));
  const where: Prisma.MarketingCampaignWhereInput = {
    AND: [
      campaignScopeWhere(actor, scope),
      statuses.length ? { status: { in: statuses } } : {},
      f.typeId ? { typeId: f.typeId } : {},
      f.objectiveId ? { objectiveId: f.objectiveId } : {},
      f.ownerUserId ? { ownerUserId: f.ownerUserId } : {},
      f.departmentId ? { departmentId: f.departmentId } : {},
      f.salesChannelId ? { salesChannelId: f.salesChannelId } : {},
      // Overlaps the window (planned dates).
      f.from ? { plannedEndDate: { gte: toDbDate(f.from) } } : {},
      f.to ? { plannedStartDate: { lte: toDbDate(f.to) } } : {},
      f.search ? { OR: [{ code: { contains: f.search, mode: "insensitive" } }, { name: { contains: f.search, mode: "insensitive" } }] } : {},
    ],
  };
  return where;
}

export async function listCampaigns(actor: SalesActor, raw: unknown, page: { skip: number; take: number }) {
  await PermissionService.assert(actor.userId, "marketing_campaigns", "view");
  const f = listCampaignsSchema.parse(raw ?? {});
  const where = buildCampaignListWhere(actor, await getCampaignScope(actor), f);
  const [rows, total] = await Promise.all([
    prisma.marketingCampaign.findMany({
      where,
      orderBy: [{ plannedStartDate: "desc" }, { code: "asc" }],
      skip: page.skip,
      take: page.take,
      include: { type: { select: { name: true } }, objective: { select: { name: true } }, owner: { select: { fullName: true } }, department: { select: { name: true } }, salesChannel: { select: { name: true } } },
    }),
    prisma.marketingCampaign.count({ where }),
  ]);
  return {
    total,
    data: rows.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      status: c.status,
      type: c.type.name,
      objective: c.objective.name,
      owner: c.owner.fullName,
      department: c.department?.name ?? null,
      channel: c.salesChannel?.name ?? null,
      priority: c.priority,
      plannedStartDate: dbDate(c.plannedStartDate),
      plannedEndDate: dbDate(c.plannedEndDate),
      actualStartDate: c.actualStartDate ? dbDate(c.actualStartDate) : null,
      actualEndDate: c.actualEndDate ? dbDate(c.actualEndDate) : null,
      plannedBudget: c.plannedBudget === null ? null : r2(Number(c.plannedBudget)),
      currencyCode: c.currencyCode,
    })),
  };
}

/**
 * Campaigns a record can be linked to: approved, running or completed. Code
 * and name only, company-wide (picking a campaign on an enquiry doesn't need
 * campaign visibility; the record's own permission is checked when saving).
 */
export async function listLinkableCampaigns(actor: SalesActor, search?: string) {
  return prisma.marketingCampaign.findMany({
    where: { companyId: actor.companyId, status: { in: ["APPROVED", "ACTIVE", "PAUSED", "COMPLETED"] }, ...(search ? { OR: [{ code: { contains: search, mode: "insensitive" } }, { name: { contains: search, mode: "insensitive" } }] } : {}) },
    orderBy: [{ status: "asc" }, { plannedStartDate: "desc" }],
    take: 200,
    select: { id: true, code: true, name: true, status: true },
  });
}
