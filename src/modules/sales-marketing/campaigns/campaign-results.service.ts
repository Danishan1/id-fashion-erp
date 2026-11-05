import type { MarketingCampaign, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { todayIsoDate } from "@/lib/date";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { dueParts, isOverdue } from "@/modules/crm/activities/activity-due";
import { metricTotals } from "@/modules/sales-marketing/performance/performance-actuals";
import { dbDate, isoDateSchema, optionalText, toDbDate } from "@/modules/sales-marketing/performance/performance-common";
import { auditCampaign, campaignScopeWhere, canApproveCampaign, getCampaignScope, listCampaignEvents, loadCampaign, recordCampaignEvent } from "./campaign-common";
import { CAMPAIGN_STATUSES, MILESTONE_FLAG, SYSTEM_METRICS, SYSTEM_METRIC_KEYS, type CampaignStatusKey, type MetricUnitKey, type SystemMetricKey } from "./campaign-registry";

/**
 * Campaign results (Phase 08, PHASE_08_CAMPAIGNS.md §4–§5, §7): success
 * metrics (system-measured from linked records, or manual and labelled so),
 * budget vs linked Expenses, linked records, detail, overview and calendar.
 */

const r2 = (v: number) => Math.round(v * 100) / 100;
const METRIC_TABLE = "marketing_campaign_metrics";
/** Expense statuses that count as actual spend. */
export const SPENT_EXPENSE_STATUSES = ["APPROVED", "PARTIALLY_PAID", "PAID"] as const;
const money = z.union([z.literal(""), z.null(), z.coerce.number().min(0, "Can't be negative").max(9_999_999_999.99)]).optional();
const numOrNull = (v: number | string | "" | null | undefined) => (v === "" || v === null || v === undefined ? null : Number(v));

export const metricAddSchema = z
  .object({
    source: z.enum(["SYSTEM", "MANUAL"]),
    systemKey: z.enum(SYSTEM_METRIC_KEYS as [SystemMetricKey, ...SystemMetricKey[]]).optional(),
    label: z.string().trim().max(120).optional(),
    unit: z.enum(["COUNT", "CURRENCY", "PERCENT", "NUMBER"]).optional(),
    targetValue: money,
    notes: optionalText(1000),
  })
  .strict();
export const metricUpdateSchema = z.object({ label: z.string().trim().min(1).max(120).optional(), targetValue: money, notes: optionalText(1000) }).strict();
export const manualResultSchema = z.object({ actual: z.coerce.number().min(0, "Can't be negative").max(9_999_999_999.99), asOf: isoDateSchema }).strict();

function assertEditable(c: MarketingCampaign, what: string) {
  if (c.status === "CANCELLED") throw new BusinessRuleError("INVALID_STATE_TRANSITION", `A cancelled campaign's ${what} can't be changed.`);
}

// ── Metrics ──────────────────────────────────────────────────────

export async function addMetric(actor: SalesActor, id: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_campaigns", "edit");
  const input = metricAddSchema.parse(raw);
  const c = await loadCampaign(actor, id);
  assertEditable(c, "metrics");
  let label: string, unit: MetricUnitKey;
  if (input.source === "SYSTEM") {
    if (!input.systemKey) throw new BusinessRuleError("VALIDATION_ERROR", "Choose what to measure.", { fieldErrors: { systemKey: "Required." } });
    label = SYSTEM_METRICS[input.systemKey].label;
    unit = SYSTEM_METRICS[input.systemKey].unit;
    if (await prisma.marketingCampaignMetric.findFirst({ where: { campaignId: c.id, systemKey: input.systemKey } })) throw new BusinessRuleError("VALIDATION_ERROR", `"${label}" is already a metric of this campaign.`, { fieldErrors: { systemKey: "Already added." } });
  } else {
    if (!input.label) throw new BusinessRuleError("VALIDATION_ERROR", "Name the metric.", { fieldErrors: { label: "Required." } });
    label = input.label;
    unit = input.unit ?? "COUNT";
  }
  const max = await prisma.marketingCampaignMetric.aggregate({ where: { campaignId: c.id }, _max: { sortOrder: true } });
  await prisma.$transaction(async (tx) => {
    const m = await tx.marketingCampaignMetric.create({
      data: { campaignId: c.id, source: input.source, systemKey: input.source === "SYSTEM" ? input.systemKey! : null, label, unit, targetValue: numOrNull(input.targetValue), notes: input.notes || null, sortOrder: (max._max.sortOrder ?? 0) + 10 },
    });
    await recordCampaignEvent(tx, actor, c.id, "METRIC_ADDED", null, { label, target: numOrNull(input.targetValue), source: input.source });
    await auditCampaign(tx, actor, m.id, "CREATE", null, { campaignId: c.id, label, unit, source: input.source, target: numOrNull(input.targetValue) }, METRIC_TABLE);
  });
  return { id };
}

async function loadMetric(actor: SalesActor, id: string, metricId: string) {
  const c = await loadCampaign(actor, id);
  const m = await prisma.marketingCampaignMetric.findFirst({ where: { id: metricId, campaignId: c.id } });
  if (!m) throw new BusinessRuleError("NOT_FOUND", "Metric not found.", { metricId });
  return { c, m };
}

export async function updateMetric(actor: SalesActor, id: string, metricId: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_campaigns", "edit");
  const input = metricUpdateSchema.parse(raw);
  const { c, m } = await loadMetric(actor, id, metricId);
  if (c.companyId !== actor.companyId) throw new BusinessRuleError("NOT_FOUND", "Campaign not found.", { id });
  assertEditable(c, "metrics");
  const data = {
    ...(input.label !== undefined && m.source === "MANUAL" ? { label: input.label } : {}),
    ...(input.targetValue !== undefined ? { targetValue: numOrNull(input.targetValue) } : {}),
    ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
  };
  await prisma.$transaction(async (tx) => {
    await tx.marketingCampaignMetric.update({ where: { id: m.id }, data });
    await recordCampaignEvent(tx, actor, c.id, "METRIC_UPDATED", null, { label: m.label, before: m.targetValue === null ? null : Number(m.targetValue), after: data.targetValue ?? null });
    await auditCampaign(tx, actor, m.id, "UPDATE", { label: m.label, targetValue: m.targetValue, notes: m.notes }, data, METRIC_TABLE);
  });
  return { id };
}

export async function recordManualResult(actor: SalesActor, id: string, metricId: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_campaigns", "edit");
  const input = manualResultSchema.parse(raw);
  const { c, m } = await loadMetric(actor, id, metricId);
  assertEditable(c, "results");
  if (m.source !== "MANUAL") throw new BusinessRuleError("VALIDATION_ERROR", "This metric is measured from ERP records; it can't be typed in.");
  if (input.asOf > todayIsoDate()) throw new BusinessRuleError("VALIDATION_ERROR", "The result date can't be in the future.", { fieldErrors: { asOf: "In the future." } });
  await prisma.$transaction(async (tx) => {
    await tx.marketingCampaignMetric.update({ where: { id: m.id }, data: { manualActual: input.actual, manualAsOf: toDbDate(input.asOf), manualUpdatedByUserId: actor.userId, manualUpdatedAt: new Date() } });
    await recordCampaignEvent(tx, actor, c.id, "MANUAL_RESULT", null, { label: m.label, before: m.manualActual === null ? null : Number(m.manualActual), after: input.actual, asOf: input.asOf });
    await auditCampaign(tx, actor, m.id, "UPDATE", { manualActual: m.manualActual, manualAsOf: m.manualAsOf }, input, METRIC_TABLE);
  });
  return { id };
}

export async function removeMetric(actor: SalesActor, id: string, metricId: string) {
  await PermissionService.assert(actor.userId, "marketing_campaigns", "edit");
  const { c, m } = await loadMetric(actor, id, metricId);
  assertEditable(c, "metrics");
  await prisma.$transaction(async (tx) => {
    await tx.marketingCampaignMetric.delete({ where: { id: m.id } });
    await recordCampaignEvent(tx, actor, c.id, "METRIC_REMOVED", null, { label: m.label });
    await auditCampaign(tx, actor, m.id, "DELETE", { label: m.label, targetValue: m.targetValue, manualActual: m.manualActual }, null, METRIC_TABLE);
  });
  return { id };
}

/** System-measured values for a set of campaigns: every record linked to the campaign up to today. */
export async function measureCampaigns(companyId: string, campaignIds: string[]) {
  const out = new Map<string, Record<SystemMetricKey, { value: number; documents: number }>>();
  if (!campaignIds.length) return out;
  const today = todayIsoDate();
  const FROM = "2000-01-01";
  const [leads, converted, enquiries, accQ, accV, bookedN, bookedV, invoiced] = await Promise.all([
    prisma.crmLead.groupBy({ by: ["campaignId"], where: { companyId, campaignId: { in: campaignIds } }, _count: true }),
    prisma.crmLead.groupBy({ by: ["campaignId"], where: { companyId, campaignId: { in: campaignIds }, convertedAt: { not: null } }, _count: true }),
    prisma.buyerEnquiry.groupBy({ by: ["campaignId"], where: { companyId, campaignId: { in: campaignIds }, status: { not: "CANCELLED" } }, _count: true }),
    metricTotals(companyId, "ACCEPTED_QUOTATION_COUNT", FROM, today, "CAMPAIGN"),
    metricTotals(companyId, "ACCEPTED_QUOTATION_VALUE", FROM, today, "CAMPAIGN"),
    metricTotals(companyId, "BOOKED_ORDER_COUNT", FROM, today, "CAMPAIGN"),
    metricTotals(companyId, "BOOKED_ORDER_VALUE", FROM, today, "CAMPAIGN"),
    metricTotals(companyId, "INVOICED_VALUE", FROM, today, "CAMPAIGN"),
  ]);
  const count = (rows: { campaignId: string | null; _count: number }[], id: string) => {
    const n = rows.find((r) => r.campaignId === id)?._count ?? 0;
    return { value: n, documents: n };
  };
  for (const id of campaignIds) {
    const t = (m: Map<string, { value: number; documents: number }>) => {
      const v = m.get(id);
      return { value: r2(v?.value ?? 0), documents: v?.documents ?? 0 };
    };
    out.set(id, {
      LEADS: count(leads, id),
      CONVERTED_LEADS: count(converted, id),
      ENQUIRIES: count(enquiries, id),
      ACCEPTED_QUOTATION_COUNT: t(accQ),
      ACCEPTED_QUOTATION_VALUE: t(accV),
      BOOKED_ORDER_COUNT: t(bookedN),
      BOOKED_ORDER_VALUE: t(bookedV),
      INVOICED_VALUE: t(invoiced),
    });
  }
  return out;
}

export function metricView(m: Prisma.MarketingCampaignMetricGetPayload<{ include: { manualUpdatedBy: { select: { fullName: true } } } }>, measured: Record<SystemMetricKey, { value: number; documents: number }> | undefined) {
  const target = m.targetValue === null ? null : Number(m.targetValue);
  const sys = m.source === "SYSTEM" && m.systemKey ? measured?.[m.systemKey as SystemMetricKey] : undefined;
  const actual = m.source === "SYSTEM" ? (sys?.value ?? 0) : m.manualActual === null ? null : Number(m.manualActual);
  return {
    id: m.id,
    source: m.source,
    systemKey: m.systemKey,
    label: m.label,
    unit: m.unit as MetricUnitKey,
    target,
    actual,
    documents: sys?.documents ?? null,
    percentOfTarget: target && actual !== null ? Math.round((actual / target) * 1000) / 10 : null,
    provenance: m.source === "SYSTEM" ? SYSTEM_METRICS[m.systemKey as SystemMetricKey]?.source ?? "" : m.manualActual === null ? "Manual — no result entered yet." : `Entered manually by ${m.manualUpdatedBy?.fullName ?? "—"} (as of ${m.manualAsOf ? dbDate(m.manualAsOf) : "—"}).`,
    notes: m.notes,
  };
}

// ── Budget: linked Expenses ─────────────────────────────────────

export async function budgetSummary(companyId: string, c: Pick<MarketingCampaign, "id" | "plannedBudget" | "currencyCode">) {
  const expenses = await prisma.expense.findMany({
    where: { companyId, campaignId: c.id },
    orderBy: { expenseDate: "desc" },
    select: { id: true, expenseNumber: true, expenseDate: true, description: true, amount: true, taxAmount: true, status: true, supplier: { select: { name: true } } },
  });
  const sum = (filter: (s: string) => boolean) => r2(expenses.filter((e) => filter(e.status)).reduce((s, e) => s + Number(e.amount), 0));
  const actual = sum((s) => (SPENT_EXPENSE_STATUSES as readonly string[]).includes(s));
  const pending = sum((s) => s === "PENDING_APPROVAL");
  const planned = c.plannedBudget === null ? null : r2(Number(c.plannedBudget));
  return {
    currencyCode: c.currencyCode,
    planned,
    actual,
    pending,
    remaining: planned === null ? null : r2(planned - actual),
    expenses: expenses.map((e) => ({
      id: e.id,
      number: e.expenseNumber,
      date: dbDate(e.expenseDate),
      description: e.description,
      supplier: e.supplier?.name ?? null,
      amount: r2(Number(e.amount)),
      tax: r2(Number(e.taxAmount)),
      status: e.status,
      counts: (SPENT_EXPENSE_STATUSES as readonly string[]).includes(e.status),
    })),
  };
}

export async function searchLinkableExpenses(actor: SalesActor, id: string, search?: string) {
  await PermissionService.assert(actor.userId, "expenses", "view");
  await loadCampaign(actor, id);
  const rows = await prisma.expense.findMany({
    where: {
      companyId: actor.companyId,
      campaignId: null,
      status: { notIn: ["REJECTED", "CANCELLED"] },
      ...(search ? { OR: [{ expenseNumber: { contains: search, mode: "insensitive" } }, { description: { contains: search, mode: "insensitive" } }] } : {}),
    },
    orderBy: { expenseDate: "desc" },
    take: 50,
    select: { id: true, expenseNumber: true, expenseDate: true, description: true, amount: true, status: true },
  });
  return rows.map((e) => ({ id: e.id, label: `${e.expenseNumber} · ${e.description}`, sublabel: `${dbDate(e.expenseDate)} · ₹${Number(e.amount).toLocaleString("en-IN")} · ${e.status.toLowerCase().replace(/_/g, " ")}` }));
}

export async function linkExpense(actor: SalesActor, id: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_campaigns", "edit");
  await PermissionService.assert(actor.userId, "expenses", "view");
  const { expenseId } = z.object({ expenseId: z.string().uuid() }).strict().parse(raw);
  const c = await loadCampaign(actor, id);
  if (c.status === "DRAFT" || c.status === "CANCELLED") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Spend is linked to an approved, running or completed campaign.");
  const e = await prisma.expense.findFirst({ where: { id: expenseId, companyId: actor.companyId }, select: { id: true, expenseNumber: true, campaignId: true, status: true, amount: true } });
  if (!e) throw new BusinessRuleError("NOT_FOUND", "Expense not found.", { expenseId });
  if (e.status === "REJECTED" || e.status === "CANCELLED") throw new BusinessRuleError("VALIDATION_ERROR", "A rejected or cancelled expense isn't spend.");
  if (e.campaignId) throw new BusinessRuleError("VALIDATION_ERROR", e.campaignId === c.id ? "This expense is already linked to this campaign." : "This expense is linked to another campaign. Unlink it there first.");
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.expense.updateMany({ where: { id: e.id, companyId: actor.companyId, campaignId: null }, data: { campaignId: c.id } });
    if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This expense was linked just now. Reload.");
    await recordCampaignEvent(tx, actor, c.id, "EXPENSE_LINKED", null, { expense: e.expenseNumber, amount: Number(e.amount) });
    await auditCampaign(tx, actor, e.id, "UPDATE", { campaignId: null }, { campaignId: c.id }, "expenses");
  });
  return { id };
}

