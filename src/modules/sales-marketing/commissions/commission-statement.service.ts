import { randomUUID } from "node:crypto";
import { Prisma, type SalesCommissionLineKind, type SalesCommissionStatement } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/core/db/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { createNotification } from "@/core/notifications/NotificationService";
import { PermissionService } from "@/core/rbac/PermissionService";
import { todayIsoDate } from "@/lib/date";
import { createPaymentRequest } from "@/modules/accounts/payment-requests/payment-request.service";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { metricTotals } from "@/modules/sales-marketing/performance/performance-actuals";
import { dbDate, optionalText, toDbDate } from "@/modules/sales-marketing/performance/performance-common";
import { INVOICED_STATUSES, metricDefinition } from "@/modules/sales-marketing/performance/performance-registry";
import { collectedBasis, commissionFor, incentiveReward, spread } from "./commission-engine";
import { canApproveCommission, notifyCommissionApprovers, ruleOf, ruleSummary } from "./commission-plan.service";
import { incentiveTiersOf } from "./incentive-plan.service";

/**
 * Monthly commission statements (Phase 07, PHASE_07_COMMISSIONS.md §4–§6).
 * Calculate (re-calculable while Draft) → submit → approve (approver ≠
 * preparer / submitter) → Payment Request (type SALES_COMMISSION). Every line
 * has a stable event key, unique per payee, so no event is ever paid twice.
 */

const TABLE = "sales_commission_statements";
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use a YYYY-MM month");
export const calculateSchema = z.object({ month: monthSchema }).strict();
export const adjustmentSchema = z
  .object({
    amount: z.coerce.number().refine((v) => v !== 0, "Enter a non-zero amount").refine((v) => Math.abs(v) <= 99_99_99_999, "Too large"),
    reason: z.string().trim().min(3, "Say why").max(500),
  })
  .strict();
const commentSchema = z.object({ comment: optionalText(1000) }).strict();
const reasonSchema = z.object({ reason: z.string().trim().min(3, "Say why").max(1000) }).strict();

export function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { start: `${month}-01`, end };
}

type PayeeType = "REP" | "AGENT";
interface Payee {
  type: PayeeType;
  id: string;
  key: string;
}
const payeeKey = (type: PayeeType, id: string) => `${type}:${id}`;
const parsePayee = (key: string): Payee => {
  const [type, id] = key.split(":") as [PayeeType, string];
  return { type, id, key };
};

interface NewLine {
  kind: SalesCommissionLineKind;
  eventKey: string;
  planId?: string | null;
  planVersionId?: string | null;
  incentivePlanId?: string | null;
  salesInvoiceId?: string | null;
  salesOrderId?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  eventDate?: string | null;
  basisAmount?: number | null;
  rate?: number | null;
  amount: number;
  details?: Record<string, unknown>;
  reversalOfLineId?: string | null;
  reason?: string | null;
}

interface Event {
  key: string;
  basis: "INVOICED" | "COLLECTED";
  date: string;
  amount: number;
  invoiceId: string;
  invoiceNumber: string;
  orderId: string;
  orderNumber: string;
  repUserId: string | null;
  agentId: string | null;
  sourceType: "SALES_INVOICE" | "PAYMENT_ALLOCATION";
  sourceId: string;
  paymentNumber?: string;
}

/** Earning events (invoices posted / payments allocated) dated on or before `to`. */
async function loadEvents(companyId: string, from: string, to: string): Promise<Event[]> {
  const range = { gte: toDbDate(from), lte: toDbDate(to) };
  const order = { select: { id: true, orderNumber: true, salesRepUserId: true, salesAgentId: true } };
  const [invoices, allocations] = await Promise.all([
    prisma.salesInvoice.findMany({
      where: { companyId, status: { in: [...INVOICED_STATUSES] }, invoiceDate: range },
      select: { id: true, invoiceNumber: true, invoiceDate: true, subtotalAmount: true, exchangeRate: true, salesOrder: order },
    }),
    prisma.paymentAllocation.findMany({
      where: { salesInvoiceId: { not: null }, payment: { companyId, status: "POSTED", direction: "RECEIPT", paymentDate: range }, salesInvoice: { status: { in: [...INVOICED_STATUSES] } } },
      select: {
        id: true,
        allocatedAmount: true,
        payment: { select: { paymentNumber: true, paymentDate: true } },
        salesInvoice: { select: { id: true, invoiceNumber: true, subtotalAmount: true, totalAmount: true, exchangeRate: true, salesOrder: order } },
      },
    }),
  ]);
  const out: Event[] = invoices.map((i) => ({
    key: `INV:${i.id}`,
    basis: "INVOICED",
    date: dbDate(i.invoiceDate),
    amount: r2(Number(i.subtotalAmount) * Number(i.exchangeRate)),
    invoiceId: i.id,
    invoiceNumber: i.invoiceNumber,
    orderId: i.salesOrder.id,
    orderNumber: i.salesOrder.orderNumber,
    repUserId: i.salesOrder.salesRepUserId,
    agentId: i.salesOrder.salesAgentId,
    sourceType: "SALES_INVOICE",
    sourceId: i.id,
  }));
  for (const a of allocations) {
    const inv = a.salesInvoice!;
    out.push({
      key: `ALLOC:${a.id}`,
      basis: "COLLECTED",
      date: dbDate(a.payment.paymentDate),
      amount: collectedBasis(Number(a.allocatedAmount), Number(inv.subtotalAmount), Number(inv.totalAmount), Number(inv.exchangeRate)),
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      orderId: inv.salesOrder.id,
      orderNumber: inv.salesOrder.orderNumber,
      repUserId: inv.salesOrder.salesRepUserId,
      agentId: inv.salesOrder.salesAgentId,
      sourceType: "PAYMENT_ALLOCATION",
      sourceId: a.id,
      paymentNumber: a.payment.paymentNumber,
    });
  }
  return out;
}

