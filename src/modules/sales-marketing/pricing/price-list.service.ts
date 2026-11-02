import { Prisma, type PriceListVersion } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/core/db/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { createNotification } from "@/core/notifications/NotificationService";
import { PermissionService } from "@/core/rbac/PermissionService";
import { toIsoDate, todayIsoDate } from "@/lib/date";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { PRICE_LIST_KINDS, versionTimings, type PricingEventType } from "./pricing-registry";

/**
 * Price lists (Sales & Marketing Phase 03, 2026-10-29). Header + numbered
 * versions; only a DRAFT version is edited; approval by someone other than
 * whoever created, last saved or submitted it (`sales_pricing.approve`);
 * approved versions are frozen. Rules: docs/sales-marketing/PHASE_03_PRICING.md §2.
 */

const TABLE = "price_lists";
const MAX_ENTRIES = 2000;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");
const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal("")).nullable();
const blank = (v: string | null | undefined) => (v ? v : null);

export const priceEntrySchema = z.object({
  productId: z.string().uuid("Choose a Style"),
  uomId: z.string().uuid("Choose a unit"),
  minQuantity: z.coerce
    .number()
    .min(0, "Can't be negative")
    .max(99_999_999)
    .refine((v) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6, "Up to 3 decimals")
    .default(0),
  unitPrice: z.coerce
    .number()
    .min(0, "Can't be negative")
    .max(9_999_999_999)
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "Up to 2 decimals"),
  notes: optionalText(300),
});

const versionBody = {
  effectiveFrom: isoDate,
  effectiveTo: isoDate.optional().or(z.literal("")).nullable(),
  changeNote: optionalText(1000),
  entries: z.array(priceEntrySchema).max(MAX_ENTRIES, `At most ${MAX_ENTRIES} prices per version`),
};

export const priceListCreateSchema = z
  .object({
    code: z.string().trim().min(1, "Enter a code").max(40).regex(/^[A-Za-z0-9._-]+$/, "Letters, digits, . _ - only"),
    name: z.string().trim().min(1, "Enter a name").max(200),
    description: optionalText(1000),
    kind: z.enum(["DEFAULT", "CUSTOMER"]),
    customerId: z.string().uuid().optional().or(z.literal("")).nullable(),
    priority: z.coerce.number().int().min(-1000).max(1000).default(0),
    ...versionBody,
  })
  .strict();

export const priceListHeaderSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a name").max(200),
    description: optionalText(1000),
    priority: z.coerce.number().int().min(-1000).max(1000),
  })
  .strict();

export const versionSaveSchema = z.object({ ...versionBody, version: z.number().int().min(1) }).strict();
const commentSchema = z.object({ comment: optionalText(1000) }).strict();
const reasonSchema = z.object({ reason: z.string().trim().min(3, "Say why").max(1000) }).strict();

// ── Helpers ──────────────────────────────────────────────────────

export function recordPricingEvent(
  tx: Prisma.TransactionClient,
  actor: SalesActor,
  entityType: "PRICE_LIST" | "DISCOUNT_RULE",
  entityId: string,
  type: PricingEventType,
  versionNumber: number | null = null,
  comment: string | null = null,
  metadata: Record<string, unknown> = {}
) {
  return tx.pricingEvent.create({
    data: { companyId: actor.companyId, entityType, entityId, versionNumber, type, comment, metadata: metadata as Prisma.InputJsonValue, createdByUserId: actor.userId },
  });
}

async function audit(tx: Prisma.TransactionClient, actor: SalesActor, recordId: string, action: "CREATE" | "UPDATE" | "APPROVE" | "REJECT" | "DELETE", oldValues: unknown, newValues: unknown) {
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: TABLE, recordId, action, oldValues: oldValues as Record<string, unknown>, newValues: newValues as Record<string, unknown> }, tx);
}