export async function unlinkExpense(actor: SalesActor, id: string, expenseId: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_campaigns", "edit");
  const { reason } = z.object({ reason: z.string().trim().min(3, "Say why").max(500) }).strict().parse(raw);
  const c = await loadCampaign(actor, id);
  const e = await prisma.expense.findFirst({ where: { id: expenseId, companyId: actor.companyId, campaignId: c.id }, select: { id: true, expenseNumber: true } });
  if (!e) throw new BusinessRuleError("NOT_FOUND", "This expense isn't linked to the campaign.");
  await prisma.$transaction(async (tx) => {
    await tx.expense.updateMany({ where: { id: e.id, companyId: actor.companyId, campaignId: c.id }, data: { campaignId: null } });
    await recordCampaignEvent(tx, actor, c.id, "EXPENSE_UNLINKED", reason, { expense: e.expenseNumber });
    await auditCampaign(tx, actor, e.id, "UPDATE", { campaignId: c.id }, { campaignId: null, reason }, "expenses");
  });
  return { id };
}

// ── Linked records ──────────────────────────────────────────────

export async function linkedRecords(actor: SalesActor, c: Pick<MarketingCampaign, "id">) {
  const [crmView, smView, qView, soView] = await Promise.all([
    PermissionService.can(actor.userId, "crm", "view"),
    PermissionService.can(actor.userId, "sales_marketing", "view"),
    PermissionService.can(actor.userId, "sales_quotations", "view"),
    PermissionService.can(actor.userId, "sales_orders", "view"),
  ]);
  const where = { companyId: actor.companyId, campaignId: c.id };
  const [leads, enquiries, quotations, orders] = await Promise.all([
    crmView ? prisma.crmLead.findMany({ where, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, leadNumber: true, fullName: true, createdAt: true, convertedAt: true } }) : null,
    smView ? prisma.buyerEnquiry.findMany({ where, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, enquiryNumber: true, status: true, createdAt: true, customer: { select: { name: true } }, prospectName: true } }) : null,
    qView ? prisma.quotation.findMany({ where, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, quotationNumber: true, status: true, createdAt: true, customer: { select: { name: true } }, prospectName: true } }) : null,
    soView ? prisma.salesOrder.findMany({ where, orderBy: { orderDate: "desc" }, take: 50, select: { id: true, orderNumber: true, status: true, orderDate: true, baseTotalAmount: true, customer: { select: { name: true } } } }) : null,
  ]);
  return {
    leads: leads?.map((l) => ({ id: l.id, number: l.leadNumber, name: l.fullName, date: l.createdAt.toISOString().slice(0, 10), status: l.convertedAt ? "Converted" : "Open / lost" })) ?? null,
    enquiries: enquiries?.map((e) => ({ id: e.id, number: e.enquiryNumber, name: e.customer?.name ?? e.prospectName ?? "—", date: e.createdAt.toISOString().slice(0, 10), status: e.status })) ?? null,
    quotations: quotations?.map((q) => ({ id: q.id, number: q.quotationNumber, name: q.customer?.name ?? q.prospectName ?? "—", date: q.createdAt.toISOString().slice(0, 10), status: q.status })) ?? null,
    orders: orders?.map((o) => ({ id: o.id, number: o.orderNumber, name: o.customer.name, date: dbDate(o.orderDate), status: o.status, value: r2(Number(o.baseTotalAmount)) })) ?? null,
  };
}