const inRange = (d: string, start: Date, end: Date | null) => dbDate(start) <= d && (!end || d <= dbDate(end));

/** Whether an earning event's source is still there (for reversals of frozen lines). */
async function goneSources(companyId: string, lines: { sourceType: string | null; sourceId: string | null }[]) {
  const invIds = lines.filter((l) => l.sourceType === "SALES_INVOICE").map((l) => l.sourceId!);
  const allocIds = lines.filter((l) => l.sourceType === "PAYMENT_ALLOCATION").map((l) => l.sourceId!);
  const [invs, allocs] = await Promise.all([
    invIds.length ? prisma.salesInvoice.findMany({ where: { companyId, id: { in: invIds } }, select: { id: true, status: true } }) : [],
    allocIds.length ? prisma.paymentAllocation.findMany({ where: { id: { in: allocIds } }, select: { id: true, payment: { select: { status: true } }, salesInvoice: { select: { status: true } } } }) : [],
  ]);
  const alive = new Set<string>();
  for (const i of invs) if ((INVOICED_STATUSES as readonly string[]).includes(i.status)) alive.add(i.id);
  for (const a of allocs) if (a.payment.status === "POSTED" && a.salesInvoice && (INVOICED_STATUSES as readonly string[]).includes(a.salesInvoice.status)) alive.add(a.id);
  return (l: { sourceId: string | null }) => !alive.has(l.sourceId!);
}

export interface CalculationResult {
  month: string;
  calculated: { payee: string; statementId: string; net: number; lines: number }[];
  skippedLocked: { payee: string; status: string }[];
  removedEmpty: number;
  notes: string[];
}

/**
 * Calculates (or re-calculates) the Draft statement of every payee for a
 * month. Statements already submitted or approved are left alone.
 */
