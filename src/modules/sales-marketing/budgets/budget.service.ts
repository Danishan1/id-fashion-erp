import { Prisma, type MarketingCampaign } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { createNotification } from "@/core/notifications/NotificationService";
import { PermissionService } from "@/core/rbac/PermissionService";
import { todayIsoDate, toIsoDate } from "@/lib/date";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { getSalesMarketingSettings } from "@/modules/sales-marketing/settings/sales-marketing-settings.service";
import { auditCampaign, campaignScopeWhere, getCampaignScope, loadCampaign, recordCampaignEvent } from "@/modules/sales-marketing/campaigns/campaign-common";
import { ensureCampaignLookups } from "@/modules/sales-marketing/campaigns/campaign-lookup.service";
import { budgetAlertConditions, computeBudget, NOT_ALLOCATED, type BudgetComputation } from "./budget-math";

/**
 * Campaign budgets (Sales & Marketing Phase 12): allocation lines under the
 * Phase 08 approved budget, spend linked from Finance (Expenses, Purchase
 * Orders, Purchase Invoices — the records themselves carry the campaign and
 * budget line), live measures (budget-math.ts) and alerts.
 */

type Db = Prisma.TransactionClient | typeof prisma;
const ALLOC_TABLE = "marketing_budget_allocations";
const r2 = (v: number) => Math.round(v * 100) / 100;

export type SpendKind = "EXPENSE" | "PURCHASE_ORDER" | "PURCHASE_INVOICE";
const SPEND_PERMISSION: Record<SpendKind, "expenses" | "purchase_order" | "invoices"> = { EXPENSE: "expenses", PURCHASE_ORDER: "purchase_order", PURCHASE_INVOICE: "invoices" };
const SPEND_LABEL: Record<SpendKind, string> = { EXPENSE: "expense", PURCHASE_ORDER: "purchase order", PURCHASE_INVOICE: "purchase invoice" };

/** The approved budget: the planned budget only once a revision has been approved. */
export function approvedBudget(c: Pick<MarketingCampaign, "plannedBudget" | "approvedRevisionNumber">) {
  return c.approvedRevisionNumber !== null && c.plannedBudget !== null ? r2(Number(c.plannedBudget)) : null;
}

const campaignEnded = (c: Pick<MarketingCampaign, "status" | "plannedEndDate">, today: string) => c.status === "COMPLETED" || (c.status !== "CANCELLED" && toIsoDate(c.plannedEndDate) < today);

// ── Loading ──────────────────────────────────────────────────────

interface LoadedSpend {
  allocations: Prisma.MarketingBudgetAllocationGetPayload<{ include: { category: { select: { name: true } } } }>[];
  expenses: { id: string; number: string; date: Date; description: string; amount: number; status: string; campaignId: string; allocationId: string | null }[];
  purchaseOrders: { id: string; number: string; date: Date; supplier: string; baseTotal: number; status: string; campaignId: string; allocationId: string | null }[];
  invoices: { id: string; number: string; date: Date; supplier: string; baseSubtotal: number; status: string; campaignId: string; allocationId: string | null; purchaseOrderId: string | null; inherited: boolean }[];
  invoicedByPo: Record<string, number>;
}

async function loadSpend(db: Db, companyId: string, campaignIds: string[]): Promise<LoadedSpend> {
  if (!campaignIds.length) return { allocations: [], expenses: [], purchaseOrders: [], invoices: [], invoicedByPo: {} };
  const [allocations, expenses, pos, pis] = await Promise.all([
    db.marketingBudgetAllocation.findMany({ where: { companyId, campaignId: { in: campaignIds } }, include: { category: { select: { name: true } } }, orderBy: { createdAt: "asc" } }),
    db.expense.findMany({
      where: { companyId, campaignId: { in: campaignIds }, status: { notIn: ["REJECTED", "CANCELLED"] } },
      select: { id: true, expenseNumber: true, expenseDate: true, description: true, amount: true, status: true, campaignId: true, budgetAllocationId: true },
    }),
    db.purchaseOrder.findMany({
      where: { companyId, campaignId: { in: campaignIds }, status: { not: "CANCELLED" } },
      select: { id: true, orderNumber: true, orderDate: true, baseTotalAmount: true, status: true, campaignId: true, budgetAllocationId: true, supplier: { select: { name: true } } },
    }),
    db.purchaseInvoice.findMany({
      where: { companyId, status: { not: "CANCELLED" }, OR: [{ campaignId: { in: campaignIds } }, { campaignId: null, purchaseOrder: { campaignId: { in: campaignIds } } }] },
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        subtotalAmount: true,
        exchangeRate: true,
        status: true,
        campaignId: true,
        budgetAllocationId: true,
        purchaseOrderId: true,
        supplier: { select: { name: true } },
        purchaseOrder: { select: { campaignId: true, budgetAllocationId: true } },
      },
    }),
  ]);
  const poIds = pos.map((p) => p.id);
  const invoicedRows = poIds.length
    ? await db.purchaseInvoice.findMany({
        where: { companyId, purchaseOrderId: { in: poIds }, status: { in: ["POSTED", "PARTIALLY_PAID", "PAID", "CLOSED"] } },
        select: { purchaseOrderId: true, subtotalAmount: true, exchangeRate: true },
      })
    : [];
  const invoicedByPo: Record<string, number> = {};
  for (const i of invoicedRows) if (i.purchaseOrderId) invoicedByPo[i.purchaseOrderId] = (invoicedByPo[i.purchaseOrderId] ?? 0) + Number(i.subtotalAmount) * Number(i.exchangeRate);

  return {
    allocations,
    expenses: expenses.map((e) => ({ id: e.id, number: e.expenseNumber, date: e.expenseDate, description: e.description, amount: Number(e.amount), status: e.status, campaignId: e.campaignId!, allocationId: e.budgetAllocationId })),
    purchaseOrders: pos.map((p) => ({ id: p.id, number: p.orderNumber, date: p.orderDate, supplier: p.supplier.name, baseTotal: Number(p.baseTotalAmount), status: p.status, campaignId: p.campaignId!, allocationId: p.budgetAllocationId })),
    invoices: pis.map((i) => {
      const inherited = !i.campaignId;
      return {
        id: i.id,
        number: i.invoiceNumber,
        date: i.invoiceDate,
        supplier: i.supplier.name,
        baseSubtotal: r2(Number(i.subtotalAmount) * Number(i.exchangeRate)),
        status: i.status,
        campaignId: (i.campaignId ?? i.purchaseOrder?.campaignId)!,
        allocationId: inherited ? (i.purchaseOrder?.budgetAllocationId ?? null) : i.budgetAllocationId,
        purchaseOrderId: i.purchaseOrderId,
        inherited,
      };
    }),
    invoicedByPo,
  };
}