// ── Activities (CRM tasks on the campaign) ──────────────────────

export async function activityProgress(companyId: string, campaignIds: string[]) {
  if (!campaignIds.length) return new Map<string, { total: number; done: number; overdue: number; milestones: number; milestonesDone: number }>();
  const now = new Date();
  const rows = await prisma.crmActivity.findMany({
    where: { companyId, deletedAt: null, links: { some: { entityType: "CAMPAIGN", entityId: { in: campaignIds } } } },
    select: { status: true, dueAt: true, allDay: true, metadata: true, links: { where: { entityType: "CAMPAIGN" }, select: { entityId: true } } },
  });
  const out = new Map<string, { total: number; done: number; overdue: number; milestones: number; milestonesDone: number }>();
  for (const r of rows) {
    const milestone = Boolean((r.metadata as Record<string, unknown> | null)?.[MILESTONE_FLAG]);
    // Same rule as CRM My Tasks (business time zone; an all-day task is overdue once its day has ended).
    const overdue = isOverdue(r, now);
    for (const l of r.links) {
      const p = out.get(l.entityId) ?? { total: 0, done: 0, overdue: 0, milestones: 0, milestonesDone: 0 };
      if (r.status !== "CANCELLED") p.total++;
      if (r.status === "COMPLETED") p.done++;
      if (overdue) p.overdue++;
      if (milestone && r.status !== "CANCELLED") {
        p.milestones++;
        if (r.status === "COMPLETED") p.milestonesDone++;
      }
      out.set(l.entityId, p);
    }
  }
  return out;
}