export async function calculateStatements(actor: SalesActor, raw: unknown): Promise<CalculationResult> {
  await PermissionService.assert(actor.userId, "sales_commissions", "create");
  const { month } = calculateSchema.parse(raw);
  const { start, end } = monthRange(month);
  const today = todayIsoDate();
  if (start > today) throw new BusinessRuleError("VALIDATION_ERROR", "That month hasn't started yet.", { fieldErrors: { month: "In the future." } });
  const companyId = actor.companyId;
  const notes: string[] = [];

  // ── Commission events ──────────────────────────────────────────
  const assignments = await prisma.salesCommissionAssignment.findMany({
    where: { companyId, startDate: { lte: toDbDate(end) } },
    include: { plan: { select: { id: true, basis: true, isActive: true, code: true, versions: { where: { status: "APPROVED" }, orderBy: { effectiveFrom: "desc" } } } } },
  });
  const byPayee = new Map<string, typeof assignments>();
  for (const a of assignments) {
    const k = payeeKey(a.payeeType, (a.userId ?? a.salesAgentId)!);
    byPayee.set(k, [...(byPayee.get(k) ?? []), a]);
  }
  const earliest = assignments.reduce<string | null>((m, a) => (m === null || dbDate(a.startDate) < m ? dbDate(a.startDate) : m), null);
  const events = earliest ? await loadEvents(companyId, earliest, end) : [];

  // Lines already taken by statements (any payee of the same type for earnings; a payee's own key otherwise).
  const taken = await prisma.salesCommissionLine.findMany({
    where: { companyId },
    select: { payeeKey: true, eventKey: true, kind: true, statement: { select: { id: true, status: true, periodStart: true } } },
  });
  const takenElsewhere = new Map<string, Set<string>>(); // earnings: `${type}|${eventKey}` → payee keys holding it outside their own draft
  for (const l of taken) {
    const k = l.kind === "EARNING" ? `${l.payeeKey.split(":")[0]}|${l.eventKey}` : `${l.payeeKey}|${l.eventKey}`;
    if (!takenElsewhere.has(k)) takenElsewhere.set(k, new Set());
    takenElsewhere.get(k)!.add(l.payeeKey + (l.statement.status === "DRAFT" ? `@${dbDate(l.statement.periodStart)}` : "@frozen"));
  }
  const isTaken = (payee: string, kind: SalesCommissionLineKind, eventKey: string) => {
    const k = kind === "EARNING" ? `${payee.split(":")[0]}|${eventKey}` : `${payee}|${eventKey}`;
    const holders = takenElsewhere.get(k);
    if (!holders) return false;
    for (const h of holders) if (h !== `${payee}@${start}`) return true;
    return false;
  };

  const linesByPayee = new Map<string, NewLine[]>();
  const push = (payee: string, line: NewLine) => linesByPayee.set(payee, [...(linesByPayee.get(payee) ?? []), line]);

  for (const [payee, list] of byPayee) {
    const p = parsePayee(payee);
    const mine = events.filter((e) => (p.type === "REP" ? e.repUserId === p.id : e.agentId === p.id));
    const groups = new Map<string, { plan: (typeof list)[number]["plan"]; version: (typeof list)[number]["plan"]["versions"][number]; events: Event[] }>();
    for (const e of mine) {
      const a = list.find((x) => inRange(e.date, x.startDate, x.endDate));
      if (!a || a.plan.basis !== e.basis) continue;
      const v = a.plan.versions.find((x) => inRange(e.date, x.effectiveFrom, x.effectiveTo));
      if (!v) continue;
      if (isTaken(payee, "EARNING", e.key)) continue;
      const g = groups.get(v.id) ?? { plan: a.plan, version: v, events: [] };
      g.events.push(e);
      groups.set(v.id, g);
    }
    for (const g of groups.values()) {
      const rule = ruleOf(g.version);
      const basis = g.events.reduce((s, e) => s + e.amount, 0);
      const result = commissionFor(rule, basis, g.events.length);
      const shares = spread(result.amount, g.events.map((e) => (rule.method === "FIXED" ? 1 : e.amount)));
      g.events.forEach((e, i) =>
        push(payee, {
          kind: "EARNING",
          eventKey: e.key,
          planId: g.plan.id,
          planVersionId: g.version.id,
          salesInvoiceId: e.invoiceId,
          salesOrderId: e.orderId,
          sourceType: e.sourceType,
          sourceId: e.sourceId,
          eventDate: e.date,
          basisAmount: e.amount,
          rate: e.amount > 0 ? Math.round((shares[i] / e.amount) * 1_000_000) / 10_000 : null,
          amount: shares[i],
          details: {
            planCode: g.plan.code,
            versionNumber: g.version.versionNumber,
            rule: ruleSummary(rule),
            invoiceNumber: e.invoiceNumber,
            orderNumber: e.orderNumber,
            paymentNumber: e.paymentNumber ?? null,
            group: { basis: result.basis, events: result.events, gross: result.gross, amount: result.amount, effectiveRate: result.effectiveRate, belowMinimum: result.belowMinimum, capped: result.capped, slices: result.slices },
          },
        })
      );
    }
  }

  // ── Reversals of frozen earnings whose invoice / payment is gone ──
  const frozen = await prisma.salesCommissionLine.findMany({
    where: { companyId, kind: "EARNING", amount: { gt: 0 }, statement: { status: { in: ["PENDING_APPROVAL", "APPROVED"] } } },
    select: { id: true, payeeKey: true, amount: true, planId: true, planVersionId: true, salesInvoiceId: true, salesOrderId: true, sourceType: true, sourceId: true, eventDate: true, basisAmount: true, details: true },
  });
  if (frozen.length) {
    const gone = await goneSources(companyId, frozen);
    for (const l of frozen.filter(gone)) {
      const key = `REV:${l.id}`;
      if (isTaken(l.payeeKey, "REVERSAL", key)) continue;
      const d = (l.details ?? {}) as Record<string, unknown>;
      push(l.payeeKey, {
        kind: "REVERSAL",
        eventKey: key,
        planId: l.planId,
        planVersionId: l.planVersionId,
        salesInvoiceId: l.salesInvoiceId,
        salesOrderId: l.salesOrderId,
        sourceType: l.sourceType,
        sourceId: l.sourceId,
        eventDate: l.eventDate ? dbDate(l.eventDate) : null,
        basisAmount: l.basisAmount === null ? null : -Number(l.basisAmount),
        amount: -Number(l.amount),
        reversalOfLineId: l.id,
        details: { invoiceNumber: d.invoiceNumber ?? null, orderNumber: d.orderNumber ?? null, paymentNumber: d.paymentNumber ?? null, why: l.sourceType === "SALES_INVOICE" ? "Invoice cancelled" : "Payment cancelled" },
      });
    }
  }

  // ── Carry-forward of approved negative months ──
  const negatives = await prisma.salesCommissionStatement.findMany({ where: { companyId, status: "APPROVED", netAmount: { lt: 0 }, periodStart: { lt: toDbDate(start) } } });
  for (const s of negatives) {
    const payee = payeeKey(s.payeeType, (s.userId ?? s.salesAgentId)!);
    const key = `CF:${s.id}`;
    if (isTaken(payee, "CARRY_FORWARD", key)) continue;
    push(payee, { kind: "CARRY_FORWARD", eventKey: key, amount: Number(s.netAmount), details: { fromPeriod: dbDate(s.periodStart).slice(0, 7) } });
  }

  // ── Incentives for REP target periods ending this month ──
  const incentivePlans = await prisma.salesIncentivePlan.findMany({ where: { companyId, status: "APPROVED" } });
  if (incentivePlans.length) {
    const targets = await prisma.salesTarget.findMany({
      where: { companyId, scope: "REP", isArchived: false, periodEnd: { gte: toDbDate(start), lte: toDbDate(end) }, revisions: { some: { status: "APPROVED" } } },
      include: { revisions: { where: { status: "APPROVED" }, orderBy: { revisionNumber: "desc" }, take: 1 } },
    });
    const actualCache = new Map<string, Awaited<ReturnType<typeof metricTotals>>>();
    let pending = false;
    for (const t of targets) {
      const pEnd = dbDate(t.periodEnd);
      if (pEnd >= today) {
        pending = true;
        continue;
      }
      for (const plan of incentivePlans) {
        if (plan.metric !== t.metric || plan.periodType !== t.periodType || !inRange(pEnd, plan.effectiveFrom, plan.effectiveTo)) continue;
        if (plan.userIds.length && !plan.userIds.includes(t.userId!)) continue;
        const payee = payeeKey("REP", t.userId!);
        const key = `INC:${plan.id}:${dbDate(t.periodStart)}`;
        if (isTaken(payee, "INCENTIVE", key)) continue;
        const ck = `${t.metric}|${dbDate(t.periodStart)}|${pEnd}`;
        if (!actualCache.has(ck)) actualCache.set(ck, await metricTotals(companyId, t.metric, dbDate(t.periodStart), pEnd, "REP"));
        const actual = actualCache.get(ck)!.get(t.userId!)?.value ?? 0;
        const target = Number(t.revisions[0].targetValue);
        const attainment = target > 0 ? Math.round((actual / target) * 10_000) / 100 : null;
        const tier = incentiveReward(incentiveTiersOf(plan), attainment);
        if (!tier || tier.reward <= 0) continue;
        push(payee, {
          kind: "INCENTIVE",
          eventKey: key,
          incentivePlanId: plan.id,
          sourceType: "SALES_TARGET",
          sourceId: t.id,
          eventDate: pEnd,
          basisAmount: actual,
          amount: tier.reward,
          details: { planCode: plan.code, metric: metricDefinition(t.metric).label, periodStart: dbDate(t.periodStart), periodEnd: pEnd, target, actual, attainment, tier },
        });
      }
    }
    if (pending) notes.push("Incentives for target periods ending this month are added once the period is over.");
  }

  // ── Write: one transaction per payee ──
  const existing = await prisma.salesCommissionStatement.findMany({ where: { companyId, periodStart: toDbDate(start) }, include: { lines: { where: { kind: "ADJUSTMENT" }, select: { id: true } } } });
  const existingByPayee = new Map(existing.map((s) => [payeeKey(s.payeeType, (s.userId ?? s.salesAgentId)!), s]));
  const payees = new Set([...linesByPayee.keys(), ...existing.filter((s) => s.status === "DRAFT").map((s) => payeeKey(s.payeeType, (s.userId ?? s.salesAgentId)!))]);
  const names = await payeeNames(companyId, [...payees].map(parsePayee));
  const result: CalculationResult = { month, calculated: [], skippedLocked: [], removedEmpty: 0, notes };

  for (const payee of payees) {
    const p = parsePayee(payee);
    const lines = linesByPayee.get(payee) ?? [];
    const current = existingByPayee.get(payee);
    if (current && current.status !== "DRAFT") {
      if (lines.length) result.skippedLocked.push({ payee: names.get(payee) ?? payee, status: current.status });
      continue;
    }
    if (!lines.length && (!current || !current.lines.length)) {
      if (current) {
        await prisma.$transaction(async (tx) => {
          await tx.salesCommissionStatement.deleteMany({ where: { id: current.id, status: "DRAFT", version: current.version } });
          await audit(tx, actor, current.id, "DELETE", { reason: "Nothing to pay after recalculation" }, null);
        });
        result.removedEmpty++;
      }
      continue;
    }
    try {
      const id = await prisma.$transaction(async (tx) => {
        let statementId: string;
        if (current) {
          const { count } = await tx.salesCommissionStatement.updateMany({
            where: { id: current.id, status: "DRAFT", version: current.version },
            data: { calculatedAt: new Date(), calculatedByUserId: actor.userId, version: { increment: 1 }, decisionComment: current.decisionComment },
          });
          if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "A statement changed while calculating. Calculate again.");
          await tx.salesCommissionLine.deleteMany({ where: { statementId: current.id, kind: { not: "ADJUSTMENT" } } });
          statementId = current.id;
        } else {
          const s = await tx.salesCommissionStatement.create({
            data: { companyId, payeeType: p.type, userId: p.type === "REP" ? p.id : null, salesAgentId: p.type === "AGENT" ? p.id : null, periodStart: toDbDate(start), periodEnd: toDbDate(end), calculatedByUserId: actor.userId },
          });
          statementId = s.id;
        }
        if (lines.length) {
          await tx.salesCommissionLine.createMany({
            data: lines.map((l) => ({
              companyId,
              statementId,
              payeeKey: payee,
              kind: l.kind,
              eventKey: l.eventKey,
              planId: l.planId ?? null,
              planVersionId: l.planVersionId ?? null,
              incentivePlanId: l.incentivePlanId ?? null,
              salesInvoiceId: l.salesInvoiceId ?? null,
              salesOrderId: l.salesOrderId ?? null,
              sourceType: l.sourceType ?? null,
              sourceId: l.sourceId ?? null,
              eventDate: l.eventDate ? toDbDate(l.eventDate) : null,
              basisAmount: l.basisAmount ?? null,
              rate: l.rate ?? null,
              amount: l.amount,
              details: (l.details ?? {}) as Prisma.InputJsonValue,
              reversalOfLineId: l.reversalOfLineId ?? null,
              reason: l.reason ?? null,
            })),
          });
        }
        await refreshTotals(tx, statementId);
        await audit(tx, actor, statementId, current ? "UPDATE" : "CREATE", null, { month, payee: names.get(payee), lines: lines.length, recalculated: Boolean(current) });
        return statementId;
      });
      const s = await prisma.salesCommissionStatement.findUniqueOrThrow({ where: { id }, select: { netAmount: true, _count: { select: { lines: true } } } });
      result.calculated.push({ payee: names.get(payee) ?? payee, statementId: id, net: Number(s.netAmount), lines: s._count.lines });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "Someone else calculated commission at the same time. Calculate again.");
      }
      throw error;
    }
  }
  result.calculated.sort((a, b) => a.payee.localeCompare(b.payee));
  return result;
}

