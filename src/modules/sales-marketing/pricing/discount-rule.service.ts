import { Prisma, type DiscountRule } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/core/db/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { createNotification } from "@/core/notifications/NotificationService";
import { PermissionService } from "@/core/rbac/PermissionService";
import { toIsoDate, todayIsoDate } from "@/lib/date";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { canApprovePricing, recordPricingEvent } from "./price-list.service";

/**
 * Discount rules (Sales & Marketing Phase 03, 2026-10-29). Typed conditions
 * only (no expressions). Draft → Pending approval → Active → Inactive;
 * approved by someone other than whoever created, last saved or submitted it.
 * Only Draft / Inactive rules are edited. How rules combine:
 * docs/sales-marketing/PHASE_03_PRICING.md §4.
 */

const TABLE = "discount_rules";
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");
const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal("")).nullable();
const optionalUuid = z.string().uuid().optional().or(z.literal("")).nullable();
const blank = (v: string | null | undefined) => (v ? v : null);

const ruleBody = {
  name: z.string().trim().min(1, "Enter a name").max(200),
  description: optionalText(1000),
  discountType: z.enum(["PERCENT", "AMOUNT_PER_UNIT"]),
  value: z.coerce
    .number()
    .positive("Must be more than 0")
    .max(9_999_999_999)
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "Up to 2 decimals"),
  stacking: z.enum(["EXCLUSIVE", "STACKABLE"]),
  priority: z.coerce.number().int().min(-1000).max(1000).default(0),
  productId: optionalUuid,
  categoryId: optionalUuid,
  customerId: optionalUuid,
  priceListId: optionalUuid,
  minQuantity: z.union([z.literal(""), z.null(), z.coerce.number().min(0).max(99_999_999)]).optional(),
  validFrom: isoDate,
  validTo: isoDate.optional().or(z.literal("")).nullable(),
};

export const discountRuleCreateSchema = z
  .object({ code: z.string().trim().min(1, "Enter a code").max(40).regex(/^[A-Za-z0-9._-]+$/, "Letters, digits, . _ - only"), ...ruleBody })
  .strict();
export const discountRuleUpdateSchema = z.object({ ...ruleBody, version: z.number().int().min(1) }).strict();
const commentSchema = z.object({ comment: optionalText(1000) }).strict();
const reasonSchema = z.object({ reason: z.string().trim().min(3, "Say why").max(1000) }).strict();

type RuleBody = z.infer<z.ZodObject<typeof ruleBody>>;

async function validateRule(actor: SalesActor, input: RuleBody) {
  if (input.discountType === "PERCENT" && input.value > 100) throw new BusinessRuleError("VALIDATION_ERROR", "A percentage can't be above 100.", { fieldErrors: { value: "Max 100." } });
  if (input.validTo && input.validTo < input.validFrom) throw new BusinessRuleError("VALIDATION_ERROR", "The end date is before the start date.", { fieldErrors: { validTo: "Before the start date." } });
  const [product, category, customer, list] = await Promise.all([
    input.productId ? prisma.product.findFirst({ where: { id: input.productId, companyId: actor.companyId, deletedAt: null }, select: { id: true, itemType: true } }) : null,
    input.categoryId ? prisma.category.findFirst({ where: { id: input.categoryId, companyId: actor.companyId }, select: { id: true } }) : null,
    input.customerId ? prisma.customer.findFirst({ where: { id: input.customerId, companyId: actor.companyId, deletedAt: null }, select: { id: true } }) : null,
    input.priceListId ? prisma.priceList.findFirst({ where: { id: input.priceListId, companyId: actor.companyId }, select: { id: true } }) : null,
  ]);
  if (input.productId && (!product || product.itemType !== "STYLE")) throw new BusinessRuleError("NOT_FOUND", "Style not found.", { fieldErrors: { productId: "Not found." } });
  if (input.categoryId && !category) throw new BusinessRuleError("NOT_FOUND", "Category not found.", { fieldErrors: { categoryId: "Not found." } });
  if (input.customerId && !customer) throw new BusinessRuleError("NOT_FOUND", "Customer not found.", { fieldErrors: { customerId: "Not found." } });
  if (input.priceListId && !list) throw new BusinessRuleError("NOT_FOUND", "Price list not found.", { fieldErrors: { priceListId: "Not found." } });
}

const data = (input: RuleBody) => ({
  name: input.name,
  description: blank(input.description),
  discountType: input.discountType,
  value: input.value,
  stacking: input.stacking,
  priority: input.priority ?? 0,
  productId: input.productId || null,
  categoryId: input.categoryId || null,
  customerId: input.customerId || null,
  priceListId: input.priceListId || null,
  minQuantity: input.minQuantity === "" || input.minQuantity === null || input.minQuantity === undefined ? null : input.minQuantity,
  validFrom: new Date(input.validFrom),
  validTo: input.validTo ? new Date(input.validTo) : null,
});

async function audit(tx: Prisma.TransactionClient, actor: SalesActor, recordId: string, action: "CREATE" | "UPDATE" | "APPROVE" | "REJECT", oldValues: unknown, newValues: unknown) {
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: TABLE, recordId, action, oldValues: oldValues as Record<string, unknown>, newValues: newValues as Record<string, unknown> }, tx);
}