export async function campaignMilestones(companyId: string, campaignId: string) {
  const rows = await prisma.crmActivity.findMany({
    where: { companyId, deletedAt: null, links: { some: { entityType: "CAMPAIGN", entityId: campaignId } }, metadata: { path: [MILESTONE_FLAG], equals: true } },
    orderBy: [{ dueAt: "asc" }],
    select: { id: true, subject: true, status: true, dueAt: true, allDay: true, completedAt: true, assignedTo: { select: { fullName: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    subject: r.subject,
    status: r.status,
    /** Business-time-zone due date (as CRM shows it). */
    dueDate: dueParts(r.dueAt, r.allDay)?.date ?? null,
    overdue: isOverdue(r),
    completedAt: r.completedAt?.toISOString() ?? null,
    assignee: r.assignedTo?.fullName ?? null,
  }));
}

// ── Detail ──────────────────────────────────────────────────────

export async function getCampaign(actor: SalesActor, id: string) {
  await PermissionService.assert(actor.userId, "marketing_campaigns", "view");
  const base = await loadCampaign(actor, id);
  const c = await prisma.marketingCampaign.findUniqueOrThrow({
    where: { id: base.id },
    include: {
      type: { select: { id: true, name: true } },
      objective: { select: { id: true, name: true } },
      owner: { select: { id: true, fullName: true } },
      department: { select: { id: true, name: true } },
      salesChannel: { select: { id: true, name: true, code: true } },
      parent: { select: { id: true, code: true, name: true } },
      children: { select: { id: true, code: true, name: true, status: true }, orderBy: { code: "asc" } },
      createdBy: { select: { fullName: true } },
      updatedBy: { select: { fullName: true } },
      revisions: { orderBy: { revisionNumber: "desc" }, include: { requestedBy: { select: { fullName: true } }, decidedBy: { select: { fullName: true } } } },
      metrics: { orderBy: { sortOrder: "asc" }, include: { manualUpdatedBy: { select: { fullName: true } } } },
    },
  });
  const [measured, budget, links, progress, milestones, history, perms] = await Promise.all([
    measureCampaigns(actor.companyId, [c.id]),
    budgetSummary(actor.companyId, c),
    linkedRecords(actor, c),
    activityProgress(actor.companyId, [c.id]),
    campaignMilestones(actor.companyId, c.id),
    listCampaignEvents(actor.companyId, c.id),
    Promise.all(
      (["edit", "approve", "reject", "cancel"] as const).map((a) => PermissionService.can(actor.userId, "marketing_campaigns", a)).concat([
        PermissionService.can(actor.userId, "crm", "view"),
        PermissionService.can(actor.userId, "crm", "create"),
        PermissionService.can(actor.userId, "crm", "edit"),
        PermissionService.can(actor.userId, "expenses", "view"),
      ])
    ),
  ]);
  const [canEdit, canApprovePerm, canReject, canCancel, crmView, crmCreate, crmEdit, expensesView] = perms;
  const pending = c.revisions.find((r) => r.status === "PENDING_APPROVAL") ?? null;
  const status = c.status as CampaignStatusKey;
  const today = todayIsoDate();
  const warnings: string[] = [];
  if (status === "APPROVED" && dbDate(c.plannedStartDate) <= today) warnings.push(`Planned to start ${dbDate(c.plannedStartDate)} — activate it when it actually starts.`);
  if ((status === "ACTIVE" || status === "PAUSED") && dbDate(c.plannedEndDate) < today) warnings.push(`Past its planned end (${dbDate(c.plannedEndDate)}). Complete it, or request a plan change.`);
  if (!c.metrics.some((m) => m.targetValue !== null)) warnings.push("No success metric with a target yet.");
  if (c.plannedBudget === null) warnings.push("No planned budget.");
  const p = progress.get(c.id);
  if (p?.overdue) warnings.push(`${p.overdue} overdue activit${p.overdue === 1 ? "y" : "ies"}.`);
  const closed = status === "COMPLETED" || status === "CANCELLED";
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    description: c.description,
    status,
    statusHelp: CAMPAIGN_STATUSES[status].help,
    statusReason: c.statusReason,
    type: c.type,
    objective: c.objective,
    owner: c.owner,
    department: c.department,
    salesChannel: c.salesChannel,
    parent: c.parent,
    children: c.children,
    priority: c.priority,
    plannedStartDate: dbDate(c.plannedStartDate),
    plannedEndDate: dbDate(c.plannedEndDate),
    actualStartDate: c.actualStartDate ? dbDate(c.actualStartDate) : null,
    actualEndDate: c.actualEndDate ? dbDate(c.actualEndDate) : null,
    plannedBudget: c.plannedBudget === null ? null : r2(Number(c.plannedBudget)),
    budgetNotes: c.budgetNotes,
    currencyCode: c.currencyCode,
    approvedRevisionNumber: c.approvedRevisionNumber,
    version: c.version,
    createdBy: c.createdBy.fullName,
    createdAt: c.createdAt.toISOString(),
    updatedBy: c.updatedBy.fullName,
    updatedAt: c.updatedAt.toISOString(),
    revisions: c.revisions.map((r) => ({
      id: r.id,
      revisionNumber: r.revisionNumber,
      status: r.status,
      plannedStartDate: dbDate(r.plannedStartDate),
      plannedEndDate: dbDate(r.plannedEndDate),
      plannedBudget: r.plannedBudget === null ? null : r2(Number(r.plannedBudget)),
      budgetNotes: r.budgetNotes,
      reason: r.reason,
      autoApproved: r.autoApproved,
      requestedBy: r.requestedBy.fullName,
      requestedAt: r.requestedAt.toISOString(),
      decidedBy: r.decidedBy?.fullName ?? null,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      decisionComment: r.decisionComment,
    })),
    metrics: c.metrics.map((m) => metricView(m, measured.get(c.id))),
    budget,
    links,
    progress: p ?? { total: 0, done: 0, overdue: 0, milestones: 0, milestonesDone: 0 },
    milestones,
    history,
    warnings,
    can: {
      edit: canEdit && !closed,
      editPlan: canEdit && status === "DRAFT",
      requestPlanChange: canEdit && ["APPROVED", "ACTIVE", "PAUSED"].includes(status) && !pending,
      submit: canEdit && status === "DRAFT",
      returnToDraft: canEdit && status === "PENDING_APPROVAL",
      approve: canApprovePerm && Boolean(pending) && (await canApproveCampaign(actor.userId, status === "PENDING_APPROVAL" ? [c.createdByUserId, pending?.requestedByUserId] : [pending?.requestedByUserId])),
      sendBack: canReject && Boolean(pending),
      activate: canEdit && status === "APPROVED",
      pause: canEdit && status === "ACTIVE",
      resume: canEdit && status === "PAUSED",
      complete: canEdit && (status === "ACTIVE" || status === "PAUSED") && !pending,
      cancel: canCancel && !closed,
      delete: canEdit && status === "DRAFT",
      metrics: canEdit && status !== "CANCELLED",
      linkExpenses: canEdit && expensesView && !["DRAFT", "CANCELLED"].includes(status),
      activities: crmView,
      createActivities: crmCreate && status !== "CANCELLED",
      editActivities: crmEdit,
    },
  };
}

// ── Overview and calendar ───────────────────────────────────────

export async function campaignOverview(actor: SalesActor) {
  await PermissionService.assert(actor.userId, "marketing_campaigns", "view");
  const scope = await getCampaignScope(actor);
  const where = campaignScopeWhere(actor, scope);
  const today = todayIsoDate();
  const in30 = new Date(`${today}T00:00:00.000Z`);
  in30.setUTCDate(in30.getUTCDate() + 30);
  const [byStatus, campaigns, pendingRevisions] = await Promise.all([
    prisma.marketingCampaign.groupBy({ by: ["status"], where, _count: true }),
    prisma.marketingCampaign.findMany({
      where: { AND: [where, { status: { notIn: ["COMPLETED", "CANCELLED"] } }] },
      select: { id: true, code: true, name: true, status: true, plannedStartDate: true, plannedEndDate: true, plannedBudget: true, owner: { select: { fullName: true } }, _count: { select: { metrics: { where: { targetValue: { not: null } } } } } },
      orderBy: { plannedStartDate: "asc" },
    }),
    prisma.marketingCampaignRevision.count({ where: { status: "PENDING_APPROVAL", campaign: { AND: [where, { status: { not: "PENDING_APPROVAL" } }] } } }),
  ]);
  const progress = await activityProgress(actor.companyId, campaigns.map((c) => c.id));
  const counts = Object.fromEntries(byStatus.map((s) => [s.status, s._count])) as Partial<Record<CampaignStatusKey, number>>;
  const mini = (c: (typeof campaigns)[number]) => ({ id: c.id, code: c.code, name: c.name, status: c.status, owner: c.owner.fullName, plannedStartDate: dbDate(c.plannedStartDate), plannedEndDate: dbDate(c.plannedEndDate) });
  return {
    counts,
    awaitingApproval: (counts.PENDING_APPROVAL ?? 0) + pendingRevisions,
    startingSoon: campaigns.filter((c) => ["DRAFT", "PENDING_APPROVAL", "APPROVED"].includes(c.status) && c.plannedStartDate >= toDbDate(today) && c.plannedStartDate <= in30).map(mini),
    dueToStart: campaigns.filter((c) => c.status === "APPROVED" && dbDate(c.plannedStartDate) <= today).map(mini),
    pastPlannedEnd: campaigns.filter((c) => ["ACTIVE", "PAUSED"].includes(c.status) && dbDate(c.plannedEndDate) < today).map(mini),
    overdueActivities: [...progress.entries()].filter(([, p]) => p.overdue > 0).reduce((s, [, p]) => s + p.overdue, 0),
    missingInfo: campaigns.filter((c) => c.plannedBudget === null || c._count.metrics === 0).map((c) => ({ ...mini(c), missing: [c.plannedBudget === null ? "budget" : null, c._count.metrics === 0 ? "target" : null].filter(Boolean) as string[] })),
    plannedBudgetOpen: r2(campaigns.reduce((s, c) => s + Number(c.plannedBudget ?? 0), 0)),
  };
}

export const calendarSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  ownerUserId: z.string().uuid().optional().or(z.literal("")),
  status: z.string().optional(),
  typeId: z.string().uuid().optional().or(z.literal("")),
});