async function refreshTotals(tx: Prisma.TransactionClient, statementId: string) {
  const sums = await tx.salesCommissionLine.groupBy({ by: ["kind"], where: { statementId }, _sum: { amount: true } });
  const t = (k: SalesCommissionLineKind) => Number(sums.find((s) => s.kind === k)?._sum.amount ?? 0);
  const totals = { earnedTotal: t("EARNING"), reversalTotal: t("REVERSAL"), incentiveTotal: t("INCENTIVE"), adjustmentTotal: t("ADJUSTMENT"), carryForwardTotal: t("CARRY_FORWARD") };
  const netAmount = r2(Object.values(totals).reduce((s, v) => s + v, 0));
  await tx.salesCommissionStatement.update({ where: { id: statementId }, data: { ...totals, netAmount } });
}

async function payeeNames(companyId: string, payees: Payee[]) {
  const users = payees.filter((p) => p.type === "REP").map((p) => p.id);
  const agents = payees.filter((p) => p.type === "AGENT").map((p) => p.id);
  const [u, a] = await Promise.all([
    users.length ? prisma.user.findMany({ where: { companyId, id: { in: users } }, select: { id: true, fullName: true } }) : [],
    agents.length ? prisma.salesAgent.findMany({ where: { companyId, id: { in: agents } }, select: { id: true, name: true, code: true } }) : [],
  ]);
  const out = new Map<string, string>();
  for (const x of u) out.set(payeeKey("REP", x.id), x.fullName);
  for (const x of a) out.set(payeeKey("AGENT", x.id), `${x.name} (${x.code})`);
  return out;
}