async function loadList(actor: SalesActor, id: string) {
  const list = await prisma.priceList.findFirst({ where: { id, companyId: actor.companyId } });
  if (!list) throw new BusinessRuleError("NOT_FOUND", "Price list not found.", { id });
  return list;
}

async function loadVersion(actor: SalesActor, listId: string, versionId: string) {
  const list = await loadList(actor, listId);
  const version = await prisma.priceListVersion.findFirst({ where: { id: versionId, priceListId: list.id } });
  if (!version) throw new BusinessRuleError("NOT_FOUND", "Version not found.", { versionId });
  return { list, version };
}

/** Checks entries: Styles / units exist, no duplicate Style + unit + from-quantity. */
async function validateEntries(actor: SalesActor, entries: z.infer<typeof priceEntrySchema>[]) {
  const productIds = [...new Set(entries.map((e) => e.productId))];
  const uomIds = [...new Set(entries.map((e) => e.uomId))];
  const [products, units] = await Promise.all([
    prisma.product.findMany({ where: { id: { in: productIds }, companyId: actor.companyId, deletedAt: null }, select: { id: true, itemType: true, styleName: true } }),
    prisma.unitOfMeasure.findMany({ where: { id: { in: uomIds } }, select: { id: true, code: true } }),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const unitById = new Map(units.map((u) => [u.id, u]));
  const seen = new Set<string>();
  entries.forEach((e, i) => {
    const at = (msg: string, field: string) => new BusinessRuleError("VALIDATION_ERROR", `Price ${i + 1}: ${msg}`, { fieldErrors: { [`entries.${i}.${field}`]: msg } });
    const p = productById.get(e.productId);
    if (!p) throw at("style not found.", "productId");
    if (p.itemType !== "STYLE") throw at("pick a Style, not a raw material.", "productId");
    if (!unitById.has(e.uomId)) throw at("unit not found.", "uomId");
    const key = `${e.productId}|${e.uomId}|${new Prisma.Decimal(e.minQuantity).toFixed(3)}`;
    if (seen.has(key)) throw at(`${p.styleName} already has a price from ${e.minQuantity} ${unitById.get(e.uomId)!.code} in this version.`, "minQuantity");
    seen.add(key);
  });
}

function checkDates(effectiveFrom: string, effectiveTo: string | null | undefined) {
  if (effectiveTo && effectiveTo < effectiveFrom) {
    throw new BusinessRuleError("VALIDATION_ERROR", "The end date is before the start date.", { fieldErrors: { effectiveTo: "Before the start date." } });
  }
}

/** Two active lists of the same kind (and customer) can't share a priority. */
async function assertPriorityFree(actor: SalesActor, list: { id?: string; kind: "DEFAULT" | "CUSTOMER"; customerId: string | null; priority: number }) {
  const clash = await prisma.priceList.findFirst({
    where: { companyId: actor.companyId, kind: list.kind, customerId: list.customerId, priority: list.priority, isActive: true, ...(list.id ? { id: { not: list.id } } : {}) },
    select: { code: true },
  });
  if (clash) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      `Active price list ${clash.code} already has priority ${list.priority} for the same ${list.kind === "CUSTOMER" ? "customer" : "default prices"}. Use another priority so it's clear which list wins.`,
      { fieldErrors: { priority: "Already used." } }
    );
  }
}

/** Friendly message for the partial unique indexes. */
function uniqueViolation(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    const target = JSON.stringify(error.meta ?? {});
    if (target.includes("code")) throw new BusinessRuleError("VALIDATION_ERROR", "A price list with this code already exists.", { fieldErrors: { code: "Already used." } });
    if (target.includes("priority")) throw new BusinessRuleError("VALIDATION_ERROR", "Another active price list already uses this priority.", { fieldErrors: { priority: "Already used." } });
    if (target.includes("one_open")) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This price list already has a draft or pending version.");
    if (target.includes("approved_start")) throw new BusinessRuleError("VALIDATION_ERROR", "Another approved version of this list starts on the same day.", { fieldErrors: { effectiveFrom: "Already used." } });
    throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This price list changed just now. Reload and try again.");
  }
  throw error;
}