function computeFor(c: Pick<MarketingCampaign, "id" | "plannedBudget" | "approvedRevisionNumber">, s: LoadedSpend): BudgetComputation {
  const pos = s.purchaseOrders.filter((p) => p.campaignId === c.id);
  return computeBudget({
    approved: approvedBudget(c),
    allocations: s.allocations.filter((a) => a.campaignId === c.id).map((a) => ({ id: a.id, amount: Number(a.amount) })),
    expenses: s.expenses.filter((e) => e.campaignId === c.id),
    purchaseOrders: pos,
    invoices: s.invoices.filter((i) => i.campaignId === c.id).map((i) => ({ ...i, counts: true })),
    invoicedByPo: Object.fromEntries(pos.map((p) => [p.id, s.invoicedByPo[p.id] ?? 0])),
  });
}

/** Budget figures for several campaigns (reports, overview). */
export async function measureBudgets(companyId: string, campaigns: Pick<MarketingCampaign, "id" | "plannedBudget" | "approvedRevisionNumber">[], db: Db = prisma) {
  const spend = await loadSpend(db, companyId, campaigns.map((c) => c.id));
  return new Map(campaigns.map((c) => [c.id, computeFor(c, spend)]));
}

// ── Campaign budget panel ────────────────────────────────────────

export async function getCampaignBudget(actor: SalesActor, campaignId: string) {
  const c = await loadCampaign(actor, campaignId);
  await ensureCampaignLookups(actor.companyId); // the default spend categories exist from the first visit
  const [spend, canExp, canPo, canPi, canEdit, alerts] = await Promise.all([
    loadSpend(prisma, actor.companyId, [c.id]),
    PermissionService.can(actor.userId, "expenses", "view"),
    PermissionService.can(actor.userId, "purchase_order", "view"),
    PermissionService.can(actor.userId, "invoices", "view"),
    PermissionService.can(actor.userId, "marketing_campaigns", "edit"),
    prisma.marketingBudgetAlert.findMany({ where: { companyId: actor.companyId, campaignId: c.id }, orderBy: { raisedAt: "desc" }, take: 50 }),
  ]);
  const [categories, channels] = await Promise.all([
    prisma.marketingCampaignLookup.findMany({ where: { companyId: actor.companyId, kind: "SPEND_CATEGORY", isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    prisma.marketingCampaignChannel.findMany({ where: { companyId: actor.companyId, campaignId: c.id }, select: { id: true, connection: { select: { name: true } }, template: { select: { name: true } } } }),
  ]);
  const m = computeFor(c, spend);
  const allocName = new Map(spend.allocations.map((a) => [a.id, a.name]));
  const line = (id: string | null) => (id ? (allocName.get(id) ?? null) : null);
  return {
    campaignId: c.id,
    currencyCode: c.currencyCode,
    approved: approvedBudget(c),
    plannedNotApproved: c.approvedRevisionNumber === null && c.plannedBudget !== null ? r2(Number(c.plannedBudget)) : null,
    canEdit: canEdit && c.status !== "CANCELLED",
    canLink: canEdit && c.status !== "DRAFT" && c.status !== "CANCELLED",
    totals: { ...m, byAllocation: undefined },
    allocations: [
      ...spend.allocations.map((a) => ({
        id: a.id,
        name: a.name,
        category: a.category.name,
        categoryId: a.categoryId,
        campaignChannelId: a.campaignChannelId,
        notes: a.notes,
        status: a.status,
        version: a.version,
        ...m.byAllocation[a.id],
      })),
      { id: NOT_ALLOCATED, name: "Not allocated", category: "—", categoryId: null, campaignChannelId: null, notes: null, status: "ACTIVE", version: 0, ...m.byAllocation[NOT_ALLOCATED] },
    ],
    // Documents are listed only to people who may see that kind of record; their amounts are in the totals either way.
    expenses: canExp ? spend.expenses.map((e) => ({ id: e.id, number: e.number, date: toIsoDate(e.date), description: e.description, amount: r2(e.amount), status: e.status, allocationId: e.allocationId, allocation: line(e.allocationId) })) : null,
    purchaseOrders: canPo
      ? spend.purchaseOrders.map((p) => ({
          id: p.id,
          number: p.number,
          date: toIsoDate(p.date),
          supplier: p.supplier,
          amount: r2(p.baseTotal),
          invoiced: r2(spend.invoicedByPo[p.id] ?? 0),
          status: p.status,
          allocationId: p.allocationId,
          allocation: line(p.allocationId),
        }))
      : null,
    purchaseInvoices: canPi
      ? spend.invoices.map((i) => ({ id: i.id, number: i.number, date: toIsoDate(i.date), supplier: i.supplier, amount: i.baseSubtotal, status: i.status, allocationId: i.allocationId, allocation: line(i.allocationId), inherited: i.inherited }))
      : null,
    categories,
    channels: channels.map((ch) => ({ id: ch.id, name: `${ch.connection.name} · ${ch.template.name}` })),
    alerts: alerts.map((a) => ({ id: a.id, kind: a.kind, scope: a.scopeKey === NOT_ALLOCATED ? "Campaign" : (allocName.get(a.scopeKey) ?? "Budget line"), status: a.status, message: a.message, raisedAt: a.raisedAt.toISOString(), clearedAt: a.clearedAt?.toISOString() ?? null })),
  };
}

// ── Allocation lines ─────────────────────────────────────────────

const money = z.coerce.number().positive("Enter an amount above 0").max(9_999_999_999.99);
const optText = (max: number) => z.string().trim().max(max).optional().nullable();
export const allocationCreateSchema = z
  .object({ name: z.string().trim().min(1, "Enter a name").max(120), categoryId: z.string().uuid(), campaignChannelId: z.string().uuid().optional().nullable().or(z.literal("")), amount: money, notes: optText(1000) })
  .strict();
export const allocationUpdateSchema = allocationCreateSchema.partial().extend({ status: z.enum(["ACTIVE", "CLOSED"]).optional(), version: z.coerce.number().int() }).strict();
export const allocationTransferSchema = z.object({ fromId: z.string().uuid(), toId: z.string().uuid(), amount: money, reason: z.string().trim().min(3, "Say why").max(500) }).strict();

async function lockCampaign(tx: Prisma.TransactionClient, campaignId: string) {
  await tx.$queryRaw`SELECT id FROM marketing_campaigns WHERE id = ${campaignId}::uuid FOR UPDATE`;
  return tx.marketingCampaign.findUniqueOrThrow({ where: { id: campaignId } });
}

async function checkRefs(actor: SalesActor, campaignId: string, input: { categoryId?: string; campaignChannelId?: string | null }) {
  if (input.categoryId) {
    const cat = await prisma.marketingCampaignLookup.findFirst({ where: { id: input.categoryId, companyId: actor.companyId, kind: "SPEND_CATEGORY", isActive: true }, select: { id: true } });
    if (!cat) throw new BusinessRuleError("VALIDATION_ERROR", "Pick an active spend category.", { fieldErrors: { categoryId: "Not found." } });
  }
  if (input.campaignChannelId) {
    const ch = await prisma.marketingCampaignChannel.findFirst({ where: { id: input.campaignChannelId, companyId: actor.companyId, campaignId }, select: { id: true } });
    if (!ch) throw new BusinessRuleError("VALIDATION_ERROR", "That delivery channel isn't on this campaign.", { fieldErrors: { campaignChannelId: "Not on this campaign." } });
  }
}

function assertWithinApproved(c: MarketingCampaign, total: number) {
  const approved = approvedBudget(c);
  if (approved === null) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "The campaign has no approved budget yet. Get its plan (with a budget) approved first.");
  if (total > approved + 0.004) {
    throw new BusinessRuleError("VALIDATION_ERROR", `Budget lines would add up to ₹${r2(total).toLocaleString("en-IN")}, more than the approved ₹${approved.toLocaleString("en-IN")}.`, { fieldErrors: { amount: "Over the approved budget." } });
  }
}

async function usedOn(tx: Prisma.TransactionClient, c: MarketingCampaign, allocationId: string) {
  const s = await loadSpend(tx, c.companyId, [c.id]);
  const f = computeFor(c, s).byAllocation[allocationId];
  return f ? r2(f.actual + f.committed) : 0;
}

async function editableCampaign(actor: SalesActor, campaignId: string) {
  await PermissionService.assert(actor.userId, "marketing_campaigns", "edit");
  const c = await loadCampaign(actor, campaignId);
  if (c.status === "CANCELLED") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "A cancelled campaign's budget can't be changed.");
  return c;
}

export async function createAllocation(actor: SalesActor, campaignId: string, raw: unknown) {
  const input = allocationCreateSchema.parse(raw);
  const c0 = await editableCampaign(actor, campaignId);
  const channelId = input.campaignChannelId || null;
  await checkRefs(actor, c0.id, { categoryId: input.categoryId, campaignChannelId: channelId });
  const row = await prisma.$transaction(async (tx) => {
    const c = await lockCampaign(tx, c0.id);
    const existing = await tx.marketingBudgetAllocation.aggregate({ where: { campaignId: c.id }, _sum: { amount: true } });
    assertWithinApproved(c, Number(existing._sum.amount ?? 0) + input.amount);
    const dup = await tx.marketingBudgetAllocation.findFirst({ where: { campaignId: c.id, name: { equals: input.name, mode: "insensitive" } }, select: { id: true } });
    if (dup) throw new BusinessRuleError("VALIDATION_ERROR", "This campaign already has a budget line with that name.", { fieldErrors: { name: "Already used." } });
    const a = await tx.marketingBudgetAllocation.create({
      data: { companyId: actor.companyId, campaignId: c.id, name: input.name, categoryId: input.categoryId, campaignChannelId: channelId, amount: new Prisma.Decimal(input.amount), notes: input.notes || null, createdByUserId: actor.userId },
    });
    await recordCampaignEvent(tx, actor, c.id, "BUDGET_LINE_ADDED", null, { name: a.name, amount: input.amount });
    await auditCampaign(tx, actor, a.id, "CREATE", null, { name: a.name, amount: input.amount, categoryId: a.categoryId, campaignChannelId: channelId }, ALLOC_TABLE);
    return a;
  });
  await evaluateCampaignAlerts(actor.companyId, c0.id);
  return { id: row.id };
}

export async function updateAllocation(actor: SalesActor, campaignId: string, allocationId: string, raw: unknown) {
  const input = allocationUpdateSchema.parse(raw);
  const c0 = await editableCampaign(actor, campaignId);
  const channelId = input.campaignChannelId === undefined ? undefined : input.campaignChannelId || null;
  await checkRefs(actor, c0.id, { categoryId: input.categoryId, campaignChannelId: channelId });
  await prisma.$transaction(async (tx) => {
    const c = await lockCampaign(tx, c0.id);
    const a = await tx.marketingBudgetAllocation.findFirst({ where: { id: allocationId, campaignId: c.id, companyId: actor.companyId } });
    if (!a) throw new BusinessRuleError("NOT_FOUND", "Budget line not found.");
    if (a.version !== input.version) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This budget line was changed just now. Reload and try again.");
    if (input.amount !== undefined && input.amount !== Number(a.amount)) {
      const others = await tx.marketingBudgetAllocation.aggregate({ where: { campaignId: c.id, id: { not: a.id } }, _sum: { amount: true } });
      assertWithinApproved(c, Number(others._sum.amount ?? 0) + input.amount);
      const used = await usedOn(tx, c, a.id);
      if (input.amount + 0.004 < used) throw new BusinessRuleError("VALIDATION_ERROR", `₹${used.toLocaleString("en-IN")} is already spent or committed on this line — the amount can't go below that.`, { fieldErrors: { amount: "Below what's used." } });
    }
    if (input.name && input.name.toLowerCase() !== a.name.toLowerCase()) {
      const dup = await tx.marketingBudgetAllocation.findFirst({ where: { campaignId: c.id, id: { not: a.id }, name: { equals: input.name, mode: "insensitive" } }, select: { id: true } });
      if (dup) throw new BusinessRuleError("VALIDATION_ERROR", "This campaign already has a budget line with that name.", { fieldErrors: { name: "Already used." } });
    }
    const data: Prisma.MarketingBudgetAllocationUncheckedUpdateManyInput = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
      ...(channelId !== undefined ? { campaignChannelId: channelId } : {}),
      ...(input.amount !== undefined ? { amount: new Prisma.Decimal(input.amount) } : {}),
      ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      updatedByUserId: actor.userId,
      version: { increment: 1 },
    };
    const { count } = await tx.marketingBudgetAllocation.updateMany({ where: { id: a.id, version: a.version }, data });
    if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This budget line was changed just now. Reload and try again.");
    await recordCampaignEvent(tx, actor, c.id, "BUDGET_LINE_CHANGED", null, { name: input.name ?? a.name, from: Number(a.amount), to: input.amount ?? Number(a.amount), status: input.status ?? a.status });
    await auditCampaign(tx, actor, a.id, "UPDATE", { name: a.name, amount: Number(a.amount), status: a.status, categoryId: a.categoryId }, input, ALLOC_TABLE);
  });
  await evaluateCampaignAlerts(actor.companyId, c0.id);
  return { id: allocationId };
}