async function audit(tx: Prisma.TransactionClient, actor: SalesActor, id: string, action: "CREATE" | "UPDATE" | "APPROVE" | "REJECT" | "DELETE", oldValues: unknown, newValues: unknown) {
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: TABLE, recordId: id, action, oldValues: oldValues as Record<string, unknown>, newValues: newValues as Record<string, unknown> }, tx);
}

// ── Visibility ───────────────────────────────────────────────────

async function canViewAll(userId: string) {
  return PermissionService.can(userId, "sales_commissions", "view_all");
}

async function loadVisible(actor: SalesActor, id: string) {
  await PermissionService.assert(actor.userId, "sales_commissions", "view");
  const s = await prisma.salesCommissionStatement.findFirst({ where: { id, companyId: actor.companyId } });
  if (!s || (!(await canViewAll(actor.userId)) && s.userId !== actor.userId)) throw new BusinessRuleError("NOT_FOUND", "Commission statement not found.", { id });
  return s;
}

// ── Adjustments ──────────────────────────────────────────────────

export async function addAdjustment(actor: SalesActor, id: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_commissions", "create");
  const input = adjustmentSchema.parse(raw);
  const s = await loadVisible(actor, id);
  if (s.status !== "DRAFT") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Adjustments can only be added to a draft statement.");
  await prisma.$transaction(async (tx) => {
    await guardedMove(tx, s, {});
    await tx.salesCommissionLine.create({
      data: { companyId: actor.companyId, statementId: s.id, payeeKey: payeeKey(s.payeeType, (s.userId ?? s.salesAgentId)!), kind: "ADJUSTMENT", eventKey: `ADJ:${randomUUID()}`, amount: r2(input.amount), reason: input.reason, createdByUserId: actor.userId },
    });
    await refreshTotals(tx, s.id);
    await audit(tx, actor, s.id, "UPDATE", null, { adjustment: r2(input.amount), reason: input.reason });
  });
  return getStatement(actor, id);
}

