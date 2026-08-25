import { prisma } from "@/core/db/client";
import type { ReportDescriptor } from "@/core/reports/report-types";
import { registerReport } from "./registry";

function formatValue(value: number, type: "currency" | "number" | "percent"): string {
  if (type === "currency") return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (type === "percent") return `${value.toFixed(2)}%`;
  return value.toLocaleString("en-IN");
}

// Every @db.Date column in this schema (dispatchDate, orderDate, invoiceDate,
// expenseDate, ...) is populated from a plain "YYYY-MM-DD" date-input string,
// which the JS Date constructor always parses as UTC midnight. Comparing
// against a LOCAL-midnight boundary (`new Date(y, m, d)`) silently shifts the
// "today"/"this month" window by the server's UTC offset — on this server
// (IST, UTC+5:30) that meant "today" actually started 5.5 hours into
// *yesterday* in DATE-column terms, over-counting the previous day's rows.
// Deriving the boundary from the UTC calendar date instead (matching the
// existing `toIsoDate()`/`toISOString().slice(0,10)` convention already used
// client-side in this app, e.g. marketing/channel-performance/page.tsx) keeps
// "today" aligned with how every date-only column is actually stored.
function startOfDay(d: Date): Date {
  return new Date(d.toISOString().slice(0, 10));
}
function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function startOfYear(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
}

interface KpiRow {
  section: string;
  metric: string;
  value: string;
}

