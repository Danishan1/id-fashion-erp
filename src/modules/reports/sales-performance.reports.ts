import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import type { ReportDescriptor } from "@/core/reports/report-types";
import { round2 } from "@/lib/money";
import { bookedOrderWhere, canSeeRep, canSeeTerritory, getPerformanceScope } from "@/modules/sales-marketing/performance/performance-actuals";
import { dbDate, toDbDate } from "@/modules/sales-marketing/performance/performance-common";
import { CREDIT_SOURCE_LABELS, METRIC_KEYS, REVISION_STATUS_LABELS, SCOPE_LABELS, type SalesTargetScopeKey } from "@/modules/sales-marketing/performance/performance-registry";
import { listTargets } from "@/modules/sales-marketing/performance/target.service";
import { registerReport, type ReportViewer } from "./registry";

/**
 * Sales performance reports (Sales & Marketing Phase 05, 2026-11-03), in the
 * Sales & Marketing Report Center category. Both need sales_performance.view
 * on top of the category's own permissions, and show only what the viewer may
 * see on the performance board (own, team, assigned territories; everything
 * with view_all). Figures come from the same metric service as the screens.
 */

const CATEGORY = "sales-marketing" as const;
const PACE_LABELS = { AHEAD: "On pace", BEHIND: "Behind pace", MET: "Met", MISSED: "Missed" } as const;
const MAX_ROWS = 5000;
const actorOf = (companyId: string, viewer: ReportViewer) => ({ companyId, userId: viewer.userId, branchId: null });
const isoOrUndefined = (v: string | undefined, field: string) => {
  if (!v) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new BusinessRuleError("VALIDATION_ERROR", `"${v}" is not a valid date.`, { field });
  return v;
};
const uuid = (v: string | undefined, field: string) => {
  if (!v) return undefined;
  if (!/^[0-9a-f-]{36}$/i.test(v)) throw new BusinessRuleError("VALIDATION_ERROR", `"${v}" is not a valid ${field}.`, { field });
  return v;
};
function applied(filters: Record<string, string>, labels: Record<string, string>) {
  return Object.entries(filters)
    .filter(([k, v]) => v && labels[k])
    .map(([k, v]) => ({ label: labels[k], value: v }));
}

// ── 1. Target attainment ─────────────────────────────────────────