export async function removeAdjustment(actor: SalesActor, id: string, lineId: string) {
  await PermissionService.assert(actor.userId, "sales_commissions", "create");
  const s = await loadVisible(actor, id);
  if (s.status !== "DRAFT") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Adjustments can only be removed from a draft statement.");
  const line = await prisma.salesCommissionLine.findFirst({ where: { id: lineId, statementId: s.id, kind: "ADJUSTMENT" } });
  if (!line) throw new BusinessRuleError("NOT_FOUND", "Adjustment not found.");
  await prisma.$transaction(async (tx) => {
    await guardedMove(tx, s, {});
    await tx.salesCommissionLine.delete({ where: { id: line.id } });
    await refreshTotals(tx, s.id);
    await audit(tx, actor, s.id, "UPDATE", { adjustment: Number(line.amount), reason: line.reason }, { adjustmentRemoved: true });
  });
  return getStatement(actor, id);
}

// ── Workflow ─────────────────────────────────────────────────────

async function guardedMove(tx: Prisma.TransactionClient, s: SalesCommissionStatement, data: Prisma.SalesCommissionStatementUncheckedUpdateManyInput) {
  const { count } = await tx.salesCommissionStatement.updateMany({ where: { id: s.id, companyId: s.companyId, status: s.status, version: s.version }, data: { ...data, version: { increment: 1 } } });
  if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This statement changed just now. Reload and try again.");
}

export async function statementAction(actor: SalesActor, id: string, action: string, raw: unknown) {
  const s = await loadVisible(actor, id);
  const label = `${(await payeeNames(actor.companyId, [parsePayee(payeeKey(s.payeeType, (s.userId ?? s.salesAgentId)!))])).values().next().value ?? "payee"} · ${dbDate(s.periodStart).slice(0, 7)}`;
  const need = (statuses: string[], verb: string) => {
    if (!statuses.includes(s.status)) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `A ${s.status.toLowerCase().replace(/_/g, " ")} statement can't be ${verb}.`);
  };
  switch (action) {
    case "submit": {
      await PermissionService.assert(actor.userId, "sales_commissions", "create");
      const { comment } = commentSchema.parse(raw ?? {});
      need(["DRAFT"], "submitted");
      if (dbDate(s.periodEnd) >= todayIsoDate()) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "The month isn't over yet. Submit the statement after it ends.");
      await prisma.$transaction(async (tx) => {
        await guardedMove(tx, s, { status: "PENDING_APPROVAL", submittedByUserId: actor.userId, submittedAt: new Date(), decisionComment: null });
        await audit(tx, actor, s.id, "UPDATE", { status: s.status }, { status: "PENDING_APPROVAL", comment });
        await notifyCommissionApprovers(tx, actor, [actor.userId, s.calculatedByUserId], `Commission statement ${label} waits for approval`, `Net ₹${Number(s.netAmount).toLocaleString("en-IN")}`);
      });
      break;
    }
    case "return-to-draft": {
      await PermissionService.assert(actor.userId, "sales_commissions", "create");
      need(["PENDING_APPROVAL"], "returned to draft");
      await prisma.$transaction(async (tx) => {
        await guardedMove(tx, s, { status: "DRAFT", submittedByUserId: null, submittedAt: null });
        await audit(tx, actor, s.id, "UPDATE", { status: s.status }, { status: "DRAFT" });
      });
      break;
    }
    case "send-back": {
      await PermissionService.assert(actor.userId, "sales_commissions", "reject");
      const { reason } = reasonSchema.parse(raw ?? {});
      need(["PENDING_APPROVAL"], "sent back");
      await prisma.$transaction(async (tx) => {
        await guardedMove(tx, s, { status: "DRAFT", decisionComment: reason, submittedByUserId: null, submittedAt: null });
        await audit(tx, actor, s.id, "REJECT", { status: s.status }, { status: "DRAFT", reason });
        for (const u of new Set([s.calculatedByUserId, s.submittedByUserId].filter((x): x is string => Boolean(x) && x !== actor.userId))) {
          await createNotification({ companyId: actor.companyId, userId: u, title: `Commission statement ${label} sent back`, body: reason }, tx);
        }
      });
      break;
    }
    case "approve": {
      await PermissionService.assert(actor.userId, "sales_commissions", "approve");
      const { comment } = commentSchema.parse(raw ?? {});
      need(["PENDING_APPROVAL"], "approved");
      if (!(await canApproveCommission(actor.userId, [s.calculatedByUserId, s.submittedByUserId]))) {
        throw new BusinessRuleError("SELF_APPROVAL_NOT_ALLOWED", "Someone other than the person who calculated or submitted this statement must approve it.");
      }
      if (s.payeeType === "REP" && s.userId === actor.userId && !(await PermissionService.can(actor.userId, "sales_commissions", "approve", { createdBy: actor.userId }))) {
        throw new BusinessRuleError("SELF_APPROVAL_NOT_ALLOWED", "You can't approve your own commission.");
      }
      await prisma.$transaction(async (tx) => {
        await guardedMove(tx, s, { status: "APPROVED", approvedByUserId: actor.userId, approvedAt: new Date(), decisionComment: comment || null });
        await audit(tx, actor, s.id, "APPROVE", { status: s.status }, { status: "APPROVED", net: Number(s.netAmount) });
      });
      if (Number(s.netAmount) > 0) {
        try {
          await raisePayment(actor, s.id);
        } catch {
          // The statement stays approved; the screen offers "Raise payment request" to retry.
        }
      }
      break;
    }
    case "raise-payment": {
      await PermissionService.assert(actor.userId, "sales_commissions", "approve");
      need(["APPROVED"], "paid");
      await raisePayment(actor, s.id);
      break;
    }
    case "discard": {
      await PermissionService.assert(actor.userId, "sales_commissions", "create");
      need(["DRAFT"], "discarded");
      await prisma.$transaction(async (tx) => {
        await tx.salesCommissionStatement.deleteMany({ where: { id: s.id, status: "DRAFT", version: s.version } });
        await audit(tx, actor, s.id, "DELETE", { period: dbDate(s.periodStart), net: Number(s.netAmount) }, null);
      });
      return { id: s.id, deleted: true as const };
    }
    default:
      throw new BusinessRuleError("NOT_FOUND", "Unknown action.", { action });
  }
  return getStatement(actor, id);
}