// ---------------------------------------------------------------------------
// Executive Dashboard — a company-wide KPI snapshot. Every number here reuses
// the SAME source tables/statuses as that domain's own register reports
// (Sales Register = posted SalesInvoice, Purchase = non-cancelled PurchaseOrder,
// etc.) — never a second, independently-derived calculation.
// ---------------------------------------------------------------------------
async function getExecutiveDashboardDescriptor(companyId: string, generatedByName: string): Promise<ReportDescriptor> {
  const now = new Date();
  const todayStart = startOfDay(now);
  const monthStart = startOfMonth(now);
  const yearStart = startOfYear(now);

  const [
    salesToday,
    salesMonth,
    salesYear,
    salesTotal,
    orderCounts,
    purchaseMonth,
    pendingPoCount,
    stockBalances,
    jobOrderAgg,
    dispatchPendingCount,
    dispatchToday,
    dispatchMonth,
    receivableAgg,
    payableAgg,
    expenseMonthAgg,
  ] = await Promise.all([
    prisma.salesInvoice.aggregate({ where: { companyId, status: { not: "CANCELLED" }, invoiceDate: { gte: todayStart } }, _sum: { totalAmount: true } }),
    prisma.salesInvoice.aggregate({ where: { companyId, status: { not: "CANCELLED" }, invoiceDate: { gte: monthStart } }, _sum: { totalAmount: true } }),
    prisma.salesInvoice.aggregate({ where: { companyId, status: { not: "CANCELLED" }, invoiceDate: { gte: yearStart } }, _sum: { totalAmount: true } }),
    prisma.salesInvoice.aggregate({ where: { companyId, status: { not: "CANCELLED" } }, _sum: { totalAmount: true } }),
    prisma.salesOrder.groupBy({ by: ["status"], where: { companyId }, _count: { _all: true } }),
    prisma.purchaseOrder.aggregate({ where: { companyId, status: { not: "CANCELLED" }, orderDate: { gte: monthStart } }, _sum: { baseTotalAmount: true } }),
    prisma.purchaseOrder.count({ where: { companyId, status: { in: ["DRAFT", "APPROVED", "SENT_TO_SUPPLIER", "PARTIALLY_RECEIVED", "ON_HOLD"] } } }),
    prisma.stockBalance.findMany({ where: { companyId }, select: { quantityOnHand: true, product: { select: { unitCost: true, reorderLevel: true } } } }),
    prisma.jobOrder.aggregate({ where: { companyId }, _sum: { plannedQuantity: true, completedQuantity: true, rejectedQuantity: true, damagedQuantity: true } }),
    prisma.dispatch.count({ where: { companyId, status: { in: ["DRAFT", "PACKED", "ON_HOLD"] } } }),
    prisma.dispatch.count({ where: { companyId, status: { not: "CANCELLED" }, dispatchDate: { gte: todayStart } } }),
    prisma.dispatch.count({ where: { companyId, status: { not: "CANCELLED" }, dispatchDate: { gte: monthStart } } }),
    prisma.salesInvoice.aggregate({ where: { companyId, status: { in: ["POSTED", "PARTIALLY_PAID"] } }, _sum: { totalAmount: true, paidAmount: true } }),
    prisma.purchaseInvoice.aggregate({ where: { companyId, status: { in: ["POSTED", "PARTIALLY_PAID"] } }, _sum: { totalAmount: true, paidAmount: true } }),
    prisma.expense.aggregate({ where: { companyId, status: { not: "CANCELLED" }, expenseDate: { gte: monthStart } }, _sum: { totalAmount: true } }),
  ]);

  const orderCountByStatus = new Map<string, number>(orderCounts.map((o) => [o.status, o._count._all]));
  const totalOrders = orderCounts.reduce((s, o) => s + o._count._all, 0);
  const pendingOrders = ["DRAFT", "CONFIRMED", "IN_PRODUCTION", "PARTIALLY_DISPATCHED", "ON_HOLD"].reduce((s, st) => s + (orderCountByStatus.get(st) ?? 0), 0);
  const completedOrders = ["DISPATCHED", "INVOICED", "CLOSED"].reduce((s, st) => s + (orderCountByStatus.get(st) ?? 0), 0);
  const cancelledOrders = orderCountByStatus.get("CANCELLED") ?? 0;

  const stockValue = stockBalances.reduce((sum, b) => sum + (b.product.unitCost ? Number(b.quantityOnHand) * Number(b.product.unitCost) : 0), 0);
  const lowStockCount = stockBalances.filter((b) => b.product.reorderLevel !== null && Number(b.quantityOnHand) < Number(b.product.reorderLevel)).length;

  const planned = Number(jobOrderAgg._sum.plannedQuantity ?? 0);
  const completed = Number(jobOrderAgg._sum.completedQuantity ?? 0);
  const rejected = Number(jobOrderAgg._sum.rejectedQuantity ?? 0);
  const damaged = Number(jobOrderAgg._sum.damagedQuantity ?? 0);
  const achievementPct = planned > 0 ? (completed / planned) * 100 : 0;
  const producedTotal = completed + rejected + damaged;
  const rejectionPct = producedTotal > 0 ? (rejected / producedTotal) * 100 : 0;

  const totalReceivable = Number(receivableAgg._sum.totalAmount ?? 0) - Number(receivableAgg._sum.paidAmount ?? 0);
  const totalPayable = Number(payableAgg._sum.totalAmount ?? 0) - Number(payableAgg._sum.paidAmount ?? 0);

  const rows: KpiRow[] = [
    { section: "Sales", metric: "Sales Today", value: formatValue(Number(salesToday._sum.totalAmount ?? 0), "currency") },
    { section: "Sales", metric: "Sales This Month", value: formatValue(Number(salesMonth._sum.totalAmount ?? 0), "currency") },
    { section: "Sales", metric: "Sales This Year", value: formatValue(Number(salesYear._sum.totalAmount ?? 0), "currency") },
    { section: "Sales", metric: "Sales Total (All Time)", value: formatValue(Number(salesTotal._sum.totalAmount ?? 0), "currency") },
    { section: "Orders", metric: "Total Orders", value: formatValue(totalOrders, "number") },
    { section: "Orders", metric: "Pending Orders", value: formatValue(pendingOrders, "number") },
    { section: "Orders", metric: "Completed Orders", value: formatValue(completedOrders, "number") },
    { section: "Orders", metric: "Cancelled Orders", value: formatValue(cancelledOrders, "number") },
    { section: "Purchase", metric: "Purchase This Month", value: formatValue(Number(purchaseMonth._sum.baseTotalAmount ?? 0), "currency") },
    { section: "Purchase", metric: "Pending Purchase Orders", value: formatValue(pendingPoCount, "number") },
    { section: "Inventory", metric: "Stock Value", value: formatValue(stockValue, "currency") },
    { section: "Inventory", metric: "Low Stock Items", value: formatValue(lowStockCount, "number") },
    { section: "Production", metric: "Planned Quantity", value: formatValue(planned, "number") },
    { section: "Production", metric: "Actual (Completed) Quantity", value: formatValue(completed, "number") },
    { section: "Production", metric: "Achievement %", value: formatValue(achievementPct, "percent") },
    { section: "Production", metric: "Rejection %", value: formatValue(rejectionPct, "percent") },
    { section: "Dispatch", metric: "Pending Dispatch", value: formatValue(dispatchPendingCount, "number") },
    { section: "Dispatch", metric: "Dispatched Today", value: formatValue(dispatchToday, "number") },
    { section: "Dispatch", metric: "Dispatched This Month", value: formatValue(dispatchMonth, "number") },
    { section: "Finance", metric: "Revenue (This Month)", value: formatValue(Number(salesMonth._sum.totalAmount ?? 0), "currency") },
    { section: "Finance", metric: "Total Receivable (AR)", value: formatValue(totalReceivable, "currency") },
    { section: "Finance", metric: "Total Payable (AP)", value: formatValue(totalPayable, "currency") },
    { section: "Finance", metric: "Expenses This Month", value: formatValue(Number(expenseMonthAgg._sum.totalAmount ?? 0), "currency") },
  ];

  return {
    title: "Executive Dashboard",
    subtitle: "Company-wide KPI snapshot — every figure reconciles with its own module's register report.",
    filtersApplied: [],
    columns: [
      { key: "section", label: "Section" },
      { key: "metric", label: "Metric" },
      { key: "value", label: "Value", align: "right" },
    ],
    rows: rows as unknown as Record<string, unknown>[],
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ---------------------------------------------------------------------------
// Daily MIS — "today" only, same source tables as the Executive Dashboard.
// ---------------------------------------------------------------------------
async function getDailyMisDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  const targetDate = filters.date ? new Date(filters.date) : new Date();
  const dayStart = startOfDay(targetDate);
  const dayEnd = new Date(dayStart.getTime() + 86400000);

  const [
    salesToday,
    ordersToday,
    purchaseToday,
    productionToday,
    qcToday,
    dispatchToday,
    collectionsToday,
    expensesToday,
    stockBalances,
    pendingOrdersOverdue,
  ] = await Promise.all([
    prisma.salesInvoice.aggregate({ where: { companyId, status: { not: "CANCELLED" }, invoiceDate: { gte: dayStart, lt: dayEnd } }, _sum: { totalAmount: true }, _count: { _all: true } }),
    prisma.salesOrder.count({ where: { companyId, orderDate: { gte: dayStart, lt: dayEnd } } }),
    prisma.purchaseOrder.aggregate({ where: { companyId, status: { not: "CANCELLED" }, orderDate: { gte: dayStart, lt: dayEnd } }, _sum: { baseTotalAmount: true }, _count: { _all: true } }),
    prisma.jobOrder.aggregate({ where: { companyId, createdAt: { gte: dayStart, lt: dayEnd } }, _sum: { completedQuantity: true } }).catch(() => ({ _sum: { completedQuantity: null } })),
    prisma.qcInspection.count({ where: { companyId, inspectedAt: { gte: dayStart, lt: dayEnd } } }),
    prisma.dispatch.count({ where: { companyId, status: { not: "CANCELLED" }, dispatchDate: { gte: dayStart, lt: dayEnd } } }),
    prisma.payment.aggregate({ where: { companyId, direction: "RECEIPT", status: "POSTED", paymentDate: { gte: dayStart, lt: dayEnd } }, _sum: { amount: true } }),
    prisma.expense.aggregate({ where: { companyId, status: { not: "CANCELLED" }, expenseDate: { gte: dayStart, lt: dayEnd } }, _sum: { totalAmount: true } }),
    prisma.stockBalance.findMany({ where: { companyId }, select: { quantityOnHand: true, product: { select: { reorderLevel: true } } } }),
    prisma.salesOrder.count({
      where: {
        companyId,
        status: { in: ["DRAFT", "CONFIRMED", "IN_PRODUCTION", "PARTIALLY_DISPATCHED", "ON_HOLD"] },
        requiredShipDate: { lt: dayStart },
      },
    }),
  ]);

  const lowStockCount = stockBalances.filter((b) => b.product.reorderLevel !== null && Number(b.quantityOnHand) < Number(b.product.reorderLevel)).length;

  const rows: KpiRow[] = [
    { section: "Sales", metric: "Sales", value: formatValue(Number(salesToday._sum.totalAmount ?? 0), "currency") },
    { section: "Sales", metric: "Invoices Posted", value: formatValue(salesToday._count._all, "number") },
    { section: "Orders", metric: "New Orders", value: formatValue(ordersToday, "number") },
    { section: "Purchase", metric: "Purchase Orders Raised", value: formatValue(purchaseToday._count._all, "number") },
    { section: "Purchase", metric: "Purchase Amount", value: formatValue(Number(purchaseToday._sum.baseTotalAmount ?? 0), "currency") },
    { section: "Production", metric: "Quantity Completed", value: formatValue(Number(productionToday._sum.completedQuantity ?? 0), "number") },
    { section: "Quality", metric: "QC Inspections", value: formatValue(qcToday, "number") },
    { section: "Dispatch", metric: "Dispatches", value: formatValue(dispatchToday, "number") },
    { section: "Collections", metric: "Payments Received", value: formatValue(Number(collectionsToday._sum.amount ?? 0), "currency") },
    { section: "Expenses", metric: "Expenses", value: formatValue(Number(expensesToday._sum.totalAmount ?? 0), "currency") },
    { section: "Critical", metric: "Critical Stock (Below Reorder Level)", value: formatValue(lowStockCount, "number") },
    { section: "Critical", metric: "Critical Pending Orders (Past Required Ship Date)", value: formatValue(pendingOrdersOverdue, "number") },
  ];

  return {
    title: "Management MIS — Daily",
    subtitle: `Daily summary for ${dayStart.toISOString().slice(0, 10)}.`,
    filtersApplied: filters.date ? [{ label: "Date", value: filters.date }] : [],
    columns: [
      { key: "section", label: "Section" },
      { key: "metric", label: "Metric" },
      { key: "value", label: "Value", align: "right" },
    ],
    rows: rows as unknown as Record<string, unknown>[],
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

registerReport({
  category: "dashboard",
  key: "executive-dashboard",
  title: "Executive Dashboard",
  buildDescriptor: (companyId, generatedByName) => getExecutiveDashboardDescriptor(companyId, generatedByName),
});

registerReport({
  category: "mis",
  key: "daily-mis",
  title: "Management MIS — Daily",
  buildDescriptor: getDailyMisDescriptor,
});