const entryRows = (entries: z.infer<typeof priceEntrySchema>[]) =>
  entries.map((e) => ({ productId: e.productId, uomId: e.uomId, minQuantity: e.minQuantity ?? 0, unitPrice: e.unitPrice, notes: blank(e.notes) }));

// ── Create / edit ────────────────────────────────────────────────

export async function createPriceList(actor: SalesActor, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_pricing", "create");
  const input = priceListCreateSchema.parse(raw);
  const customerId = input.kind === "CUSTOMER" ? input.customerId || null : null;
  if (input.kind === "CUSTOMER") {
    if (!customerId) throw new BusinessRuleError("VALIDATION_ERROR", "Choose the customer for a customer price list.", { fieldErrors: { customerId: "Required." } });
    const c = await prisma.customer.findFirst({ where: { id: customerId, companyId: actor.companyId, deletedAt: null }, select: { id: true } });
    if (!c) throw new BusinessRuleError("NOT_FOUND", "Customer not found.", { id: customerId });
  }
  checkDates(input.effectiveFrom, input.effectiveTo);
  await validateEntries(actor, input.entries);
  await assertPriorityFree(actor, { kind: input.kind, customerId, priority: input.priority });
  if (await prisma.priceList.findFirst({ where: { companyId: actor.companyId, code: input.code.toUpperCase() }, select: { id: true } })) {
    throw new BusinessRuleError("VALIDATION_ERROR", "A price list with this code already exists.", { fieldErrors: { code: "Already used." } });
  }
  const company = await prisma.company.findUniqueOrThrow({ where: { id: actor.companyId }, select: { baseCurrencyCode: true } });
  try {
    return await prisma.$transaction(async (tx) => {
      const list = await tx.priceList.create({
        data: {
          companyId: actor.companyId,
          code: input.code.toUpperCase(),
          name: input.name,
          description: blank(input.description),
          kind: input.kind,
          customerId,
          currencyCode: company.baseCurrencyCode,
          priority: input.priority,
          createdByUserId: actor.userId,
          versions: {
            create: {
              companyId: actor.companyId,
              versionNumber: 1,
              status: "DRAFT",
              effectiveFrom: new Date(input.effectiveFrom),
              effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null,
              changeNote: blank(input.changeNote),
              createdByUserId: actor.userId,
              entries: { create: entryRows(input.entries) },
            },
          },
        },
      });
      await recordPricingEvent(tx, actor, "PRICE_LIST", list.id, "CREATED", 1, null, { entries: input.entries.length });
      await audit(tx, actor, list.id, "CREATE", null, { code: list.code, kind: list.kind, customerId, priority: list.priority, entries: input.entries.length });
      return list;
    });
  } catch (error) {
    uniqueViolation(error);
  }
}

export async function updatePriceListHeader(actor: SalesActor, id: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_pricing", "edit");
  const input = priceListHeaderSchema.parse(raw);
  const list = await loadList(actor, id);
  if (list.isActive && input.priority !== list.priority) await assertPriorityFree(actor, { id: list.id, kind: list.kind, customerId: list.customerId, priority: input.priority });
  try {
    await prisma.$transaction(async (tx) => {
      await tx.priceList.updateMany({ where: { id: list.id, companyId: actor.companyId }, data: { name: input.name, description: blank(input.description), priority: input.priority } });
      await recordPricingEvent(tx, actor, "PRICE_LIST", list.id, "UPDATED", null, null, { name: input.name, priority: input.priority });
      await audit(tx, actor, list.id, "UPDATE", { name: list.name, description: list.description, priority: list.priority }, input);
    });
  } catch (error) {
    uniqueViolation(error);
  }
  return getPriceList(actor, id);
}