/** Only an unused line can be removed (no linked expense, order or invoice). Otherwise close it. */
export async function deleteAllocation(actor: SalesActor, campaignId: string, allocationId: string) {
  const c0 = await editableCampaign(actor, campaignId);
  await prisma.$transaction(async (tx) => {
    await lockCampaign(tx, c0.id);
    const a = await tx.marketingBudgetAllocation.findFirst({
      where: { id: allocationId, campaignId: c0.id, companyId: actor.companyId },
      include: { _count: { select: { expenses: true, purchaseOrders: true, purchaseInvoices: true } } },
    });
    if (!a) throw new BusinessRuleError("NOT_FOUND", "Budget line not found.");
    if (a._count.expenses + a._count.purchaseOrders + a._count.purchaseInvoices > 0) throw new BusinessRuleError("REFERENCED_RECORD_IN_USE", "Spend is linked to this budget line. Move it or close the line instead.");
    await tx.marketingBudgetAllocation.delete({ where: { id: a.id } });
    await recordCampaignEvent(tx, actor, c0.id, "BUDGET_LINE_REMOVED", null, { name: a.name, amount: Number(a.amount) });
    await auditCampaign(tx, actor, a.id, "DELETE", { name: a.name, amount: Number(a.amount) }, null, ALLOC_TABLE);
  });
  await evaluateCampaignAlerts(actor.companyId, c0.id);
  return { id: allocationId };
}

