import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { descendantsOf, loadManagerMap } from "@/core/hierarchy/team-scope";
import { PermissionService } from "@/core/rbac/PermissionService";
import { todayIsoDate } from "@/lib/date";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { listEligibleOwners } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { bookedOrderWhere, canSeeRep, canSeeTeam, canSeeTerritory, decisionRange, getPerformanceScope, metricTotals, sumKeys, teamMemberIds, type MetricTotal } from "./performance-actuals";
import { dbDate, isoDateSchema, toDbDate } from "./performance-common";
import { attainment, isPeriodStart, periodContaining, periodProgress, type Period } from "./performance-periods";
import { INVOICED_STATUSES, METRIC_KEYS, metricDefinition, type SalesTargetMetricKey, type SalesTargetPeriodTypeKey } from "./performance-registry";

/**
 * Team performance board and drill-down (Phase 05, PHASE_05 §6–§8). Every
 * number comes from performance-actuals.ts; this file only decides which rows
 * the viewer may see and attaches the matching approved targets.
 */

export const boardQuerySchema = z.object({
  metric: z.enum(METRIC_KEYS).optional().or(z.literal("")),
  periodType: z.enum(["MONTH", "QUARTER", "YEAR"]).optional().or(z.literal("")),
  periodStart: isoDateSchema.optional().or(z.literal("")),
});

async function resolvePeriod(companyId: string, periodType: SalesTargetPeriodTypeKey, periodStart: string | undefined): Promise<{ period: Period; fiscalStartMonth: number }> {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { fiscalYearStartMonth: true } });
  if (!company) throw new BusinessRuleError("NOT_FOUND", "Company not found.");
  const fiscalStartMonth = company.fiscalYearStartMonth;
  if (periodStart && !isPeriodStart(periodType, periodStart, fiscalStartMonth)) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Pick a period from the list.", { fieldErrors: { periodStart: "Not the start of a period." } });
  }
  return { period: periodContaining(periodType, periodStart || todayIsoDate(), fiscalStartMonth), fiscalStartMonth };
}

/** Approved target values for one metric + period, keyed "REP:<id>", "TEAM:<id>", "TERRITORY:<id>", "COMPANY". */
async function approvedTargets(companyId: string, metric: SalesTargetMetricKey, period: Period) {
  const rows = await prisma.salesTarget.findMany({
    where: { companyId, metric, periodType: period.type, periodStart: toDbDate(period.start), isArchived: false },
    select: { id: true, scope: true, userId: true, territoryId: true, revisions: { where: { status: "APPROVED" }, select: { targetValue: true } } },
  });
  const map = new Map<string, { id: string; value: number | null }>();
  for (const t of rows) {
    const key = t.scope === "COMPANY" ? "COMPANY" : `${t.scope}:${t.scope === "TERRITORY" ? t.territoryId : t.userId}`;
    map.set(key, { id: t.id, value: t.revisions[0] ? Number(t.revisions[0].targetValue) : null });
  }
  return map;
}

/** Each user with people below them in the CRM tree → that team's login user ids (manager included). */
async function teamsByManager(companyId: string) {
  const [managers, users] = await Promise.all([
    loadManagerMap(companyId, "CRM"),
    prisma.user.findMany({ where: { companyId, employeeId: { not: null } }, select: { id: true, employeeId: true, fullName: true, status: true } }),
  ]);
  const userByEmployee = new Map(users.map((u) => [u.employeeId!, u]));
  const out = new Map<string, { name: string; active: boolean; members: string[] }>();
  for (const u of users) {
    const below = descendantsOf(managers, u.employeeId!)
      .map((e) => userByEmployee.get(e)?.id)
      .filter((v): v is string => Boolean(v));
    if (below.length) out.set(u.id, { name: u.fullName, active: u.status === "ACTIVE", members: [u.id, ...below] });
  }
  return out;
}

function ranked<T extends { actual: number }>(rows: T[]): (T & { rank: number })[] {
  const sorted = [...rows].sort((a, b) => b.actual - a.actual);
  let rank = 0;
  let last: number | null = null;
  return sorted.map((r, i) => {
    if (last === null || r.actual !== last) rank = i + 1;
    last = r.actual;
    return { ...r, rank };
  });
}