export async function saveDraftVersion(actor: SalesActor, id: string, versionId: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_pricing", "edit");
  const input = versionSaveSchema.parse(raw);
  const { list, version } = await loadVersion(actor, id, versionId);
  if (version.status !== "DRAFT") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Only a draft version can be edited. Start a new version to change prices.");
  if (version.version !== input.version) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "Someone else saved this version after you opened it. Reload to see their changes.");
  checkDates(input.effectiveFrom, input.effectiveTo);
  await validateEntries(actor, input.entries);
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.priceListVersion.updateMany({
      where: { id: version.id, status: "DRAFT", version: input.version },
      data: { effectiveFrom: new Date(input.effectiveFrom), effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null, changeNote: blank(input.changeNote), updatedByUserId: actor.userId, version: { increment: 1 } },
    });
    if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "Someone else saved this version just now. Reload and try again.");
    await tx.priceListEntry.deleteMany({ where: { versionId: version.id } });
    await tx.priceListEntry.createMany({ data: entryRows(input.entries).map((e) => ({ ...e, versionId: version.id })) });
    await recordPricingEvent(tx, actor, "PRICE_LIST", list.id, "UPDATED", version.versionNumber, null, { entries: input.entries.length });
    await audit(tx, actor, list.id, "UPDATE", { versionNumber: version.versionNumber, version: version.version }, { versionNumber: version.versionNumber, entries: input.entries.length, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo || null });
  });
  return getPriceList(actor, id, version.versionNumber);
}

/** Starts a new DRAFT version as a copy of the latest approved one (or the latest one). */
export async function startNewVersion(actor: SalesActor, id: string) {
  await PermissionService.assert(actor.userId, "sales_pricing", "edit");
  const list = await loadList(actor, id);
  const versions = await prisma.priceListVersion.findMany({ where: { priceListId: list.id }, orderBy: { versionNumber: "desc" }, include: { entries: true } });
  if (versions.some((v) => v.status === "DRAFT" || v.status === "PENDING_APPROVAL")) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This price list already has a draft or pending version — finish or discard it first.");
  }
  const source = versions.find((v) => v.status === "APPROVED") ?? versions[0];
  const next = (versions[0]?.versionNumber ?? 0) + 1;
  const today = todayIsoDate();
  const start = source && toIsoDate(source.effectiveFrom) > today ? toIsoDate(source.effectiveFrom) : today;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.priceListVersion.create({
        data: {
          companyId: actor.companyId,
          priceListId: list.id,
          versionNumber: next,
          status: "DRAFT",
          effectiveFrom: new Date(start),
          createdByUserId: actor.userId,
          entries: { create: (source?.entries ?? []).map((e) => ({ productId: e.productId, uomId: e.uomId, minQuantity: e.minQuantity, unitPrice: e.unitPrice, notes: e.notes })) },
        },
      });
      await recordPricingEvent(tx, actor, "PRICE_LIST", list.id, "VERSION_CREATED", next, null, { copiedFrom: source?.versionNumber ?? null });
      await audit(tx, actor, list.id, "UPDATE", null, { versionNumber: next, copiedFrom: source?.versionNumber ?? null });
    });
  } catch (error) {
    uniqueViolation(error);
  }
  return getPriceList(actor, id, next);
}

// ── Version lifecycle ────────────────────────────────────────────

async function guardedMove(tx: Prisma.TransactionClient, version: PriceListVersion, data: Prisma.PriceListVersionUncheckedUpdateManyInput) {
  const { count } = await tx.priceListVersion.updateMany({ where: { id: version.id, status: version.status, version: version.version }, data: { ...data, version: { increment: 1 } } });
  if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This version changed just now. Reload and try again.");
}

function requireStatus(version: PriceListVersion, allowed: string[], verb: string) {
  if (!allowed.includes(version.status)) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `A ${version.status.toLowerCase().replace(/_/g, " ")} version can't be ${verb}.`, { status: version.status });
}