/** Moves budget from one line to another of the same campaign (the total is unchanged). */
export async function transferAllocation(actor: SalesActor, campaignId: string, raw: unknown) {
  const input = allocationTransferSchema.parse(raw);
  if (input.fromId === input.toId) throw new BusinessRuleError("VALIDATION_ERROR", "Pick two different budget lines.");
  const c0 = await editableCampaign(actor, campaignId);
  await prisma.$transaction(async (tx) => {
    const c = await lockCampaign(tx, c0.id);
    const rows = await tx.marketingBudgetAllocation.findMany({ where: { id: { in: [input.fromId, input.toId] }, campaignId: c.id, companyId: actor.companyId } });
    const from = rows.find((r) => r.id === input.fromId);
    const to = rows.find((r) => r.id === input.toId);
    if (!from || !to) throw new BusinessRuleError("NOT_FOUND", "Budget line not found.");
    if (to.status !== "ACTIVE") throw new BusinessRuleError("VALIDATION_ERROR", `"${to.name}" is closed — reopen it before moving budget to it.`);
    const left = Number(from.amount) - input.amount;
    const used = await usedOn(tx, c, from.id);
    if (left + 0.004 < used) throw new BusinessRuleError("VALIDATION_ERROR", `"${from.name}" has ₹${used.toLocaleString("en-IN")} spent or committed; at most ₹${r2(Math.max(0, Number(from.amount) - used)).toLocaleString("en-IN")} can be moved.`, { fieldErrors: { amount: "More than is free." } });
    await tx.marketingBudgetAllocation.update({ where: { id: from.id }, data: { amount: new Prisma.Decimal(r2(left)), updatedByUserId: actor.userId, version: { increment: 1 } } });
    await tx.marketingBudgetAllocation.update({ where: { id: to.id }, data: { amount: { increment: new Prisma.Decimal(input.amount) }, updatedByUserId: actor.userId, version: { increment: 1 } } });
    await recordCampaignEvent(tx, actor, c.id, "BUDGET_MOVED", input.reason, { from: from.name, to: to.name, amount: input.amount });
    await auditCampaign(tx, actor, from.id, "UPDATE", { amount: Number(from.amount) }, { amount: r2(left), movedTo: to.name, reason: input.reason }, ALLOC_TABLE);
    await auditCampaign(tx, actor, to.id, "UPDATE", { amount: Number(to.amount) }, { amount: r2(Number(to.amount) + input.amount), movedFrom: from.name, reason: input.reason }, ALLOC_TABLE);
  });
  await evaluateCampaignAlerts(actor.companyId, c0.id);
  return { id: campaignId };
}