async function loadRule(actor: SalesActor, id: string) {
  const rule = await prisma.discountRule.findFirst({ where: { id, companyId: actor.companyId } });
  if (!rule) throw new BusinessRuleError("NOT_FOUND", "Discount rule not found.", { id });
  return rule;
}

export async function createDiscountRule(actor: SalesActor, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_pricing", "create");
  const input = discountRuleCreateSchema.parse(raw);
  await validateRule(actor, input);
  const code = input.code.toUpperCase();
  if (await prisma.discountRule.findFirst({ where: { companyId: actor.companyId, code }, select: { id: true } })) {
    throw new BusinessRuleError("VALIDATION_ERROR", "A discount rule with this code already exists.", { fieldErrors: { code: "Already used." } });
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const rule = await tx.discountRule.create({ data: { companyId: actor.companyId, code, ...data(input), status: "DRAFT", createdByUserId: actor.userId } });
      await recordPricingEvent(tx, actor, "DISCOUNT_RULE", rule.id, "CREATED");
      await audit(tx, actor, rule.id, "CREATE", null, { ...input, code });
      return rule;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new BusinessRuleError("VALIDATION_ERROR", "A discount rule with this code already exists.", { fieldErrors: { code: "Already used." } });
    throw error;
  }
}

export async function updateDiscountRule(actor: SalesActor, id: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_pricing", "edit");
  const input = discountRuleUpdateSchema.parse(raw);
  const rule = await loadRule(actor, id);
  if (rule.status !== "DRAFT" && rule.status !== "INACTIVE") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Only a draft or inactive rule can be edited. Deactivate it first.");
  if (rule.version !== input.version) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "Someone else saved this rule after you opened it. Reload to see their changes.");
  await validateRule(actor, input);
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.discountRule.updateMany({ where: { id: rule.id, companyId: actor.companyId, version: input.version, status: rule.status }, data: { ...data(input), updatedByUserId: actor.userId, version: { increment: 1 } } });
    if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "Someone else saved this rule just now. Reload and try again.");
    await recordPricingEvent(tx, actor, "DISCOUNT_RULE", rule.id, "UPDATED");
    await audit(tx, actor, rule.id, "UPDATE", { value: rule.value.toString(), discountType: rule.discountType, stacking: rule.stacking }, input);
  });
  return getDiscountRule(actor, id);
}

async function move(tx: Prisma.TransactionClient, rule: DiscountRule, data: Prisma.DiscountRuleUncheckedUpdateManyInput) {
  const { count } = await tx.discountRule.updateMany({ where: { id: rule.id, status: rule.status, version: rule.version }, data: { ...data, version: { increment: 1 } } });
  if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This rule changed just now. Reload and try again.");
}

function requireStatus(rule: DiscountRule, allowed: string[], verb: string) {
  if (!allowed.includes(rule.status)) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `A ${rule.status.toLowerCase().replace(/_/g, " ")} rule can't be ${verb}.`, { status: rule.status });
}