/** True when `userId` may approve: holds sales_pricing.approve and didn't create, save or submit it. */
export async function canApprovePricing(userId: string, involved: (string | null)[]) {
  const people = [...new Set(involved.filter((v): v is string => Boolean(v)))];
  if (!people.length) return PermissionService.can(userId, "sales_pricing", "approve");
  for (const createdBy of people) if (!(await PermissionService.can(userId, "sales_pricing", "approve", { createdBy }))) return false;
  return true;
}

async function notifyApprovers(tx: Prisma.TransactionClient, actor: SalesActor, exclude: (string | null)[], title: string, body: string) {
  const users = await prisma.user.findMany({ where: { companyId: actor.companyId, status: "ACTIVE", supportForPlatformUserId: null }, select: { id: true } });
  const ok = await Promise.all(users.map((u) => PermissionService.can(u.id, "sales_pricing", "approve")));
  for (const u of users.filter((x, i) => ok[i] && !exclude.includes(x.id))) await createNotification({ companyId: actor.companyId, userId: u.id, title, body }, tx);
}

export async function priceVersionAction(actor: SalesActor, id: string, versionId: string, action: string, raw: unknown) {
  const { list, version } = await loadVersion(actor, id, versionId);
  const label = `${list.code} v${version.versionNumber}`;
  switch (action) {
    case "submit": {
      await PermissionService.assert(actor.userId, "sales_pricing", "edit");
      const { comment } = commentSchema.parse(raw ?? {});
      requireStatus(version, ["DRAFT"], "submitted");
      const count = await prisma.priceListEntry.count({ where: { versionId: version.id } });
      if (!count) throw new BusinessRuleError("VALIDATION_ERROR", "Add at least one price before submitting.");
      if (toIsoDate(version.effectiveFrom) < todayIsoDate()) throw new BusinessRuleError("VALIDATION_ERROR", "The start date is in the past. Edit the draft and set today or a later date.", { fieldErrors: { effectiveFrom: "In the past." } });
      await prisma.$transaction(async (tx) => {
        await guardedMove(tx, version, { status: "PENDING_APPROVAL", submittedByUserId: actor.userId, submittedAt: new Date() });
        await recordPricingEvent(tx, actor, "PRICE_LIST", list.id, "SUBMITTED", version.versionNumber, comment || null, { entries: count });
        await audit(tx, actor, list.id, "UPDATE", { status: version.status }, { status: "PENDING_APPROVAL", versionNumber: version.versionNumber });
        await notifyApprovers(tx, actor, [actor.userId, version.createdByUserId, version.updatedByUserId], `Price list ${label} waits for approval`, list.name);
      });
      break;
    }
    case "return-to-draft": {
      await PermissionService.assert(actor.userId, "sales_pricing", "edit");
      const { comment } = commentSchema.parse(raw ?? {});
      requireStatus(version, ["PENDING_APPROVAL"], "returned to draft");
      await prisma.$transaction(async (tx) => {
        await guardedMove(tx, version, { status: "DRAFT", submittedByUserId: null, submittedAt: null });
        await recordPricingEvent(tx, actor, "PRICE_LIST", list.id, "RETURNED_TO_DRAFT", version.versionNumber, comment || null);
        await audit(tx, actor, list.id, "UPDATE", { status: version.status }, { status: "DRAFT", versionNumber: version.versionNumber });
      });
      break;
    }
    case "approve": {
      await PermissionService.assert(actor.userId, "sales_pricing", "approve");
      const { comment } = commentSchema.parse(raw ?? {});
      requireStatus(version, ["PENDING_APPROVAL"], "approved");
      if (!(await canApprovePricing(actor.userId, [version.createdByUserId, version.updatedByUserId, version.submittedByUserId]))) {
        throw new BusinessRuleError("SELF_APPROVAL_NOT_ALLOWED", "Someone other than the person who prepared or submitted this version must approve it.");
      }
      if (toIsoDate(version.effectiveFrom) < todayIsoDate()) {
        throw new BusinessRuleError("VALIDATION_ERROR", "The start date has passed. Return it to draft and set a new start date — prices can't be approved for the past.");
      }
      const sameStart = await prisma.priceListVersion.findFirst({ where: { priceListId: list.id, status: "APPROVED", effectiveFrom: version.effectiveFrom }, select: { versionNumber: true } });
      if (sameStart) throw new BusinessRuleError("VALIDATION_ERROR", `Version ${sameStart.versionNumber} already starts on that day. Return this version to draft and pick another start date.`);
      try {
        await prisma.$transaction(async (tx) => {
          await guardedMove(tx, version, { status: "APPROVED", approvedByUserId: actor.userId, approvedAt: new Date(), approvalComment: comment || null });
          await recordPricingEvent(tx, actor, "PRICE_LIST", list.id, "APPROVED", version.versionNumber, comment || null, { effectiveFrom: toIsoDate(version.effectiveFrom) });
          await audit(tx, actor, list.id, "APPROVE", { status: version.status }, { status: "APPROVED", versionNumber: version.versionNumber, effectiveFrom: toIsoDate(version.effectiveFrom) });
          for (const userId of new Set([version.createdByUserId, version.submittedByUserId].filter((u): u is string => Boolean(u) && u !== actor.userId))) {
            await createNotification({ companyId: actor.companyId, userId, title: `Price list ${label} approved`, body: `In force from ${toIsoDate(version.effectiveFrom)}.` }, tx);
          }
        });
      } catch (error) {
        uniqueViolation(error);
      }
      break;
    }
    case "decline": {
      await PermissionService.assert(actor.userId, "sales_pricing", "reject");
      const { reason } = reasonSchema.parse(raw ?? {});
      requireStatus(version, ["PENDING_APPROVAL"], "declined");
      await prisma.$transaction(async (tx) => {
        await guardedMove(tx, version, { status: "DRAFT", approvalComment: reason, submittedByUserId: null, submittedAt: null });
        await recordPricingEvent(tx, actor, "PRICE_LIST", list.id, "DECLINED", version.versionNumber, reason);
        await audit(tx, actor, list.id, "REJECT", { status: version.status }, { status: "DRAFT", versionNumber: version.versionNumber, reason });
        for (const userId of new Set([version.createdByUserId, version.submittedByUserId].filter((u): u is string => Boolean(u) && u !== actor.userId))) {
          await createNotification({ companyId: actor.companyId, userId, title: `Price list ${label} sent back`, body: reason }, tx);
        }
      });
      break;
    }
    case "withdraw": {
      await PermissionService.assert(actor.userId, "sales_pricing", "edit");
      const { reason } = reasonSchema.parse(raw ?? {});
      requireStatus(version, ["APPROVED"], "withdrawn");
      if (toIsoDate(version.effectiveFrom) <= todayIsoDate()) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This version has already started. Start a new version to change prices from a date.");
      await prisma.$transaction(async (tx) => {
        await guardedMove(tx, version, { status: "WITHDRAWN", withdrawnAt: new Date() });
        await recordPricingEvent(tx, actor, "PRICE_LIST", list.id, "WITHDRAWN", version.versionNumber, reason);
        await audit(tx, actor, list.id, "UPDATE", { status: version.status }, { status: "WITHDRAWN", versionNumber: version.versionNumber, reason });
      });
      break;
    }
    case "discard": {
      await PermissionService.assert(actor.userId, "sales_pricing", "edit");
      requireStatus(version, ["DRAFT"], "discarded");
      const others = await prisma.priceListVersion.count({ where: { priceListId: list.id, id: { not: version.id } } });
      await prisma.$transaction(async (tx) => {
        const { count } = await tx.priceListVersion.deleteMany({ where: { id: version.id, status: "DRAFT", version: version.version } });
        if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This version changed just now. Reload and try again.");
        if (!others) {
          // A list that never had another version goes away with its only draft.
          const used = await tx.discountRule.count({ where: { priceListId: list.id } });
          if (used) throw new BusinessRuleError("REFERENCED_RECORD_IN_USE", "Discount rules refer to this price list. Change them first.");
          await tx.pricingEvent.deleteMany({ where: { entityType: "PRICE_LIST", entityId: list.id } });
          await tx.priceList.delete({ where: { id: list.id } });
          await audit(tx, actor, list.id, "DELETE", { code: list.code }, null);
        } else {
          await recordPricingEvent(tx, actor, "PRICE_LIST", list.id, "DISCARDED", version.versionNumber);
          await audit(tx, actor, list.id, "UPDATE", { versionNumber: version.versionNumber }, { discarded: true });
        }
      });
      if (!others) return { id: list.id, deleted: true as const };
      break;
    }
    default:
      throw new BusinessRuleError("NOT_FOUND", "Unknown price list action.", { action });
  }
  return getPriceList(actor, id, version.versionNumber);
}