// ── Linking spend ────────────────────────────────────────────────

export const spendLinkSchema = z
  .object({ kind: z.enum(["EXPENSE", "PURCHASE_ORDER", "PURCHASE_INVOICE"]), recordId: z.string().uuid(), allocationId: z.string().uuid().optional().nullable().or(z.literal("")) })
  .strict();
export const spendUnlinkSchema = z.object({ kind: z.enum(["EXPENSE", "PURCHASE_ORDER", "PURCHASE_INVOICE"]), recordId: z.string().uuid(), reason: z.string().trim().min(3, "Say why").max(500) }).strict();

interface SpendRecord {
  id: string;
  number: string;
  status: string;
  campaignId: string | null;
  allocationId: string | null;
  amount: number;
  /** PI only: the purchase order's campaign. */
  poCampaignId?: string | null;
  poNumber?: string | null;
}

async function findSpend(db: Db, companyId: string, kind: SpendKind, id: string): Promise<SpendRecord | null> {
  if (kind === "EXPENSE") {
    const e = await db.expense.findFirst({ where: { id, companyId }, select: { id: true, expenseNumber: true, status: true, campaignId: true, budgetAllocationId: true, amount: true } });
    return e && { id: e.id, number: e.expenseNumber, status: e.status, campaignId: e.campaignId, allocationId: e.budgetAllocationId, amount: Number(e.amount) };
  }
  if (kind === "PURCHASE_ORDER") {
    const p = await db.purchaseOrder.findFirst({ where: { id, companyId }, select: { id: true, orderNumber: true, status: true, campaignId: true, budgetAllocationId: true, baseTotalAmount: true } });
    return p && { id: p.id, number: p.orderNumber, status: p.status, campaignId: p.campaignId, allocationId: p.budgetAllocationId, amount: Number(p.baseTotalAmount) };
  }
  const i = await db.purchaseInvoice.findFirst({
    where: { id, companyId },
    select: { id: true, invoiceNumber: true, status: true, campaignId: true, budgetAllocationId: true, subtotalAmount: true, exchangeRate: true, purchaseOrder: { select: { campaignId: true, orderNumber: true } } },
  });
  return i && { id: i.id, number: i.invoiceNumber, status: i.status, campaignId: i.campaignId, allocationId: i.budgetAllocationId, amount: r2(Number(i.subtotalAmount) * Number(i.exchangeRate)), poCampaignId: i.purchaseOrder?.campaignId ?? null, poNumber: i.purchaseOrder?.orderNumber ?? null };
}