/** Campaigns overlapping a month (planned or actual dates) and their activity due dates in it. */
export async function campaignCalendar(actor: SalesActor, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_campaigns", "view");
  const f = calendarSchema.parse(raw ?? {});
  const [y, m] = f.month.split("-").map(Number);
  const start = `${f.month}-01`;
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const scope = await getCampaignScope(actor);
  const statuses = (f.status ?? "").split(",").filter(Boolean) as CampaignStatusKey[];
  const rows = await prisma.marketingCampaign.findMany({
    where: {
      AND: [
        campaignScopeWhere(actor, scope),
        statuses.length ? { status: { in: statuses } } : { status: { not: "CANCELLED" } },
        f.ownerUserId ? { ownerUserId: f.ownerUserId } : {},
        f.typeId ? { typeId: f.typeId } : {},
        { OR: [{ plannedStartDate: { lte: toDbDate(end) }, plannedEndDate: { gte: toDbDate(start) } }, { actualStartDate: { lte: toDbDate(end) }, OR: [{ actualEndDate: null }, { actualEndDate: { gte: toDbDate(start) } }] }] },
      ],
    },
    orderBy: [{ plannedStartDate: "asc" }, { code: "asc" }],
    take: 200,
    select: { id: true, code: true, name: true, status: true, plannedStartDate: true, plannedEndDate: true, actualStartDate: true, actualEndDate: true, owner: { select: { fullName: true } }, type: { select: { name: true } } },
  });
  const ids = rows.map((r) => r.id);
  const crmView = await PermissionService.can(actor.userId, "crm", "view");
  const acts = crmView && ids.length
    ? await prisma.crmActivity.findMany({
        // A day either side (time zones), then filtered by the business-time due date below.
        where: { companyId: actor.companyId, deletedAt: null, dueAt: { gte: new Date(Date.UTC(y, m - 1, 0)), lt: new Date(Date.UTC(y, m, 2)) }, links: { some: { entityType: "CAMPAIGN", entityId: { in: ids } } } },
        orderBy: { dueAt: "asc" },
        select: { id: true, subject: true, type: true, status: true, dueAt: true, allDay: true, metadata: true, links: { where: { entityType: "CAMPAIGN" }, select: { entityId: true } } },
      })
    : [];
  return {
    month: f.month,
    start,
    end,
    campaigns: rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      status: r.status,
      owner: r.owner.fullName,
      type: r.type.name,
      plannedStartDate: dbDate(r.plannedStartDate),
      plannedEndDate: dbDate(r.plannedEndDate),
      actualStartDate: r.actualStartDate ? dbDate(r.actualStartDate) : null,
      actualEndDate: r.actualEndDate ? dbDate(r.actualEndDate) : null,
    })),
    activities: acts
      .filter((a) => {
        const d = dueParts(a.dueAt, a.allDay)?.date;
        return Boolean(d && d >= start && d <= end);
      })
      .map((a) => ({
      id: a.id,
      campaignId: a.links[0]?.entityId ?? null,
      subject: a.subject,
      type: a.type,
      status: a.status,
      dueDate: dueParts(a.dueAt, a.allDay)!.date,
      overdue: isOverdue(a),
      milestone: Boolean((a.metadata as Record<string, unknown> | null)?.[MILESTONE_FLAG]),
    })),
    activitiesHidden: !crmView,
  };
}