export async function priceListAction(actor: SalesActor, id: string, action: string) {
  await PermissionService.assert(actor.userId, "sales_pricing", "edit");
  const list = await loadList(actor, id);
  if (action !== "deactivate" && action !== "reactivate") throw new BusinessRuleError("NOT_FOUND", "Unknown price list action.", { action });
  const isActive = action === "reactivate";
  if (list.isActive === isActive) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `This price list is already ${isActive ? "active" : "inactive"}.`);
  if (isActive) await assertPriorityFree(actor, { id: list.id, kind: list.kind, customerId: list.customerId, priority: list.priority });
  try {
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.priceList.updateMany({ where: { id: list.id, isActive: list.isActive }, data: { isActive } });
      if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This price list changed just now. Reload and try again.");
      await recordPricingEvent(tx, actor, "PRICE_LIST", list.id, isActive ? "REACTIVATED" : "DEACTIVATED");
      await audit(tx, actor, list.id, "UPDATE", { isActive: list.isActive }, { isActive });
    });
  } catch (error) {
    uniqueViolation(error);
  }
  return getPriceList(actor, id);
}

// ── Read ─────────────────────────────────────────────────────────

export const priceListFilterSchema = z.object({
  kind: z.enum(["DEFAULT", "CUSTOMER"]).optional().or(z.literal("")),
  customerId: z.string().uuid().optional().or(z.literal("")),
  status: z.enum(["active", "inactive", "pending", "all"]).optional().or(z.literal("")),
});