/** Raises (or re-raises after a rejected / cancelled one) the statement's SALES_COMMISSION payment request. Idempotent. */
async function raisePayment(actor: SalesActor, statementId: string) {
  const s = await prisma.salesCommissionStatement.findFirstOrThrow({ where: { id: statementId, companyId: actor.companyId }, include: { paymentRequest: { select: { status: true } } } });
  if (s.status !== "APPROVED") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Only an approved statement is paid.");
  if (Number(s.netAmount) <= 0) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "There's nothing to pay: the net amount is zero or to be recovered next month.");
  if (s.paymentRequest && !["REJECTED", "CANCELLED"].includes(s.paymentRequest.status)) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "A payment request is already raised for this statement.");
  const attempt = await prisma.paymentRequest.count({ where: { companyId: actor.companyId, sourceModule: "SALES_COMMISSION_STATEMENT", sourceRecordId: s.id } });
  const name = (await payeeNames(actor.companyId, [parsePayee(payeeKey(s.payeeType, (s.userId ?? s.salesAgentId)!))])).values().next().value ?? "Payee";
  const month = dbDate(s.periodStart).slice(0, 7);
  const pr = await createPaymentRequest(
    { companyId: actor.companyId, userId: actor.userId, branchId: actor.branchId ?? null },
    {
      requestType: "SALES_COMMISSION",
      amount: Number(s.netAmount),
      payToName: name,
      remark: `Commission statement ${month} — ${name}`,
      idempotencyKey: `commission-statement:${s.id}:${attempt + 1}`,
    },
    { fromSource: true, source: { module: "SALES_COMMISSION_STATEMENT", recordId: s.id } }
  );
  await prisma.$transaction(async (tx) => {
    await tx.salesCommissionStatement.updateMany({ where: { id: s.id, companyId: actor.companyId }, data: { paymentRequestId: pr.id } });
    await audit(tx, actor, s.id, "UPDATE", { paymentRequestId: s.paymentRequestId }, { paymentRequestId: pr.id });
  });
}

// ── Read ─────────────────────────────────────────────────────────

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  PENDING_APPROVAL: "Waiting for approval",
  APPROVED: "Approved — not paid",
  PARTIALLY_PAID: "Partly paid",
  PAID: "Paid",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

export const listStatementsSchema = z.object({
  month: monthSchema.optional().or(z.literal("")),
  status: z.enum(["DRAFT", "PENDING_APPROVAL", "APPROVED"]).optional().or(z.literal("")),
  payeeType: z.enum(["REP", "AGENT"]).optional().or(z.literal("")),
});