async function writeSpendLink(tx: Prisma.TransactionClient, companyId: string, kind: SpendKind, r: SpendRecord, data: { campaignId: string | null; budgetAllocationId: string | null }) {
  // Guarded on the values read, so a concurrent change fails instead of being overwritten.
  const where = { id: r.id, companyId, campaignId: r.campaignId, budgetAllocationId: r.allocationId };
  const { count } =
    kind === "EXPENSE" ? await tx.expense.updateMany({ where, data }) : kind === "PURCHASE_ORDER" ? await tx.purchaseOrder.updateMany({ where, data }) : await tx.purchaseInvoice.updateMany({ where, data });
  if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", `This ${SPEND_LABEL[kind]} was linked or changed just now. Reload.`);
}

/** Links a finance record to the campaign (and a budget line), or moves an already linked one to another line. */
export async function linkSpend(actor: SalesActor, campaignId: string, raw: unknown) {
  const input = spendLinkSchema.parse(raw);
  const kind = input.kind as SpendKind;
  await PermissionService.assert(actor.userId, "marketing_campaigns", "edit");
  await PermissionService.assert(actor.userId, SPEND_PERMISSION[kind], "view");
  const c = await loadCampaign(actor, campaignId);
  if (c.status === "DRAFT" || c.status === "CANCELLED") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Spend is linked to an approved, running or completed campaign.");
  const allocationId = input.allocationId || null;
  const r = await findSpend(prisma, actor.companyId, kind, input.recordId);
  if (!r) throw new BusinessRuleError("NOT_FOUND", `The ${SPEND_LABEL[kind]} was not found.`);
  if (["REJECTED", "CANCELLED"].includes(r.status)) throw new BusinessRuleError("VALIDATION_ERROR", `A ${r.status.toLowerCase()} ${SPEND_LABEL[kind]} isn't spend.`);
  if (r.campaignId && r.campaignId !== c.id) throw new BusinessRuleError("VALIDATION_ERROR", `This ${SPEND_LABEL[kind]} is linked to another campaign. Unlink it there first.`);
  if (kind === "PURCHASE_INVOICE" && r.poCampaignId) {
    if (r.poCampaignId !== c.id) throw new BusinessRuleError("VALIDATION_ERROR", `Its purchase order ${r.poNumber} is for another campaign — the invoice can't count for this one.`);
    if (!r.campaignId) throw new BusinessRuleError("VALIDATION_ERROR", `It already counts for this campaign through purchase order ${r.poNumber} (and that order's budget line).`);
  }
  if (kind === "PURCHASE_ORDER") {
    const clash = await prisma.purchaseInvoice.findFirst({ where: { companyId: actor.companyId, purchaseOrderId: r.id, status: { not: "CANCELLED" }, campaignId: { not: null, notIn: [c.id] } }, select: { invoiceNumber: true } });
    if (clash) throw new BusinessRuleError("VALIDATION_ERROR", `Invoice ${clash.invoiceNumber} against this order is linked to another campaign. Sort that out first.`);
  }
  if (allocationId) {
    const a = await prisma.marketingBudgetAllocation.findFirst({ where: { id: allocationId, campaignId: c.id, companyId: actor.companyId }, select: { status: true, name: true } });
    if (!a) throw new BusinessRuleError("VALIDATION_ERROR", "That budget line isn't on this campaign.", { fieldErrors: { allocationId: "Not found." } });
    if (a.status !== "ACTIVE" && allocationId !== r.allocationId) throw new BusinessRuleError("VALIDATION_ERROR", `Budget line "${a.name}" is closed and takes no new spend.`, { fieldErrors: { allocationId: "Closed." } });
  }
  if (r.campaignId === c.id && r.allocationId === allocationId) return { id: r.id };
  const moving = r.campaignId === c.id;
  await prisma.$transaction(async (tx) => {
    await writeSpendLink(tx, actor.companyId, kind, r, { campaignId: c.id, budgetAllocationId: allocationId });
    await recordCampaignEvent(tx, actor, c.id, moving ? "SPEND_MOVED" : kind === "EXPENSE" ? "EXPENSE_LINKED" : "SPEND_LINKED", null, { kind, number: r.number, amount: r.amount, allocationId });
    await auditCampaign(tx, actor, r.id, "UPDATE", { campaignId: r.campaignId, budgetAllocationId: r.allocationId }, { campaignId: c.id, budgetAllocationId: allocationId }, kind === "EXPENSE" ? "expenses" : kind === "PURCHASE_ORDER" ? "purchase_orders" : "purchase_invoices");
  });
  await evaluateCampaignAlerts(actor.companyId, c.id);
  return { id: r.id };
}