export async function listPriceLists(actor: SalesActor, raw: unknown, page: { skip: number; take: number; search?: string }) {
  const f = priceListFilterSchema.parse(raw ?? {});
  const and: Prisma.PriceListWhereInput[] = [{ companyId: actor.companyId }];
  if (f.kind) and.push({ kind: f.kind });
  if (f.customerId) and.push({ customerId: f.customerId });
  if (f.status === "active" || !f.status) and.push({ isActive: true });
  else if (f.status === "inactive") and.push({ isActive: false });
  else if (f.status === "pending") and.push({ versions: { some: { status: "PENDING_APPROVAL" } } });
  const term = page.search?.trim();
  if (term) {
    const c = { contains: term, mode: "insensitive" as const };
    and.push({ OR: [{ code: c }, { name: c }, { customer: { name: c } }] });
  }
  const where = { AND: and };
  const [rows, totalCount] = await Promise.all([
    prisma.priceList.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true } },
        versions: { select: { id: true, versionNumber: true, status: true, effectiveFrom: true, effectiveTo: true, _count: { select: { entries: true } } }, orderBy: { versionNumber: "desc" } },
      },
      orderBy: [{ kind: "asc" }, { priority: "desc" }, { code: "asc" }],
      skip: page.skip,
      take: page.take,
    }),
    prisma.priceList.count({ where }),
  ]);
  const today = todayIsoDate();
  return {
    // `active`, not `isActive`: DataTable would add its own on/off toggle for an `isActive` field.
    data: rows.map(({ versions, isActive, ...l }) => {
      const vs = versions.map((v) => ({ ...v, effectiveFrom: toIsoDate(v.effectiveFrom), effectiveTo: v.effectiveTo ? toIsoDate(v.effectiveTo) : null }));
      const timing = versionTimings(vs, today);
      const inForce = vs.find((v) => timing[v.id] === "IN_FORCE") ?? null;
      const scheduled = vs.filter((v) => timing[v.id] === "SCHEDULED").sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1))[0] ?? null;
      const open = vs.find((v) => v.status === "DRAFT" || v.status === "PENDING_APPROVAL") ?? null;
      return {
        ...l,
        active: isActive,
        kindLabel: PRICE_LIST_KINDS[l.kind],
        inForce: inForce ? { versionNumber: inForce.versionNumber, effectiveFrom: inForce.effectiveFrom, effectiveTo: inForce.effectiveTo, entries: inForce._count.entries } : null,
        scheduled: scheduled ? { versionNumber: scheduled.versionNumber, effectiveFrom: scheduled.effectiveFrom } : null,
        open: open ? { versionNumber: open.versionNumber, status: open.status } : null,
      };
    }),
    totalCount,
  };
}