async function getTargetAttainmentDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>, viewer: ReportViewer): Promise<ReportDescriptor> {
  await PermissionService.assert(viewer.userId, "sales_performance", "view");
  if (filters.metric && !(METRIC_KEYS as string[]).includes(filters.metric)) throw new BusinessRuleError("VALIDATION_ERROR", `"${filters.metric}" is not a valid metric.`, { field: "metric" });
  if (filters.scope && !["REP", "TEAM", "TERRITORY", "COMPANY"].includes(filters.scope)) throw new BusinessRuleError("VALIDATION_ERROR", `"${filters.scope}" is not a valid scope.`, { field: "scope" });
  const from = isoOrUndefined(filters.dateFrom, "dateFrom");
  const to = isoOrUndefined(filters.dateTo, "dateTo");
  const { data, truncated } = await listTargets(actorOf(companyId, viewer), { metric: filters.metric ?? "", scope: filters.scope ?? "", status: filters.status || "live" });
  const rows = data
    .filter((t) => (!from || t.periodStart >= from) && (!to || t.periodStart <= to))
    .map((t) => ({
      targetId: t.id,
      subject: t.subject,
      scope: SCOPE_LABELS[t.scope as SalesTargetScopeKey],
      metric: t.metricLabel,
      unit: t.unit === "CURRENCY" ? "₹" : t.unit === "PIECES" ? "pcs" : "count",
      period: t.periodLabel,
      periodStart: t.periodStart,
      periodEnd: t.periodEnd,
      target: t.target,
      actual: t.actual,
      gap: t.gap,
      attainment: t.percent,
      pace: t.pace ? PACE_LABELS[t.pace] : "—",
      status: t.archived ? "Archived" : REVISION_STATUS_LABELS[t.status],
    }));
  return {
    title: "Target Attainment",
    subtitle:
      "Sales targets you can see (by period start) with the approved target and the actual calculated live — the same figures as Team Performance. Targets and actuals mix units across metrics, so no grand total is shown." +
      (truncated ? " Only the first 500 targets are included." : ""),
    filtersApplied: applied(filters, { dateFrom: "Period from", dateTo: "Period to", metric: "Metric", scope: "Scope", status: "Status" }),
    columns: [
      { key: "subject", label: "For", linkTo: "target" },
      { key: "scope", label: "Scope" },
      { key: "metric", label: "Metric" },
      { key: "unit", label: "Unit" },
      { key: "period", label: "Period" },
      { key: "periodStart", label: "From", type: "date" },
      { key: "periodEnd", label: "To", type: "date" },
      { key: "target", label: "Approved target", type: "number", align: "right" },
      { key: "actual", label: "Actual", type: "number", align: "right" },
      { key: "gap", label: "Gap", type: "number", align: "right" },
      { key: "attainment", label: "Attainment %", type: "percent", align: "right" },
      { key: "pace", label: "Pace" },
      { key: "status", label: "Status" },
    ],
    rows,
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ── 2. Sales credit register ─────────────────────────────────────

async function getSalesCreditRegisterDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>, viewer: ReportViewer): Promise<ReportDescriptor> {
  await PermissionService.assert(viewer.userId, "sales_performance", "view");
  await PermissionService.assert(viewer.userId, "sales_orders", "view");
  const from = isoOrUndefined(filters.dateFrom, "dateFrom");
  const to = isoOrUndefined(filters.dateTo, "dateTo");
  const repId = uuid(filters.salesRepUserId, "sales rep");
  const territoryId = uuid(filters.salesTerritoryId, "territory");
  const scope = await getPerformanceScope(actorOf(companyId, viewer));
  const orders = await prisma.salesOrder.findMany({
    where: {
      companyId,
      ...bookedOrderWhere,
      ...(from || to ? { orderDate: { ...(from ? { gte: toDbDate(from) } : {}), ...(to ? { lte: toDbDate(to) } : {}) } } : {}),
      ...(repId ? { salesRepUserId: repId } : {}),
      ...(territoryId ? { salesTerritoryId: territoryId } : {}),
    },
    orderBy: [{ orderDate: "desc" }, { orderNumber: "desc" }],
    take: MAX_ROWS,
    select: {
      id: true,
      orderNumber: true,
      orderDate: true,
      status: true,
      baseTotalAmount: true,
      salesRepUserId: true,
      salesTerritoryId: true,
      salesCreditSource: true,
      customer: { select: { name: true } },
      salesRep: { select: { fullName: true } },
      salesTerritory: { select: { name: true, code: true } },
      items: { select: { breakdown: { select: { orderedQuantity: true } } } },
    },
  });
  // Visible: view_all, or credited to someone in the viewer's team, or to a territory they cover.
  const rows = orders
    .filter((o) => scope.viewAll || (o.salesRepUserId && canSeeRep(scope, o.salesRepUserId)) || (o.salesTerritoryId && canSeeTerritory(scope, o.salesTerritoryId)))
    .map((o) => ({
      salesOrderId: o.id,
      orderNumber: o.orderNumber,
      orderDate: dbDate(o.orderDate),
      customer: o.customer.name,
      status: o.status.replace(/_/g, " ").toLowerCase(),
      salesRep: o.salesRep?.fullName ?? "— none —",
      territory: o.salesTerritory ? `${o.salesTerritory.name} (${o.salesTerritory.code})` : "— none —",
      creditSource: o.salesCreditSource ? CREDIT_SOURCE_LABELS[o.salesCreditSource] : "—",
      pieces: o.items.reduce((s, i) => s + i.breakdown.reduce((t, b) => t + b.orderedQuantity, 0), 0),
      value: Number(o.baseTotalAmount),
    }));
  return {
    title: "Sales Credit Register",
    subtitle: "Booked Sales Orders (confirmed or later; held only if held after confirming) by order date, with the rep and territory each one is credited to. Value before GST.",
    filtersApplied: applied(filters, { dateFrom: "Order date from", dateTo: "Order date to", salesRepUserId: "Sales rep", salesTerritoryId: "Territory" }),
    columns: [
      { key: "orderNumber", label: "Sales Order", linkTo: "salesOrder" },
      { key: "orderDate", label: "Order date", type: "date" },
      { key: "customer", label: "Customer" },
      { key: "status", label: "Status" },
      { key: "salesRep", label: "Sales rep" },
      { key: "territory", label: "Territory" },
      { key: "creditSource", label: "Credit set by" },
      { key: "pieces", label: "Pieces", type: "number", align: "right" },
      { key: "value", label: "Value", type: "currency", align: "right" },
    ],
    rows,
    totals: { orderNumber: `${rows.length} orders`, pieces: rows.reduce((s, r) => s + r.pieces, 0), value: round2(rows.reduce((s, r) => s + r.value, 0)) },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

registerReport({ category: CATEGORY, key: "target-attainment", title: "Target Attainment", buildDescriptor: getTargetAttainmentDescriptor, pdfOrientation: "landscape" });
registerReport({ category: CATEGORY, key: "sales-credit-register", title: "Sales Credit Register", buildDescriptor: getSalesCreditRegisterDescriptor, pdfOrientation: "landscape" });

export { getTargetAttainmentDescriptor, getSalesCreditRegisterDescriptor };
