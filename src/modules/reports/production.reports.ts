import { prisma } from "@/core/db/client";
import type { ReportDescriptor } from "@/core/reports/report-types";
import { registerReport } from "./registry";
import { parseReportDateRange } from "./report-date-range";

const CATEGORY = "production" as const;

function filtersApplied(filters: Record<string, string>, labels: Record<string, string>) {
  return Object.entries(filters)
    .filter(([, v]) => v)
    .map(([k, v]) => ({ label: labels[k] ?? k, value: v }));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// 1. Production Register — one row per JobOrder. No dedicated business date
// exists on JobOrder itself, so this filters on JobOrder.createdAt.
// ---------------------------------------------------------------------------
async function getProductionRegisterDescriptor(
  companyId: string,
  generatedByName: string,
  filters: Record<string, string>
): Promise<ReportDescriptor> {
  const { dateFrom, dateToExclusive } = parseReportDateRange(filters);
  const jobOrders = await prisma.jobOrder.findMany({
    where: {
      companyId,
      ...(dateFrom || dateToExclusive ? { createdAt: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateToExclusive ? { lt: dateToExclusive } : {}) } } : {}),
    },
    select: {
      jobNumber: true,
      plannedQuantity: true,
      completedQuantity: true,
      rejectedQuantity: true,
      damagedQuantity: true,
      status: true,
      productionOrderId: true,
      productionOrder: { select: { orderNumber: true, product: { select: { styleName: true } } } },
      productionStage: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const rows = jobOrders.map((jo) => ({
    productionOrderId: jo.productionOrderId,
    jobNumber: jo.jobNumber,
    orderNumber: jo.productionOrder.orderNumber,
    style: jo.productionOrder.product.styleName,
    stage: jo.productionStage.name,
    plannedQty: Number(jo.plannedQuantity),
    completedQty: Number(jo.completedQuantity),
    rejectedQty: Number(jo.rejectedQuantity),
    damagedQty: Number(jo.damagedQuantity),
    status: jo.status,
  }));

  return {
    title: "Production Register",
    subtitle: "Every Job Order matching the selected filters.",
    filtersApplied: filtersApplied(filters, { dateFrom: "Date From", dateTo: "Date To" }),
    columns: [
      { key: "jobNumber", label: "Job Number" },
      { key: "orderNumber", label: "Production Order Number", linkTo: "productionOrder" },
      { key: "style", label: "Style" },
      { key: "stage", label: "Stage" },
      { key: "plannedQty", label: "Planned Qty", type: "number", align: "right" },
      { key: "completedQty", label: "Completed Qty", type: "number", align: "right" },
      { key: "rejectedQty", label: "Rejected Qty", type: "number", align: "right" },
      { key: "damagedQty", label: "Damaged Qty", type: "number", align: "right" },
      { key: "status", label: "Status" },
    ],
    rows,
    totals: {
      plannedQty: rows.reduce((s, r) => s + r.plannedQty, 0),
      completedQty: rows.reduce((s, r) => s + r.completedQty, 0),
      rejectedQty: rows.reduce((s, r) => s + r.rejectedQty, 0),
      damagedQty: rows.reduce((s, r) => s + r.damagedQty, 0),
    },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ---------------------------------------------------------------------------
// Shared aggregate — every JobOrder grouped by its parent ProductionOrder.
// Reused by Order-wise Production, Production Achievement %, and Production
// Rejection % so all three reports agree on the exact same underlying sums.
// ---------------------------------------------------------------------------
interface ProductionOrderAggregate {
  productionOrderId: string;
  orderNumber: string;
  style: string;
  totalPlanned: number;
  totalCompleted: number;
  totalRejected: number;
  totalDamaged: number;
}

async function fetchProductionOrderAggregates(companyId: string): Promise<ProductionOrderAggregate[]> {
  const jobOrders = await prisma.jobOrder.findMany({
    where: { companyId },
    select: {
      productionOrderId: true,
      plannedQuantity: true,
      completedQuantity: true,
      rejectedQuantity: true,
      damagedQuantity: true,
      productionOrder: { select: { orderNumber: true, product: { select: { styleName: true } } } },
    },
  });

  const byOrder = new Map<string, ProductionOrderAggregate>();
  for (const jo of jobOrders) {
    const existing: ProductionOrderAggregate = byOrder.get(jo.productionOrderId) ?? {
      productionOrderId: jo.productionOrderId,
      orderNumber: jo.productionOrder.orderNumber,
      style: jo.productionOrder.product.styleName,
      totalPlanned: 0,
      totalCompleted: 0,
      totalRejected: 0,
      totalDamaged: 0,
    };
    existing.totalPlanned += Number(jo.plannedQuantity);
    existing.totalCompleted += Number(jo.completedQuantity);
    existing.totalRejected += Number(jo.rejectedQuantity);
    existing.totalDamaged += Number(jo.damagedQuantity);
    byOrder.set(jo.productionOrderId, existing);
  }

  return [...byOrder.values()];
}

// ---------------------------------------------------------------------------
// 2. Order-wise Production — JobOrder quantities aggregated per Production
// Order (every Job Order, regardless of stage/status).
// ---------------------------------------------------------------------------
async function getOrderWiseProductionDescriptor(companyId: string, generatedByName: string): Promise<ReportDescriptor> {
  const aggregates = await fetchProductionOrderAggregates(companyId);
  const rows = aggregates.sort((a, b) => a.orderNumber.localeCompare(b.orderNumber));

  return {
    title: "Order-wise Production",
    subtitle: "Job Order quantities aggregated per Production Order.",
    filtersApplied: [],
    columns: [
      { key: "orderNumber", label: "Production Order Number", linkTo: "productionOrder" },
      { key: "style", label: "Style" },
      { key: "totalPlanned", label: "Total Planned", type: "number", align: "right" },
      { key: "totalCompleted", label: "Total Completed", type: "number", align: "right" },
      { key: "totalRejected", label: "Total Rejected", type: "number", align: "right" },
      { key: "totalDamaged", label: "Total Damaged", type: "number", align: "right" },
    ],
    rows: rows as unknown as Record<string, unknown>[],
    totals: {
      totalPlanned: rows.reduce((s, r) => s + r.totalPlanned, 0),
      totalCompleted: rows.reduce((s, r) => s + r.totalCompleted, 0),
      totalRejected: rows.reduce((s, r) => s + r.totalRejected, 0),
      totalDamaged: rows.reduce((s, r) => s + r.totalDamaged, 0),
    },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ---------------------------------------------------------------------------
// 3. Production Pending — Job Orders still carrying unaccounted-for planned
// quantity (planned - completed - rejected - damaged > 0), excluding
// cancelled Job Orders.
// ---------------------------------------------------------------------------
async function getProductionPendingDescriptor(companyId: string, generatedByName: string): Promise<ReportDescriptor> {
  const jobOrders = await prisma.jobOrder.findMany({
    where: { companyId, status: { not: "CANCELLED" } },
    select: {
      jobNumber: true,
      plannedQuantity: true,
      completedQuantity: true,
      rejectedQuantity: true,
      damagedQuantity: true,
      status: true,
      productionOrderId: true,
      productionOrder: { select: { orderNumber: true, product: { select: { styleName: true } } } },
      productionStage: { select: { name: true } },
    },
  });

  const rows = jobOrders
    .map((jo) => {
      const planned = Number(jo.plannedQuantity);
      const completed = Number(jo.completedQuantity);
      const rejected = Number(jo.rejectedQuantity);
      const damaged = Number(jo.damagedQuantity);
      const pendingQty = planned - completed - rejected - damaged;
      return {
        productionOrderId: jo.productionOrderId,
        jobNumber: jo.jobNumber,
        orderNumber: jo.productionOrder.orderNumber,
        style: jo.productionOrder.product.styleName,
        stage: jo.productionStage.name,
        plannedQty: planned,
        completedQty: completed,
        pendingQty,
        status: jo.status,
      };
    })
    .filter((r) => r.pendingQty > 0.0001)
    .sort((a, b) => b.pendingQty - a.pendingQty);

  return {
    title: "Production Pending",
    subtitle: "Job Orders still carrying unaccounted-for planned quantity.",
    filtersApplied: [],
    columns: [
      { key: "jobNumber", label: "Job Number" },
      { key: "orderNumber", label: "Production Order Number", linkTo: "productionOrder" },
      { key: "style", label: "Style" },
      { key: "stage", label: "Stage" },
      { key: "plannedQty", label: "Planned Qty", type: "number", align: "right" },
      { key: "completedQty", label: "Completed Qty", type: "number", align: "right" },
      { key: "pendingQty", label: "Pending Qty", type: "number", align: "right" },
      { key: "status", label: "Status" },
    ],
    rows,
    totals: { pendingQty: rows.reduce((s, r) => s + r.pendingQty, 0) },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ---------------------------------------------------------------------------
// 4. Production Achievement % — per Production Order, sum(completed)/
// sum(planned)*100. Sorted worst-first (ascending) since that's the
// actionable ordering. Overall total is the correct weighted average
// (sum of completed / sum of planned across everything), never an average
// of the per-row percentages.
// ---------------------------------------------------------------------------
async function getProductionAchievementDescriptor(companyId: string, generatedByName: string): Promise<ReportDescriptor> {
  const aggregates = await fetchProductionOrderAggregates(companyId);

  const rows = aggregates
    .map((a) => ({
      productionOrderId: a.productionOrderId,
      orderNumber: a.orderNumber,
      style: a.style,
      totalPlanned: a.totalPlanned,
      totalCompleted: a.totalCompleted,
      achievementPercent: a.totalPlanned > 0 ? round2((a.totalCompleted / a.totalPlanned) * 100) : 0,
    }))
    .sort((a, b) => a.achievementPercent - b.achievementPercent);

  const sumPlanned = aggregates.reduce((s, a) => s + a.totalPlanned, 0);
  const sumCompleted = aggregates.reduce((s, a) => s + a.totalCompleted, 0);
  const overallAchievementPercent = sumPlanned > 0 ? round2((sumCompleted / sumPlanned) * 100) : 0;

  return {
    title: "Production Achievement %",
    subtitle: "Per Production Order: completed quantity as a percentage of planned quantity.",
    filtersApplied: [],
    columns: [
      { key: "orderNumber", label: "Production Order Number", linkTo: "productionOrder" },
      { key: "style", label: "Style" },
      { key: "totalPlanned", label: "Total Planned", type: "number", align: "right" },
      { key: "totalCompleted", label: "Total Completed", type: "number", align: "right" },
      { key: "achievementPercent", label: "Achievement %", type: "percent", align: "right" },
    ],
    rows,
    totals: {
      totalPlanned: sumPlanned,
      totalCompleted: sumCompleted,
      achievementPercent: overallAchievementPercent,
    },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ---------------------------------------------------------------------------
// 5. Production Rejection % — per Production Order, rejected as a percentage
// of what was actually produced (completed + rejected + damaged). Sorted
// worst-first (descending). Overall total is the correct weighted rejection
// rate across everything, never an average of per-row percentages.
// ---------------------------------------------------------------------------
async function getProductionRejectionDescriptor(companyId: string, generatedByName: string): Promise<ReportDescriptor> {
  const aggregates = await fetchProductionOrderAggregates(companyId);

  const rows = aggregates
    .map((a) => {
      const totalProduced = a.totalCompleted + a.totalRejected + a.totalDamaged;
      return {
        productionOrderId: a.productionOrderId,
        orderNumber: a.orderNumber,
        style: a.style,
        totalProduced,
        totalRejected: a.totalRejected,
        rejectionPercent: totalProduced > 0 ? round2((a.totalRejected / totalProduced) * 100) : 0,
      };
    })
    .sort((a, b) => b.rejectionPercent - a.rejectionPercent);

  const sumProduced = aggregates.reduce((s, a) => s + a.totalCompleted + a.totalRejected + a.totalDamaged, 0);
  const sumRejected = aggregates.reduce((s, a) => s + a.totalRejected, 0);
  const overallRejectionPercent = sumProduced > 0 ? round2((sumRejected / sumProduced) * 100) : 0;

  return {
    title: "Production Rejection %",
    subtitle: "Per Production Order: rejected quantity as a percentage of total produced quantity (completed + rejected + damaged).",
    filtersApplied: [],
    columns: [
      { key: "orderNumber", label: "Production Order Number", linkTo: "productionOrder" },
      { key: "style", label: "Style" },
      { key: "totalProduced", label: "Total Produced", type: "number", align: "right" },
      { key: "totalRejected", label: "Total Rejected", type: "number", align: "right" },
      { key: "rejectionPercent", label: "Rejection %", type: "percent", align: "right" },
    ],
    rows,
    totals: {
      totalProduced: sumProduced,
      totalRejected: sumRejected,
      rejectionPercent: overallRejectionPercent,
    },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ---------------------------------------------------------------------------
// 6. Line-wise Production — JobOrder quantities aggregated by
// ProductionLine (nullable — job orders with no line assigned are grouped
// under "Unassigned" rather than dropped).
// ---------------------------------------------------------------------------
async function getLineWiseProductionDescriptor(companyId: string, generatedByName: string): Promise<ReportDescriptor> {
  const jobOrders = await prisma.jobOrder.findMany({
    where: { companyId },
    select: {
      plannedQuantity: true,
      completedQuantity: true,
      rejectedQuantity: true,
      damagedQuantity: true,
      productionLine: { select: { name: true } },
    },
  });

  interface LineAgg {
    line: string;
    totalPlanned: number;
    totalCompleted: number;
    totalRejected: number;
    totalDamaged: number;
  }
  const byLine = new Map<string, LineAgg>();
  for (const jo of jobOrders) {
    const line = jo.productionLine?.name ?? "Unassigned";
    const existing = byLine.get(line) ?? { line, totalPlanned: 0, totalCompleted: 0, totalRejected: 0, totalDamaged: 0 };
    existing.totalPlanned += Number(jo.plannedQuantity);
    existing.totalCompleted += Number(jo.completedQuantity);
    existing.totalRejected += Number(jo.rejectedQuantity);
    existing.totalDamaged += Number(jo.damagedQuantity);
    byLine.set(line, existing);
  }

  const rows = [...byLine.values()].sort((a, b) => b.totalCompleted - a.totalCompleted);

  return {
    title: "Line-wise Production",
    subtitle: "Job Order quantities aggregated by Production Line.",
    filtersApplied: [],
    columns: [
      { key: "line", label: "Production Line" },
      { key: "totalPlanned", label: "Total Planned", type: "number", align: "right" },
      { key: "totalCompleted", label: "Total Completed", type: "number", align: "right" },
      { key: "totalRejected", label: "Total Rejected", type: "number", align: "right" },
      { key: "totalDamaged", label: "Total Damaged", type: "number", align: "right" },
    ],
    rows: rows as unknown as Record<string, unknown>[],
    totals: {
      totalPlanned: rows.reduce((s, r) => s + r.totalPlanned, 0),
      totalCompleted: rows.reduce((s, r) => s + r.totalCompleted, 0),
      totalRejected: rows.reduce((s, r) => s + r.totalRejected, 0),
      totalDamaged: rows.reduce((s, r) => s + r.totalDamaged, 0),
    },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ---------------------------------------------------------------------------
// 7. Operator-wise Production — JobOrderProgressEntry quantities aggregated
// by Employee (the real "who did the work" record — see JobOrderProgressEntry's
// own schema comment; adjustment entries with no employeeId are grouped under
// "Adjustment / Unattributed" rather than dropped).
// ---------------------------------------------------------------------------
async function getOperatorWiseProductionDescriptor(
  companyId: string,
  generatedByName: string,
  filters: Record<string, string>
): Promise<ReportDescriptor> {
  const { dateFrom, dateToExclusive } = parseReportDateRange(filters);
  const entries = await prisma.jobOrderProgressEntry.findMany({
    where: {
      jobOrder: { companyId },
      ...(dateFrom || dateToExclusive
        ? { createdAt: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateToExclusive ? { lt: dateToExclusive } : {}) } }
        : {}),
    },
    select: {
      completedQuantity: true,
      rejectedQuantity: true,
      damagedQuantity: true,
      employee: { select: { employeeCode: true, fullName: true } },
    },
  });

  interface OperatorAgg {
    employeeCode: string;
    fullName: string;
    totalCompleted: number;
    totalRejected: number;
    totalDamaged: number;
  }
  const byOperator = new Map<string, OperatorAgg>();
  for (const e of entries) {
    const key = e.employee ? e.employee.employeeCode : "UNATTRIBUTED";
    const existing = byOperator.get(key) ?? {
      employeeCode: e.employee?.employeeCode ?? "—",
      fullName: e.employee?.fullName ?? "Adjustment / Unattributed",
      totalCompleted: 0,
      totalRejected: 0,
      totalDamaged: 0,
    };
    existing.totalCompleted += Number(e.completedQuantity);
    existing.totalRejected += Number(e.rejectedQuantity);
    existing.totalDamaged += Number(e.damagedQuantity);
    byOperator.set(key, existing);
  }

  const rows = [...byOperator.values()].sort((a, b) => b.totalCompleted - a.totalCompleted);

  return {
    title: "Operator-wise Production",
    // Totals reflect only LOGGED progress entries, not the same source as
    // Production Register/Achievement — quantity that arrives at a
    // downstream job order via Forward or a QC accept never gets its own
    // JobOrderProgressEntry row, so this report's totals are legitimately
    // lower than Production Register's. Called out explicitly so a user
    // comparing the two doesn't mistake the gap for a bug (Phase 10 QA pass).
    subtitle:
      "Job Order progress entries aggregated by the Employee who performed the work. Totals reflect only logged progress entries and will be lower than Production Register/Achievement, which also count quantity forwarded from upstream stages.",
    filtersApplied: filtersApplied(filters, { dateFrom: "Date From", dateTo: "Date To" }),
    columns: [
      { key: "employeeCode", label: "Employee Code" },
      { key: "fullName", label: "Full Name" },
      { key: "totalCompleted", label: "Total Completed", type: "number", align: "right" },
      { key: "totalRejected", label: "Total Rejected", type: "number", align: "right" },
      { key: "totalDamaged", label: "Total Damaged", type: "number", align: "right" },
    ],
    rows: rows as unknown as Record<string, unknown>[],
    totals: {
      totalCompleted: rows.reduce((s, r) => s + r.totalCompleted, 0),
      totalRejected: rows.reduce((s, r) => s + r.totalRejected, 0),
      totalDamaged: rows.reduce((s, r) => s + r.totalDamaged, 0),
    },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ---------------------------------------------------------------------------
// 8. Worker Output Register — the daily/weekly/monthly per-worker visibility
// requested for the self-entry feature (2026-09-02): every logged
// JobOrderProgressEntry (supervisor-direct and worker-self-submitted alike)
// bucketed by calendar period and Employee, plus how many of that worker's
// self-submitted entries in the period are still Pending/Approved/Rejected —
// so a manager sees both real output AND how much is still awaiting review.
// Period boundaries use UTC calendar components throughout (never a local
// `new Date(y,m,d)` constructor) — this project's own hard-won lesson from
// the Phase 9 QA sweep, where a local-timezone boundary on this IST server
// silently pulled in the wrong UTC calendar day.
// ---------------------------------------------------------------------------
type OutputPeriod = "day" | "week" | "month";

function periodKeyFor(date: Date, period: OutputPeriod): string {
  if (period === "month") {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  if (period === "week") {
    const utcMidnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    const dayOfWeek = new Date(utcMidnight).getUTCDay(); // 0=Sun..6=Sat
    const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    return new Date(utcMidnight - diffToMonday * 86_400_000).toISOString().slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

async function getWorkerOutputRegisterDescriptor(
  companyId: string,
  generatedByName: string,
  filters: Record<string, string>
): Promise<ReportDescriptor> {
  const { dateFrom, dateToExclusive } = parseReportDateRange(filters);
  const period: OutputPeriod = filters.period === "week" || filters.period === "month" ? filters.period : "day";
  const employeeId = filters.employeeId || undefined;

  const entries = await prisma.jobOrderProgressEntry.findMany({
    where: {
      jobOrder: { companyId },
      ...(employeeId ? { employeeId } : {}),
      ...(dateFrom || dateToExclusive
        ? { createdAt: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateToExclusive ? { lt: dateToExclusive } : {}) } }
        : {}),
    },
    select: {
      createdAt: true,
      completedQuantity: true,
      rejectedQuantity: true,
      damagedQuantity: true,
      approvalStatus: true,
      employee: { select: { employeeCode: true, fullName: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  interface WorkerOutputAgg {
    period: string;
    employeeCode: string;
    fullName: string;
    completedQty: number;
    rejectedQty: number;
    damagedQty: number;
    pendingCount: number;
    approvedCount: number;
    rejectedCount: number;
  }
  const byKey = new Map<string, WorkerOutputAgg>();
  for (const e of entries) {
    const periodLabel = periodKeyFor(e.createdAt, period);
    const employeeCode = e.employee?.employeeCode ?? "—";
    const key = `${periodLabel}|${employeeCode}`;
    const existing = byKey.get(key) ?? {
      period: periodLabel,
      employeeCode,
      fullName: e.employee?.fullName ?? "Adjustment / Unattributed",
      completedQty: 0,
      rejectedQty: 0,
      damagedQty: 0,
      pendingCount: 0,
      approvedCount: 0,
      rejectedCount: 0,
    };
    // A PENDING or REJECTED self-entry never touched the real JobOrder
    // quantities (see submitSelfProgressEntry/rejectProgressEntry in
    // job-order.service.ts) — only NOT_REQUIRED (supervisor-direct, always
    // real) and APPROVED (a self-entry that became real) ever did. Counting
    // a still-undecided or discarded claim's quantity here would make this
    // report's own "Completed" total disagree with the JobOrder's real,
    // already-verified figure — caught live: a 20-unit rejected entry was
    // inflating a worker's daily total from a real 35 to a wrong 55.
    if (e.approvalStatus === "NOT_REQUIRED" || e.approvalStatus === "APPROVED") {
      existing.completedQty += Number(e.completedQuantity);
      existing.rejectedQty += Number(e.rejectedQuantity);
      existing.damagedQty += Number(e.damagedQuantity);
    }
    // NOT_REQUIRED (the existing supervisor-direct path) contributes to the
    // quantity totals above but to none of these three submission-status
    // counts — only a SELF-entered row is ever PENDING/APPROVED/REJECTED.
    if (e.approvalStatus === "PENDING") existing.pendingCount += 1;
    else if (e.approvalStatus === "APPROVED") existing.approvedCount += 1;
    else if (e.approvalStatus === "REJECTED") existing.rejectedCount += 1;
    byKey.set(key, existing);
  }

  const rows = [...byKey.values()].sort((a, b) => (a.period === b.period ? a.fullName.localeCompare(b.fullName) : a.period.localeCompare(b.period)));

  return {
    title: "Worker Output Register",
    subtitle:
      "Per-worker output by day, week, or month — completed/rejected/damaged quantity from every entry that actually counted toward the job order (supervisor-direct entries, and self-submitted entries once Approved), plus how many self-submitted entries in that period are still Pending, Approved, or Rejected. A Pending or Rejected self-entry's quantity is excluded from the totals until (and unless) it's approved.",
    filtersApplied: filtersApplied(filters, {
      dateFrom: "Date From",
      dateTo: "Date To",
      period: "Period",
      employeeId: "Employee",
    }),
    columns: [
      { key: "period", label: period === "day" ? "Date" : period === "week" ? "Week Of" : "Month" },
      { key: "employeeCode", label: "Employee Code" },
      { key: "fullName", label: "Employee Name" },
      { key: "completedQty", label: "Completed", type: "number", align: "right" },
      { key: "rejectedQty", label: "Rejected", type: "number", align: "right" },
      { key: "damagedQty", label: "Damaged", type: "number", align: "right" },
      { key: "pendingCount", label: "Pending Entries", type: "number", align: "right" },
      { key: "approvedCount", label: "Approved Entries", type: "number", align: "right" },
      { key: "rejectedCount", label: "Rejected Entries", type: "number", align: "right" },
    ],
    rows: rows as unknown as Record<string, unknown>[],
    totals: {
      completedQty: round2(rows.reduce((s, r) => s + r.completedQty, 0)),
      rejectedQty: round2(rows.reduce((s, r) => s + r.rejectedQty, 0)),
      damagedQty: round2(rows.reduce((s, r) => s + r.damagedQty, 0)),
      pendingCount: rows.reduce((s, r) => s + r.pendingCount, 0),
      approvedCount: rows.reduce((s, r) => s + r.approvedCount, 0),
      rejectedCount: rows.reduce((s, r) => s + r.rejectedCount, 0),
    },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

registerReport({ category: CATEGORY, key: "production-register", title: "Production Register", buildDescriptor: getProductionRegisterDescriptor });
registerReport({ category: CATEGORY, key: "order-wise-production", title: "Order-wise Production", buildDescriptor: getOrderWiseProductionDescriptor });
registerReport({ category: CATEGORY, key: "production-pending", title: "Production Pending", buildDescriptor: getProductionPendingDescriptor });
registerReport({
  category: CATEGORY,
  key: "production-achievement",
  title: "Production Achievement %",
  buildDescriptor: getProductionAchievementDescriptor,
});
registerReport({ category: CATEGORY, key: "production-rejection", title: "Production Rejection %", buildDescriptor: getProductionRejectionDescriptor });
registerReport({
  category: CATEGORY,
  key: "line-wise-production",
  title: "Line-wise Production",
  buildDescriptor: (c, g) => getLineWiseProductionDescriptor(c, g),
});
registerReport({
  category: CATEGORY,
  key: "operator-wise-production",
  title: "Operator-wise Production",
  buildDescriptor: getOperatorWiseProductionDescriptor,
});
registerReport({
  category: CATEGORY,
  key: "worker-output-register",
  title: "Worker Output Register",
  buildDescriptor: getWorkerOutputRegisterDescriptor,
});