export async function getPerformanceBoard(actor: SalesActor, raw: unknown) {
  const q = boardQuerySchema.parse(raw ?? {});
  const metric = (q.metric || "BOOKED_ORDER_VALUE") as SalesTargetMetricKey;
  const { period } = await resolvePeriod(actor.companyId, (q.periodType || "MONTH") as SalesTargetPeriodTypeKey, q.periodStart || undefined);
  const scope = await getPerformanceScope(actor);
  const progress = periodProgress(period.start, period.end, todayIsoDate());
  const def = metricDefinition(metric);

  const [repTotals, territoryTotals, targets, teams, owners, territories] = await Promise.all([
    metricTotals(actor.companyId, metric, period.start, period.end, "REP"),
    metricTotals(actor.companyId, metric, period.start, period.end, "TERRITORY"),
    approvedTargets(actor.companyId, metric, period),
    teamsByManager(actor.companyId),
    listEligibleOwners(actor),
    prisma.salesTerritory.findMany({ where: { companyId: actor.companyId }, select: { id: true, code: true, name: true, isActive: true }, orderBy: { code: "asc" } }),
  ]);

  const row = (actual: MetricTotal, targetKey: string) => {
    const target = targets.get(targetKey);
    return { documents: actual.documents, targetId: target?.id ?? null, ...attainment(target?.value ?? null, actual.value, progress) };
  };

  // Reps: everyone in scope who works in S&M, has credit this period, or has a target.
  const repIds = new Set<string>();
  for (const o of owners) repIds.add(o.id);
  for (const k of repTotals.keys()) if (k) repIds.add(k);
  for (const k of targets.keys()) if (k.startsWith("REP:")) repIds.add(k.slice(4));
  const visibleRepIds = [...repIds].filter((id) => canSeeRep(scope, id));
  const names = new Map((await prisma.user.findMany({ where: { id: { in: visibleRepIds }, companyId: actor.companyId }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  const reps = ranked(
    visibleRepIds.filter((id) => names.has(id)).map((id) => ({ userId: id, name: names.get(id)!, isMe: id === actor.userId, ...row(sumKeys(repTotals, [id]), `REP:${id}`) }))
  );

  const teamRows = ranked(
    [...teams.entries()]
      .filter(([managerId]) => canSeeTeam(scope, managerId))
      .map(([managerId, t]) => ({ managerId, name: `${t.name}'s team`, members: t.members.length, isMine: managerId === actor.userId, ...row(sumKeys(repTotals, t.members), `TEAM:${managerId}`) }))
  );

  const territoryRows = ranked(
    territories
      .filter((t) => canSeeTerritory(scope, t.id) && (t.isActive || territoryTotals.has(t.id) || targets.has(`TERRITORY:${t.id}`)))
      .map((t) => ({ territoryId: t.id, name: `${t.name} (${t.code})`, active: t.isActive, ...row(sumKeys(territoryTotals, [t.id]), `TERRITORY:${t.id}`) }))
  );

  const company = scope.viewAll
    ? {
        ...row(sumKeys(repTotals, repTotals.keys()), "COMPANY"),
        noRep: sumKeys(repTotals, [""]),
        noTerritory: sumKeys(territoryTotals, [""]),
      }
    : null;

  return {
    metric,
    metricLabel: def.label,
    metricDefinition: def.definition,
    dateBasis: def.dateBasis,
    unit: def.unit,
    source: def.source,
    period,
    progress,
    viewAll: scope.viewAll,
    me: reps.find((r) => r.isMe) ?? null,
    reps,
    teams: teamRows,
    territories: territoryRows,
    company,
    calculatedAt: new Date().toISOString(),
  };
}

// ── Drill-down ───────────────────────────────────────────────────

export const drillQuerySchema = boardQuerySchema.extend({
  repId: z.string().uuid().optional().or(z.literal("")),
  teamManagerId: z.string().uuid().optional().or(z.literal("")),
  territoryId: z.string().uuid().optional().or(z.literal("")),
  /** "rep" = orders with no rep, "territory" = no territory, "company" = everything. */
  bucket: z.enum(["rep", "territory", "company"]).optional().or(z.literal("")),
});

const MAX_DOCS = 500;

export interface CreditedDocument {
  id: string;
  kind: "SALES_ORDER" | "QUOTATION" | "SALES_INVOICE";
  number: string;
  date: string;
  customer: string;
  rep: string | null;
  territory: string | null;
  value: number;
  quantity: number | null;
  status: string;
  href: string | null;
}

export async function listCreditedDocuments(actor: SalesActor, raw: unknown) {
  const q = drillQuerySchema.parse(raw ?? {});
  const metric = (q.metric || "BOOKED_ORDER_VALUE") as SalesTargetMetricKey;
  const { period } = await resolvePeriod(actor.companyId, (q.periodType || "MONTH") as SalesTargetPeriodTypeKey, q.periodStart || undefined);
  const scope = await getPerformanceScope(actor);
  const def = metricDefinition(metric);

  // Who: one rep, a team, a territory, or a view_all bucket.
  let repIds: string[] | null = null;
  let territory: string | null | undefined;
  let label: string;
  if (q.repId) {
    if (!canSeeRep(scope, q.repId)) throw new BusinessRuleError("NOT_FOUND", "Nothing to show.");
    repIds = [q.repId];
    label = (await prisma.user.findFirst({ where: { id: q.repId, companyId: actor.companyId }, select: { fullName: true } }))?.fullName ?? "Rep";
  } else if (q.teamManagerId) {
    if (!canSeeTeam(scope, q.teamManagerId)) throw new BusinessRuleError("NOT_FOUND", "Nothing to show.");
    repIds = await teamMemberIds(q.teamManagerId);
    label = `${(await prisma.user.findFirst({ where: { id: q.teamManagerId, companyId: actor.companyId }, select: { fullName: true } }))?.fullName ?? "—"}'s team`;
  } else if (q.territoryId) {
    if (!canSeeTerritory(scope, q.territoryId)) throw new BusinessRuleError("NOT_FOUND", "Nothing to show.");
    territory = q.territoryId;
    const t = await prisma.salesTerritory.findFirst({ where: { id: q.territoryId, companyId: actor.companyId }, select: { name: true } });
    if (!t) throw new BusinessRuleError("NOT_FOUND", "Territory not found.");
    label = t.name;
  } else if (q.bucket) {
    if (!scope.viewAll) throw new BusinessRuleError("PERMISSION_DENIED", "You can't see company-wide figures.");
    if (q.bucket === "rep") {
      repIds = [];
      label = "No sales rep";
    } else if (q.bucket === "territory") {
      territory = null;
      label = "No territory";
    } else label = "Whole company";
  } else {
    repIds = [actor.userId];
    label = "Me";
  }

  const [canOrders, canQuotations, canInvoices] = await Promise.all([
    PermissionService.can(actor.userId, "sales_orders", "view"),
    PermissionService.can(actor.userId, "sales_quotations", "view"),
    PermissionService.can(actor.userId, "invoices", "view"),
  ]);
  const allowed = def.source === "SALES_ORDER" ? canOrders : def.source === "QUOTATION" ? canQuotations : canOrders || canInvoices;
  if (!allowed) return { label, metric, metricLabel: def.label, unit: def.unit, period, documents: null, truncated: false, reason: "You don't have access to the documents behind this figure." };

  let documents: CreditedDocument[];
  if (def.source === "SALES_ORDER") {
    const where: Prisma.SalesOrderWhereInput = {
      companyId: actor.companyId,
      orderDate: { gte: toDbDate(period.start), lte: toDbDate(period.end) },
      ...bookedOrderWhere,
      ...(repIds ? (repIds.length ? { salesRepUserId: { in: repIds } } : { salesRepUserId: null }) : {}),
      ...(territory !== undefined ? { salesTerritoryId: territory } : {}),
    };
    const rows = await prisma.salesOrder.findMany({
      where,
      orderBy: [{ orderDate: "asc" }, { orderNumber: "asc" }],
      take: MAX_DOCS + 1,
      select: {
        id: true,
        orderNumber: true,
        orderDate: true,
        status: true,
        baseTotalAmount: true,
        customer: { select: { name: true } },
        salesRep: { select: { fullName: true } },
        salesTerritory: { select: { name: true } },
        items: { select: { breakdown: { select: { orderedQuantity: true } } } },
      },
    });
    documents = rows.map((o) => ({
      id: o.id,
      kind: "SALES_ORDER",
      number: o.orderNumber,
      date: dbDate(o.orderDate),
      customer: o.customer.name,
      rep: o.salesRep?.fullName ?? null,
      territory: o.salesTerritory?.name ?? null,
      value: Number(o.baseTotalAmount),
      quantity: o.items.reduce((s, i) => s + i.breakdown.reduce((t, b) => t + b.orderedQuantity, 0), 0),
      status: o.status,
      href: `/sales-orders/${o.id}`,
    }));
  } else if (def.source === "QUOTATION") {
    const where: Prisma.QuotationRevisionWhereInput = {
      companyId: actor.companyId,
      status: "ACCEPTED",
      customerDecisionAt: decisionRange(period.start, period.end),
      quotation: {
        ...(repIds ? (repIds.length ? { OR: [{ ownerUserId: { in: repIds } }, { ownerUserId: null, createdByUserId: { in: repIds } }] } : { id: "00000000-0000-0000-0000-000000000000" }) : {}),
        ...(territory !== undefined ? (territory === null ? { OR: [{ customerId: null }, { customer: { salesTerritoryId: null } }] } : { customer: { salesTerritoryId: territory } }) : {}),
      },
    };
    const rows = await prisma.quotationRevision.findMany({
      where,
      orderBy: { customerDecisionAt: "asc" },
      take: MAX_DOCS + 1,
      select: {
        id: true,
        revisionNumber: true,
        customerDecisionAt: true,
        taxableTotal: true,
        status: true,
        quotation: {
          select: {
            id: true,
            quotationNumber: true,
            prospectName: true,
            customer: { select: { name: true, salesTerritory: { select: { name: true } } } },
            owner: { select: { fullName: true } },
            createdBy: { select: { fullName: true } },
          },
        },
      },
    });
    documents = rows.map((r) => ({
      id: r.id,
      kind: "QUOTATION",
      number: `${r.quotation.quotationNumber} rev ${r.revisionNumber}`,
      date: r.customerDecisionAt ? r.customerDecisionAt.toISOString().slice(0, 10) : "",
      customer: r.quotation.customer?.name ?? r.quotation.prospectName ?? "—",
      rep: r.quotation.owner?.fullName ?? r.quotation.createdBy.fullName,
      territory: r.quotation.customer?.salesTerritory?.name ?? null,
      value: metric === "ACCEPTED_QUOTATION_COUNT" ? 1 : Number(r.taxableTotal),
      quantity: null,
      status: r.status,
      href: `/sales-marketing/quotations/${r.quotation.id}`,
    }));
  } else {
    const where: Prisma.SalesInvoiceWhereInput = {
      companyId: actor.companyId,
      status: { in: [...INVOICED_STATUSES] },
      invoiceDate: { gte: toDbDate(period.start), lte: toDbDate(period.end) },
      salesOrder: {
        ...(repIds ? (repIds.length ? { salesRepUserId: { in: repIds } } : { salesRepUserId: null }) : {}),
        ...(territory !== undefined ? { salesTerritoryId: territory } : {}),
      },
    };
    const rows = await prisma.salesInvoice.findMany({
      where,
      orderBy: [{ invoiceDate: "asc" }, { invoiceNumber: "asc" }],
      take: MAX_DOCS + 1,
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        status: true,
        subtotalAmount: true,
        exchangeRate: true,
        customer: { select: { name: true } },
        salesOrder: { select: { salesRep: { select: { fullName: true } }, salesTerritory: { select: { name: true } } } },
      },
    });
    documents = rows.map((i) => ({
      id: i.id,
      kind: "SALES_INVOICE",
      number: i.invoiceNumber,
      date: dbDate(i.invoiceDate),
      customer: i.customer.name,
      rep: i.salesOrder.salesRep?.fullName ?? null,
      territory: i.salesOrder.salesTerritory?.name ?? null,
      value: Math.round(Number(i.subtotalAmount) * Number(i.exchangeRate) * 100) / 100,
      quantity: null,
      status: i.status,
      href: canInvoices ? `/accounts/sales-invoices/${i.id}` : null,
    }));
  }
  if (metric === "BOOKED_ORDER_COUNT") documents = documents.map((d) => ({ ...d, value: 1 }));
  if (metric === "BOOKED_QUANTITY") documents = documents.map((d) => ({ ...d, value: d.quantity ?? 0 }));
  const truncated = documents.length > MAX_DOCS;
  documents = documents.slice(0, MAX_DOCS);
  return { label, metric, metricLabel: def.label, unit: def.unit, period, documents, truncated, reason: null };
}