/** Header, all versions (with derived timing), one version's entries (default: open draft/pending, else in force, else latest), history. */
export async function getPriceList(actor: SalesActor, id: string, versionNumber?: number) {
  const list = await prisma.priceList.findFirst({
    where: { id, companyId: actor.companyId },
    include: {
      customer: { select: { id: true, name: true, code: true } },
      createdBy: { select: { fullName: true } },
      versions: {
        orderBy: { versionNumber: "desc" },
        include: {
          createdBy: { select: { id: true, fullName: true } },
          updatedBy: { select: { id: true, fullName: true } },
          submittedBy: { select: { id: true, fullName: true } },
          approvedBy: { select: { id: true, fullName: true } },
          _count: { select: { entries: true } },
        },
      },
    },
  });
  if (!list) throw new BusinessRuleError("NOT_FOUND", "Price list not found.", { id });
  const today = todayIsoDate();
  const versions = list.versions.map((v) => ({ ...v, effectiveFrom: toIsoDate(v.effectiveFrom), effectiveTo: v.effectiveTo ? toIsoDate(v.effectiveTo) : null }));
  const timing = versionTimings(versions, today);
  const pick =
    (versionNumber && versions.find((v) => v.versionNumber === versionNumber)) ||
    versions.find((v) => v.status === "DRAFT" || v.status === "PENDING_APPROVAL") ||
    versions.find((v) => timing[v.id] === "IN_FORCE") ||
    versions[0];
  const [entries, events, usedByRules] = await Promise.all([
    pick
      ? prisma.priceListEntry.findMany({
          where: { versionId: pick.id },
          include: { product: { select: { id: true, styleName: true, styleCode: true } }, uom: { select: { id: true, code: true } } },
          orderBy: [{ product: { styleName: "asc" } }, { uom: { code: "asc" } }, { minQuantity: "asc" }],
        })
      : Promise.resolve([]),
    prisma.pricingEvent.findMany({ where: { entityType: "PRICE_LIST", entityId: list.id }, orderBy: { createdAt: "desc" }, take: 200, include: { createdBy: { select: { fullName: true } } } }),
    prisma.discountRule.findMany({ where: { priceListId: list.id }, select: { id: true, code: true, name: true, status: true } }),
  ]);
  return {
    ...list,
    kindLabel: PRICE_LIST_KINDS[list.kind],
    versions: versions.map((v) => ({ ...v, timing: timing[v.id] ?? null })),
    selected: pick ? { ...pick, timing: timing[pick.id] ?? null, entries, viewerCanApprove: pick.status === "PENDING_APPROVAL" && (await canApprovePricing(actor.userId, [pick.createdByUserId, pick.updatedByUserId, pick.submittedByUserId])) } : null,
    events,
    usedByRules,
  };
}
