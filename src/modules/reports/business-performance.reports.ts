import { prisma } from "@/core/db/client";
import type { ReportDescriptor } from "@/core/reports/report-types";
import { registerReport } from "./registry";

const CATEGORY = "business-performance" as const;
const TOP_N = 20;

function parseDateRange(filters: Record<string, string>): { dateFrom?: Date; dateTo?: Date } {
  return {
    dateFrom: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
    dateTo: filters.dateTo ? new Date(filters.dateTo) : undefined,
  };
}

function filtersApplied(filters: Record<string, string>, labels: Record<string, string>) {
  return Object.entries(filters)
    .filter(([, v]) => v)
    .map(([k, v]) => ({ label: labels[k] ?? k, value: v }));
}

// ---------------------------------------------------------------------------
// 1. Top Customers by Revenue — same posted-Sales-Invoice source as the
// Sales & Orders category's own Customer-wise Sales report, ranked and
// capped to the top 20 with each customer's share of total revenue.
// ---------------------------------------------------------------------------
async function getTopCustomersByRevenueDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  const { dateFrom, dateTo } = parseDateRange(filters);
  const invoices = await prisma.salesInvoice.findMany({
    where: {
      companyId,
      status: { not: "CANCELLED" },
      ...(dateFrom || dateTo ? { invoiceDate: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } } : {}),
    },
    select: { customerId: true, totalAmount: true, customer: { select: { name: true } } },
  });

  const byCustomer = new Map<string, { customer: string; revenue: number; invoiceCount: number }>();
  for (const inv of invoices) {
    const existing = byCustomer.get(inv.customerId) ?? { customer: inv.customer.name, revenue: 0, invoiceCount: 0 };
    existing.revenue += Number(inv.totalAmount);
    existing.invoiceCount += 1;
    byCustomer.set(inv.customerId, existing);
  }

  const totalRevenue = [...byCustomer.values()].reduce((s, c) => s + c.revenue, 0);
  const rows = [...byCustomer.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, TOP_N)
    .map((c, index) => ({
      rank: index + 1,
      customer: c.customer,
      invoiceCount: c.invoiceCount,
      revenue: c.revenue,
      sharePercent: totalRevenue > 0 ? Math.round((c.revenue / totalRevenue) * 10000) / 100 : 0,
    }));

  return {
    title: "Top Customers by Revenue",
    subtitle: `Top ${TOP_N} customers by posted Sales Invoice revenue — same source as Sales & Orders' own Customer-wise Sales report.`,
    filtersApplied: filtersApplied(filters, { dateFrom: "Date From", dateTo: "Date To" }),
    columns: [
      { key: "rank", label: "Rank", type: "number", align: "right" },
      { key: "customer", label: "Customer" },
      { key: "invoiceCount", label: "Invoice Count", type: "number", align: "right" },
      { key: "revenue", label: "Revenue", type: "currency", align: "right" },
      { key: "sharePercent", label: "Share %", type: "percent", align: "right" },
    ],
    rows,
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ---------------------------------------------------------------------------
// 2. Top Styles by Revenue — from posted Sales Invoice items (the exact same
// per-line source Profitability's own reports use), ranked by revenue.
// ---------------------------------------------------------------------------
async function getTopStylesByRevenueDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  const { dateFrom, dateTo } = parseDateRange(filters);
  const invoices = await prisma.salesInvoice.findMany({
    where: {
      companyId,
      status: { not: "CANCELLED" },
      ...(dateFrom || dateTo ? { invoiceDate: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } } : {}),
    },
    select: { items: { select: { quantity: true, lineTotal: true, product: { select: { styleCode: true, styleName: true } } } } },
  });

  const byStyle = new Map<string, { styleCode: string; styleName: string; revenue: number; quantity: number }>();
  for (const inv of invoices) {
    for (const item of inv.items) {
      const key = item.product.styleCode;
      const existing = byStyle.get(key) ?? { styleCode: item.product.styleCode, styleName: item.product.styleName, revenue: 0, quantity: 0 };
      existing.revenue += Number(item.lineTotal);
      existing.quantity += item.quantity;
      byStyle.set(key, existing);
    }
  }

  const rows = [...byStyle.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, TOP_N)
    .map((s, index) => ({ rank: index + 1, ...s }));

  return {
    title: "Top Styles by Revenue",
    subtitle: `Top ${TOP_N} styles by posted Sales Invoice line revenue.`,
    filtersApplied: filtersApplied(filters, { dateFrom: "Date From", dateTo: "Date To" }),
    columns: [
      { key: "rank", label: "Rank", type: "number", align: "right" },
      { key: "styleCode", label: "Style Code" },
      { key: "styleName", label: "Style Name" },
      { key: "quantity", label: "Quantity Sold", type: "number", align: "right" },
      { key: "revenue", label: "Revenue", type: "currency", align: "right" },
    ],
    rows,
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ---------------------------------------------------------------------------
// 3. Monthly Sales Trend — posted Sales Invoice revenue grouped by calendar
// month (UTC-derived, matching this app's own toIsoDate()/toISOString()
// convention — see the timezone gotcha documented in CLAUDE.md's Phase 9 QA
// sweep section).
// ---------------------------------------------------------------------------
async function getMonthlySalesTrendDescriptor(companyId: string, generatedByName: string): Promise<ReportDescriptor> {
  const invoices = await prisma.salesInvoice.findMany({
    where: { companyId, status: { not: "CANCELLED" } },
    select: { invoiceDate: true, totalAmount: true },
  });

  const byMonth = new Map<string, { revenue: number; invoiceCount: number }>();
  for (const inv of invoices) {
    const month = inv.invoiceDate.toISOString().slice(0, 7);
    const existing = byMonth.get(month) ?? { revenue: 0, invoiceCount: 0 };
    existing.revenue += Number(inv.totalAmount);
    existing.invoiceCount += 1;
    byMonth.set(month, existing);
  }

  const rows = [...byMonth.entries()]
    .map(([month, v]) => ({ month, ...v }))
    .sort((a, b) => a.month.localeCompare(b.month));

  return {
    title: "Monthly Sales Trend",
    subtitle: "Posted Sales Invoice revenue by calendar month, across all history.",
    filtersApplied: [],
    columns: [
      { key: "month", label: "Month" },
      { key: "invoiceCount", label: "Invoice Count", type: "number", align: "right" },
      { key: "revenue", label: "Revenue", type: "currency", align: "right" },
    ],
    rows,
    totals: { invoiceCount: rows.reduce((s, r) => s + r.invoiceCount, 0), revenue: rows.reduce((s, r) => s + r.revenue, 0) },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

registerReport({ category: CATEGORY, key: "top-customers-by-revenue", title: "Top Customers by Revenue", buildDescriptor: getTopCustomersByRevenueDescriptor });
registerReport({ category: CATEGORY, key: "top-styles-by-revenue", title: "Top Styles by Revenue", buildDescriptor: getTopStylesByRevenueDescriptor });
registerReport({
  category: CATEGORY,
  key: "monthly-sales-trend",
  title: "Monthly Sales Trend",
  buildDescriptor: (c, g) => getMonthlySalesTrendDescriptor(c, g),
});