export async function unlinkSpend(actor: SalesActor, campaignId: string, raw: unknown) {
  const input = spendUnlinkSchema.parse(raw);
  const kind = input.kind as SpendKind;
  await PermissionService.assert(actor.userId, "marketing_campaigns", "edit");
  const c = await loadCampaign(actor, campaignId);
  const r = await findSpend(prisma, actor.companyId, kind, input.recordId);
  if (!r || r.campaignId !== c.id) throw new BusinessRuleError("NOT_FOUND", `This ${SPEND_LABEL[kind]} isn't linked to the campaign.`);
  await prisma.$transaction(async (tx) => {
    await writeSpendLink(tx, actor.companyId, kind, r, { campaignId: null, budgetAllocationId: null });
    await recordCampaignEvent(tx, actor, c.id, kind === "EXPENSE" ? "EXPENSE_UNLINKED" : "SPEND_UNLINKED", input.reason, { kind, number: r.number });
    await auditCampaign(tx, actor, r.id, "UPDATE", { campaignId: c.id, budgetAllocationId: r.allocationId }, { campaignId: null, budgetAllocationId: null, reason: input.reason }, kind === "EXPENSE" ? "expenses" : kind === "PURCHASE_ORDER" ? "purchase_orders" : "purchase_invoices");
  });
  await evaluateCampaignAlerts(actor.companyId, c.id);
  return { id: r.id };
}

/** Records of one kind that could be linked (not on any campaign; an invoice whose order is on a campaign is excluded). */
export async function searchLinkableSpend(actor: SalesActor, campaignId: string, kindRaw: string, search?: string) {
  const kind = z.enum(["EXPENSE", "PURCHASE_ORDER", "PURCHASE_INVOICE"]).parse(kindRaw) as SpendKind;
  await PermissionService.assert(actor.userId, SPEND_PERMISSION[kind], "view");
  await loadCampaign(actor, campaignId);
  const q = search?.trim();
  const ci = (field: string) => (q ? { [field]: { contains: q, mode: "insensitive" as const } } : {});
  const inr = (v: number) => `₹${v.toLocaleString("en-IN")}`;
  const st = (s: string) => s.toLowerCase().replace(/_/g, " ");
  if (kind === "EXPENSE") {
    const rows = await prisma.expense.findMany({
      where: { companyId: actor.companyId, campaignId: null, status: { notIn: ["REJECTED", "CANCELLED"] }, ...(q ? { OR: [ci("expenseNumber"), ci("description")] } : {}) },
      orderBy: { expenseDate: "desc" },
      take: 50,
      select: { id: true, expenseNumber: true, expenseDate: true, description: true, amount: true, status: true },
    });
    return rows.map((e) => ({ id: e.id, label: `${e.expenseNumber} · ${e.description}`, sublabel: `${toIsoDate(e.expenseDate)} · ${inr(Number(e.amount))} before GST · ${st(e.status)}` }));
  }
  if (kind === "PURCHASE_ORDER") {
    const rows = await prisma.purchaseOrder.findMany({
      where: { companyId: actor.companyId, campaignId: null, status: { not: "CANCELLED" }, ...(q ? { OR: [ci("orderNumber"), { supplier: ci("name") }] } : {}) },
      orderBy: { orderDate: "desc" },
      take: 50,
      select: { id: true, orderNumber: true, orderDate: true, baseTotalAmount: true, status: true, supplier: { select: { name: true } } },
    });
    return rows.map((p) => ({ id: p.id, label: `${p.orderNumber} · ${p.supplier.name}`, sublabel: `${toIsoDate(p.orderDate)} · ${inr(Number(p.baseTotalAmount))} · ${st(p.status)}` }));
  }
  const rows = await prisma.purchaseInvoice.findMany({
    where: {
      companyId: actor.companyId,
      campaignId: null,
      status: { not: "CANCELLED" },
      OR: [{ purchaseOrderId: null }, { purchaseOrder: { campaignId: null } }],
      ...(q ? { AND: [{ OR: [ci("invoiceNumber"), ci("supplierInvoiceNumber"), { supplier: ci("name") }] }] } : {}),
    },
    orderBy: { invoiceDate: "desc" },
    take: 50,
    select: { id: true, invoiceNumber: true, invoiceDate: true, subtotalAmount: true, exchangeRate: true, status: true, supplier: { select: { name: true } } },
  });
  return rows.map((i) => ({ id: i.id, label: `${i.invoiceNumber} · ${i.supplier.name}`, sublabel: `${toIsoDate(i.invoiceDate)} · ${inr(r2(Number(i.subtotalAmount) * Number(i.exchangeRate)))} before GST · ${st(i.status)}` }));
}

// ── Alerts ───────────────────────────────────────────────────────

/**
 * Brings the stored alerts of one campaign in line with its figures: a new
 * condition raises one OPEN alert (and notifies the owner once), a condition
 * that went away is CLEARED. The partial unique index (campaign, scope, kind)
 * WHERE status = 'OPEN' makes a concurrent second evaluation harmless.
 */