export async function discountRuleAction(actor: SalesActor, id: string, action: string, raw: unknown) {
  const rule = await loadRule(actor, id);
  switch (action) {
    case "submit": {
      await PermissionService.assert(actor.userId, "sales_pricing", "edit");
      const { comment } = commentSchema.parse(raw ?? {});
      requireStatus(rule, ["DRAFT", "INACTIVE"], "submitted");
      if (rule.validTo && toIsoDate(rule.validTo) < todayIsoDate()) throw new BusinessRuleError("VALIDATION_ERROR", "This rule's end date has passed. Edit it first.");
      await prisma.$transaction(async (tx) => {
        await move(tx, rule, { status: "PENDING_APPROVAL", submittedByUserId: actor.userId, submittedAt: new Date() });
        await recordPricingEvent(tx, actor, "DISCOUNT_RULE", rule.id, "SUBMITTED", null, comment || null);
        await audit(tx, actor, rule.id, "UPDATE", { status: rule.status }, { status: "PENDING_APPROVAL" });
        const users = await tx.user.findMany({ where: { companyId: actor.companyId, status: "ACTIVE", supportForPlatformUserId: null }, select: { id: true } });
        const ok = await Promise.all(users.map((u) => PermissionService.can(u.id, "sales_pricing", "approve")));
        for (const u of users.filter((x, i) => ok[i] && ![actor.userId, rule.createdByUserId, rule.updatedByUserId].includes(x.id))) {
          await createNotification({ companyId: actor.companyId, userId: u.id, title: `Discount rule ${rule.code} waits for approval`, body: rule.name }, tx);
        }
      });
      break;
    }
    case "return-to-draft": {
      await PermissionService.assert(actor.userId, "sales_pricing", "edit");
      requireStatus(rule, ["PENDING_APPROVAL"], "returned to draft");
      await prisma.$transaction(async (tx) => {
        await move(tx, rule, { status: "DRAFT", submittedByUserId: null, submittedAt: null });
        await recordPricingEvent(tx, actor, "DISCOUNT_RULE", rule.id, "RETURNED_TO_DRAFT");
        await audit(tx, actor, rule.id, "UPDATE", { status: rule.status }, { status: "DRAFT" });
      });
      break;
    }
    case "approve": {
      await PermissionService.assert(actor.userId, "sales_pricing", "approve");
      const { comment } = commentSchema.parse(raw ?? {});
      requireStatus(rule, ["PENDING_APPROVAL"], "approved");
      if (!(await canApprovePricing(actor.userId, [rule.createdByUserId, rule.updatedByUserId, rule.submittedByUserId]))) {
        throw new BusinessRuleError("SELF_APPROVAL_NOT_ALLOWED", "Someone other than the person who prepared or submitted this rule must approve it.");
      }
      await prisma.$transaction(async (tx) => {
        await move(tx, rule, { status: "ACTIVE", approvedByUserId: actor.userId, approvedAt: new Date(), approvalComment: comment || null, deactivatedAt: null });
        await recordPricingEvent(tx, actor, "DISCOUNT_RULE", rule.id, "APPROVED", null, comment || null);
        await audit(tx, actor, rule.id, "APPROVE", { status: rule.status }, { status: "ACTIVE" });
      });
      break;
    }
    case "decline": {
      await PermissionService.assert(actor.userId, "sales_pricing", "reject");
      const { reason } = reasonSchema.parse(raw ?? {});
      requireStatus(rule, ["PENDING_APPROVAL"], "declined");
      await prisma.$transaction(async (tx) => {
        await move(tx, rule, { status: "DRAFT", approvalComment: reason, submittedByUserId: null, submittedAt: null });
        await recordPricingEvent(tx, actor, "DISCOUNT_RULE", rule.id, "DECLINED", null, reason);
        await audit(tx, actor, rule.id, "REJECT", { status: rule.status }, { status: "DRAFT", reason });
      });
      break;
    }
    case "deactivate": {
      await PermissionService.assert(actor.userId, "sales_pricing", "edit");
      const { reason } = reasonSchema.parse(raw ?? {});
      requireStatus(rule, ["ACTIVE"], "deactivated");
      await prisma.$transaction(async (tx) => {
        await move(tx, rule, { status: "INACTIVE", deactivatedAt: new Date() });
        await recordPricingEvent(tx, actor, "DISCOUNT_RULE", rule.id, "DEACTIVATED", null, reason);
        await audit(tx, actor, rule.id, "UPDATE", { status: rule.status }, { status: "INACTIVE", reason });
      });
      break;
    }
    default:
      throw new BusinessRuleError("NOT_FOUND", "Unknown discount rule action.", { action });
  }
  return getDiscountRule(actor, id);
}

// ── Read ─────────────────────────────────────────────────────────

const INCLUDE = {
  product: { select: { id: true, styleName: true, styleCode: true } },
  category: { select: { id: true, name: true } },
  customer: { select: { id: true, name: true } },
  priceList: { select: { id: true, code: true, name: true } },
} as const;

export const discountRuleFilterSchema = z.object({ status: z.string().optional() });

export async function listDiscountRules(actor: SalesActor, raw: unknown, page: { skip: number; take: number; search?: string }) {
  const f = discountRuleFilterSchema.parse(raw ?? {});
  const statuses = (f.status ?? "").split(",").filter((s): s is DiscountRule["status"] => ["DRAFT", "PENDING_APPROVAL", "ACTIVE", "INACTIVE"].includes(s));
  const and: Prisma.DiscountRuleWhereInput[] = [{ companyId: actor.companyId }];
  if (statuses.length) and.push({ status: { in: statuses } });
  const term = page.search?.trim();
  if (term) {
    const c = { contains: term, mode: "insensitive" as const };
    and.push({ OR: [{ code: c }, { name: c }] });
  }
  const where = { AND: and };
  const [rows, totalCount] = await Promise.all([
    prisma.discountRule.findMany({ where, include: INCLUDE, orderBy: [{ status: "asc" }, { priority: "desc" }, { code: "asc" }], skip: page.skip, take: page.take }),
    prisma.discountRule.count({ where }),
  ]);
  return { data: rows, totalCount };
}

export async function getDiscountRule(actor: SalesActor, id: string) {
  const rule = await prisma.discountRule.findFirst({
    where: { id, companyId: actor.companyId },
    include: {
      ...INCLUDE,
      createdBy: { select: { fullName: true } },
      updatedBy: { select: { fullName: true } },
      submittedBy: { select: { fullName: true } },
      approvedBy: { select: { fullName: true } },
    },
  });
  if (!rule) throw new BusinessRuleError("NOT_FOUND", "Discount rule not found.", { id });
  const events = await prisma.pricingEvent.findMany({ where: { entityType: "DISCOUNT_RULE", entityId: rule.id }, orderBy: { createdAt: "desc" }, take: 200, include: { createdBy: { select: { fullName: true } } } });
  return {
    ...rule,
    events,
    viewerCanApprove: rule.status === "PENDING_APPROVAL" && (await canApprovePricing(actor.userId, [rule.createdByUserId, rule.updatedByUserId, rule.submittedByUserId])),
  };
}