// ── Milestones (CRM tasks flagged as milestone) ─────────────────

export const milestoneSchema = z
  .object({
    subject: z.string().trim().min(1, "Name the milestone").max(200),
    dueDate: isoDateSchema,
    assignedToUserId: z.string().uuid().optional().or(z.literal("")).nullable(),
    description: optionalText(2000),
  })
  .strict();

/** A milestone is a CRM task on the campaign with metadata.milestone = true (shows in My Tasks and the CRM calendar). */
export async function addMilestone(actor: SalesActor, id: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "marketing_campaigns", "edit");
  await PermissionService.assert(actor.userId, "crm", "create");
  const input = milestoneSchema.parse(raw);
  const c = await loadCampaign(actor, id);
  if (c.status === "CANCELLED" || c.status === "COMPLETED") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "A completed or cancelled campaign takes no new milestones.");
  const { createActivity } = await import("@/modules/crm/activities/crm-activities.service");
  return createActivity(
    { companyId: actor.companyId, userId: actor.userId, branchId: actor.branchId ?? null },
    {
      type: "TASK",
      mode: "schedule",
      subject: input.subject,
      description: input.description || undefined,
      priority: "HIGH",
      entityType: "CAMPAIGN",
      entityId: c.id,
      dueDate: input.dueDate,
      assignedToUserId: input.assignedToUserId || c.ownerUserId,
      metadata: { [MILESTONE_FLAG]: true },
    }
  );
}