export async function evaluateCampaignAlerts(companyId: string, campaignId: string, warnPercent?: number) {
  const c = await prisma.marketingCampaign.findFirst({ where: { id: campaignId, companyId } });
  if (!c) return { raised: 0, cleared: 0 };
  const warn = warnPercent ?? (await getSalesMarketingSettings(companyId)).budgetWarnPercent;
  const spend = await loadSpend(prisma, companyId, [c.id]);
  const computation = computeFor(c, spend);
  const wanted = c.status === "CANCELLED" ? [] : budgetAlertConditions({ computation, allocations: spend.allocations.map((a) => ({ id: a.id, name: a.name })), warnPercent: warn, ended: campaignEnded(c, todayIsoDate()) });
  const open = await prisma.marketingBudgetAlert.findMany({ where: { companyId, campaignId: c.id, status: "OPEN" } });
  const key = (scopeKey: string, kind: string) => `${scopeKey}|${kind}`;
  const wantedKeys = new Set(wanted.map((w) => key(w.scopeKey, w.kind)));
  const openKeys = new Set(open.map((o) => key(o.scopeKey, o.kind)));
  let raised = 0;
  let cleared = 0;
  const stale = open.filter((o) => !wantedKeys.has(key(o.scopeKey, o.kind)));
  if (stale.length) cleared = (await prisma.marketingBudgetAlert.updateMany({ where: { id: { in: stale.map((s) => s.id) }, status: "OPEN" }, data: { status: "CLEARED", clearedAt: new Date() } })).count;
  for (const w of wanted.filter((x) => !openKeys.has(key(x.scopeKey, x.kind)))) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.marketingBudgetAlert.create({ data: { companyId, campaignId: c.id, scopeKey: w.scopeKey, kind: w.kind, message: w.message, basis: w.basis as Prisma.InputJsonValue } });
        await createNotification({ companyId, userId: c.ownerUserId, title: `Campaign ${c.code}: budget alert`, body: w.message }, tx);
      });
      raised++;
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002") throw e; // already raised by a concurrent run
    }
  }
  return { raised, cleared };
}

/** Worker: re-evaluates every campaign whose budget can still move (finance status changes happen outside this module). */
export async function evaluateAllBudgetAlerts() {
  const since = new Date(Date.now() - 120 * 86_400_000);
  const campaigns = await prisma.marketingCampaign.findMany({
    where: { OR: [{ status: { in: ["APPROVED", "ACTIVE", "PAUSED"] } }, { status: "COMPLETED", updatedAt: { gte: since } }, { budgetAlerts: { some: { status: "OPEN" } } }] },
    select: { id: true, companyId: true },
    take: 5000,
  });
  const warnByCompany = new Map<string, number>();
  let raised = 0;
  let cleared = 0;
  for (const c of campaigns) {
    if (!warnByCompany.has(c.companyId)) warnByCompany.set(c.companyId, (await getSalesMarketingSettings(c.companyId)).budgetWarnPercent);
    const r = await evaluateCampaignAlerts(c.companyId, c.id, warnByCompany.get(c.companyId));
    raised += r.raised;
    cleared += r.cleared;
  }
  return { campaigns: campaigns.length, raised, cleared };
}

// ── Overview ─────────────────────────────────────────────────────

export const budgetOverviewQuerySchema = z.object({ status: z.string().optional(), alertsOnly: z.enum(["1", "0"]).optional(), search: z.string().trim().max(100).optional() }).strict();

export async function budgetOverview(actor: SalesActor, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_campaigns", "view");
  const q = budgetOverviewQuerySchema.parse(raw ?? {});
  const scope = await getCampaignScope(actor);
  const campaigns = await prisma.marketingCampaign.findMany({
    where: {
      AND: [
        campaignScopeWhere(actor, scope),
        q.status ? { status: q.status as MarketingCampaign["status"] } : { status: { notIn: ["DRAFT", "CANCELLED"] } },
        q.search ? { OR: [{ code: { contains: q.search, mode: "insensitive" } }, { name: { contains: q.search, mode: "insensitive" } }] } : {},
        q.alertsOnly === "1" ? { budgetAlerts: { some: { status: "OPEN" } } } : {},
      ],
    },
    orderBy: [{ plannedStartDate: "desc" }],
    take: 300,
    include: { owner: { select: { fullName: true } }, budgetAlerts: { where: { status: "OPEN" }, select: { kind: true } } },
  });
  const measures = await measureBudgets(actor.companyId, campaigns);
  const rows = campaigns.map((c) => {
    const m = measures.get(c.id)!;
    return {
      id: c.id,
      code: c.code,
      name: c.name,
      status: c.status,
      owner: c.owner.fullName,
      start: toIsoDate(c.plannedStartDate),
      end: toIsoDate(c.plannedEndDate),
      approved: m.limit,
      allocated: m.allocated,
      actual: m.actual,
      committed: m.committed,
      pipeline: m.pipeline,
      remaining: m.remaining,
      usedPercent: m.usedPercent,
      openAlerts: c.budgetAlerts.map((a) => a.kind),
    };
  });
  const sum = (f: (r: (typeof rows)[number]) => number | null) => r2(rows.reduce((s, r) => s + (f(r) ?? 0), 0));
  return { rows, totals: { approved: sum((r) => r.approved), allocated: sum((r) => r.allocated), actual: sum((r) => r.actual), committed: sum((r) => r.committed), pipeline: sum((r) => r.pipeline) } };
}