export async function listStatements(actor: SalesActor, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_commissions", "view");
  const f = listStatementsSchema.parse(raw ?? {});
  const all = await canViewAll(actor.userId);
  const rows = await prisma.salesCommissionStatement.findMany({
    where: {
      companyId: actor.companyId,
      ...(all ? {} : { userId: actor.userId }),
      ...(f.month ? { periodStart: toDbDate(`${f.month}-01`) } : {}),
      ...(f.status ? { status: f.status } : {}),
      ...(f.payeeType ? { payeeType: f.payeeType } : {}),
    },
    orderBy: [{ periodStart: "desc" }, { createdAt: "asc" }],
    take: 500,
    include: { user: { select: { fullName: true } }, salesAgent: { select: { name: true, code: true } }, paymentRequest: { select: { requestNumber: true, status: true } } },
  });
  return {
    viewAll: all,
    rows: rows
      .map((s) => ({
        id: s.id,
        month: dbDate(s.periodStart).slice(0, 7),
        payeeType: s.payeeType,
        payee: s.user?.fullName ?? (s.salesAgent ? `${s.salesAgent.name} (${s.salesAgent.code})` : "—"),
        status: s.status,
        earned: Number(s.earnedTotal),
        reversals: Number(s.reversalTotal),
        incentives: Number(s.incentiveTotal),
        adjustments: Number(s.adjustmentTotal) + Number(s.carryForwardTotal),
        net: Number(s.netAmount),
        payment: s.paymentRequest ? { number: s.paymentRequest.requestNumber, status: s.paymentRequest.status, label: PAYMENT_STATUS_LABELS[s.paymentRequest.status] } : null,
      }))
      .sort((a, b) => b.month.localeCompare(a.month) || a.payee.localeCompare(b.payee)),
  };
}

export async function getStatement(actor: SalesActor, id: string) {
  const base = await loadVisible(actor, id);
  const s = await prisma.salesCommissionStatement.findUniqueOrThrow({
    where: { id: base.id },
    include: {
      user: { select: { fullName: true } },
      salesAgent: { select: { name: true, code: true } },
      calculatedBy: { select: { fullName: true } },
      submittedBy: { select: { fullName: true } },
      approvedBy: { select: { fullName: true } },
      paymentRequest: { select: { id: true, requestNumber: true, status: true, amount: true, paidAmount: true } },
      lines: { orderBy: [{ kind: "asc" }, { eventDate: "asc" }, { createdAt: "asc" }], include: { createdBy: { select: { fullName: true } } } },
    },
  });
  const [canCreate, canApprovePerm, canReject] = await Promise.all([
    PermissionService.can(actor.userId, "sales_commissions", "create"),
    PermissionService.can(actor.userId, "sales_commissions", "approve"),
    PermissionService.can(actor.userId, "sales_commissions", "reject"),
  ]);
  const pr = s.paymentRequest;
  const month = dbDate(s.periodStart).slice(0, 7);
  return {
    id: s.id,
    month,
    periodStart: dbDate(s.periodStart),
    periodEnd: dbDate(s.periodEnd),
    payeeType: s.payeeType,
    payee: s.user?.fullName ?? (s.salesAgent ? `${s.salesAgent.name} (${s.salesAgent.code})` : "—"),
    status: s.status,
    totals: {
      earned: Number(s.earnedTotal),
      reversals: Number(s.reversalTotal),
      incentives: Number(s.incentiveTotal),
      adjustments: Number(s.adjustmentTotal),
      carryForward: Number(s.carryForwardTotal),
      net: Number(s.netAmount),
    },
    calculatedAt: s.calculatedAt.toISOString(),
    calculatedBy: s.calculatedBy.fullName,
    submittedBy: s.submittedBy?.fullName ?? null,
    approvedBy: s.approvedBy?.fullName ?? null,
    approvedAt: s.approvedAt?.toISOString() ?? null,
    decisionComment: s.decisionComment,
    version: s.version,
    monthOver: s.periodEnd < toDbDate(todayIsoDate()),
    payment: pr ? { id: pr.id, number: pr.requestNumber, status: pr.status, label: PAYMENT_STATUS_LABELS[pr.status], amount: Number(pr.amount), paid: Number(pr.paidAmount) } : null,
    lines: s.lines.map((l) => ({
      id: l.id,
      kind: l.kind,
      eventKey: l.eventKey,
      eventDate: l.eventDate ? dbDate(l.eventDate) : null,
      basis: l.basisAmount === null ? null : Number(l.basisAmount),
      rate: l.rate === null ? null : Number(l.rate),
      amount: Number(l.amount),
      details: l.details as Record<string, unknown>,
      salesInvoiceId: l.salesInvoiceId,
      salesOrderId: l.salesOrderId,
      reason: l.reason,
      createdBy: l.createdBy?.fullName ?? null,
    })),
    can: {
      recalculate: canCreate && s.status === "DRAFT",
      adjust: canCreate && s.status === "DRAFT",
      submit: canCreate && s.status === "DRAFT" && s.periodEnd < toDbDate(todayIsoDate()),
      discard: canCreate && s.status === "DRAFT",
      returnToDraft: canCreate && s.status === "PENDING_APPROVAL",
      approve: canApprovePerm && s.status === "PENDING_APPROVAL" && (await canApproveCommission(actor.userId, [s.calculatedByUserId, s.submittedByUserId])),
      sendBack: canReject && s.status === "PENDING_APPROVAL",
      raisePayment: canApprovePerm && s.status === "APPROVED" && Number(s.netAmount) > 0 && (!pr || pr.status === "REJECTED" || pr.status === "CANCELLED"),
    },
  };
}

/** Months offered by the statements screen: the last 12 up to the current one. */
export function recentMonths(today = todayIsoDate(), count = 12): string[] {
  const [y, m] = today.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    return d.toISOString().slice(0, 7);
  });
}
