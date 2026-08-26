import { prisma } from "@/core/db/client";
import type { ReportDescriptor } from "@/core/reports/report-types";
import { registerReport } from "./registry";
import { validateStatusFilter } from "./report-filters";
import { ProductionOrderStatus } from "@prisma/client";

const CATEGORY = "production-planning" as const;

const OPEN_STATUSES = ["PLANNED", "MATERIAL_ALLOCATED", "IN_PROGRESS", "ON_HOLD"] as const;

function filtersApplied(filters: Record<string, string>, labels: Record<string, string>) {
  return Object.entries(filters)
    .filter(([, v]) => v)
    .map(([k, v]) => ({ label: labels[k] ?? k, value: v }));
}

// ---------------------------------------------------------------------------
// 1. Production Schedule — one row per Production Order, planned vs actual
// start/end dates straight from ProductionOrder's own columns (never
// re-derived — those fields are the source of truth for this data).
// ---------------------------------------------------------------------------
async function getProductionScheduleDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  const orders = await prisma.productionOrder.findMany({
    where: {
      companyId,
      ...validateStatusFilter(filters, ProductionOrderStatus),
    },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      plannedStartDate: true,
      plannedEndDate: true,
      actualStartDate: true,
      actualEndDate: true,
      product: { select: { styleCode: true, styleName: true } },
    },
    orderBy: { plannedStartDate: "asc" },
  });

  const rows = orders.map((o) => {
    let scheduleVarianceDays: string = "—";
    if (o.plannedEndDate && o.actualEndDate) {
      scheduleVarianceDays = String(Math.round((o.actualEndDate.getTime() - o.plannedEndDate.getTime()) / 86400000));
    } else if (o.plannedEndDate && !o.actualEndDate) {
      scheduleVarianceDays = "In Progress";
    }
    return {
      productionOrderId: o.id,
      orderNumber: o.orderNumber,
      style: `${o.product.styleCode} — ${o.product.styleName}`,
      plannedStartDate: o.plannedStartDate,
      plannedEndDate: o.plannedEndDate,
      actualStartDate: o.actualStartDate,
      actualEndDate: o.actualEndDate,
      status: o.status,
      scheduleVarianceDays,
    };
  });

  return {
    title: "Production Schedule",
    subtitle: "Planned vs. actual start/end dates per Production Order — straight from the order's own schedule fields.",
    filtersApplied: filtersApplied(filters, { status: "Status" }),
    columns: [
      { key: "orderNumber", label: "Order Number", linkTo: "productionOrder" },
      { key: "style", label: "Style" },
      { key: "plannedStartDate", label: "Planned Start", type: "date" },
      { key: "plannedEndDate", label: "Planned End", type: "date" },
      { key: "actualStartDate", label: "Actual Start", type: "date" },
      { key: "actualEndDate", label: "Actual End", type: "date" },
      { key: "status", label: "Status" },
      { key: "scheduleVarianceDays", label: "Schedule Variance (days)", type: "text", align: "right" },
    ],
    rows,
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ---------------------------------------------------------------------------
// 2. Delayed Production Orders — still open (not Closed/Cancelled), never
// actually finished (actualEndDate null), and past their own planned end
// date. All three conditions read directly off real ProductionOrder columns.
// ---------------------------------------------------------------------------
async function getDelayedProductionOrdersDescriptor(companyId: string, generatedByName: string): Promise<ReportDescriptor> {
  const now = new Date();
  const orders = await prisma.productionOrder.findMany({
    where: {
      companyId,
      status: { in: [...OPEN_STATUSES] },
      actualEndDate: null,
      plannedEndDate: { lt: now },
    },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      plannedEndDate: true,
      product: { select: { styleCode: true, styleName: true } },
    },
  });

  const rows = orders
    .map((o) => ({
      productionOrderId: o.id,
      orderNumber: o.orderNumber,
      style: `${o.product.styleCode} — ${o.product.styleName}`,
      plannedEndDate: o.plannedEndDate,
      daysOverdue: Math.floor((now.getTime() - (o.plannedEndDate as Date).getTime()) / 86400000),
      status: o.status,
    }))
    .sort((a, b) => b.daysOverdue - a.daysOverdue);

  return {
    title: "Delayed Production Orders",
    subtitle: "Open Production Orders past their planned end date with no actual completion recorded yet.",
    filtersApplied: [],
    columns: [
      { key: "orderNumber", label: "Order Number", linkTo: "productionOrder" },
      { key: "style", label: "Style" },
      { key: "plannedEndDate", label: "Planned End", type: "date" },
      { key: "daysOverdue", label: "Days Overdue", type: "number", align: "right" },
      { key: "status", label: "Status" },
    ],
    rows,
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

registerReport({ category: CATEGORY, key: "production-schedule", title: "Production Schedule", buildDescriptor: getProductionScheduleDescriptor, pdfOrientation: "landscape" });
registerReport({
  category: CATEGORY,
  key: "delayed-production-orders",
  title: "Delayed Production Orders",
  buildDescriptor: (c, g) => getDelayedProductionOrdersDescriptor(c, g),
});
