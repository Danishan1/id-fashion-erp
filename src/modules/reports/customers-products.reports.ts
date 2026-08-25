import { prisma } from "@/core/db/client";
import type { ReportDescriptor } from "@/core/reports/report-types";
import { registerReport } from "./registry";

function filtersApplied(filters: Record<string, string>, labels: Record<string, string>) {
  return Object.entries(filters)
    .filter(([, v]) => v)
    .map(([k, v]) => ({ label: labels[k] ?? k, value: v }));
}

// ===========================================================================
// Category: customers
// ===========================================================================
const CUSTOMERS_CATEGORY = "customers" as const;

// ---------------------------------------------------------------------------
// 1. Customer Register
// ---------------------------------------------------------------------------
async function getCustomerRegisterDescriptor(
  companyId: string,
  generatedByName: string,
  filters: Record<string, string>
): Promise<ReportDescriptor> {
  const customers = await prisma.customer.findMany({
    where: {
      companyId,
      ...(filters.status ? { isActive: filters.status === "true" } : {}),
    },
    select: {
      id: true,
      code: true,
      name: true,
      country: true,
      paymentTermsDays: true,
      creditLimit: true,
      isActive: true,
    },
    orderBy: { name: "asc" },
  });

  const rows = customers.map((c) => ({
    customerId: c.id,
    code: c.code,
    name: c.name,
    country: c.country ?? "—",
    paymentTermsDays: c.paymentTermsDays ?? "—",
    creditLimit: c.creditLimit ? Number(c.creditLimit) : 0,
    status: c.isActive ? "Active" : "Inactive",
  }));

  return {
    title: "Customer Register",
    subtitle: "All customers matching the selected filters.",
    filtersApplied: filtersApplied(filters, { status: "Status" }),
    columns: [
      { key: "code", label: "Code" },
      { key: "name", label: "Name", linkTo: "customer" },
      { key: "country", label: "Country" },
      { key: "paymentTermsDays", label: "Payment Terms (days)", align: "right" },
      { key: "creditLimit", label: "Credit Limit", type: "currency", align: "right" },
      { key: "status", label: "Status" },
    ],
    rows,
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ---------------------------------------------------------------------------
// 2. Customer Outstanding — per-customer AR summary. Same underlying figure
// (totalAmount - paidAmount on posted/partially-paid Sales Invoices) as the
// Receivables category's own per-invoice report will use — this is a
// different aggregation shape (per-customer total, not per-invoice), not a
// second independent calculation that could disagree with it.
// ---------------------------------------------------------------------------
async function getCustomerOutstandingDescriptor(companyId: string, generatedByName: string): Promise<ReportDescriptor> {
  const invoices = await prisma.salesInvoice.findMany({
    where: {
      companyId,
      status: { in: ["POSTED", "PARTIALLY_PAID"] },
    },
    select: {
      customerId: true,
      totalAmount: true,
      paidAmount: true,
      customer: { select: { name: true } },
    },
  });

  const byCustomer = new Map<string, { customerId: string; customer: string; invoiceCount: number; outstandingAmount: number }>();
  for (const inv of invoices) {
    const outstanding = Number(inv.totalAmount) - Number(inv.paidAmount);
    if (outstanding <= 0.0001) continue;
    const existing = byCustomer.get(inv.customerId) ?? {
      customerId: inv.customerId,
      customer: inv.customer.name,
      invoiceCount: 0,
      outstandingAmount: 0,
    };
    existing.invoiceCount += 1;
    existing.outstandingAmount += outstanding;
    byCustomer.set(inv.customerId, existing);
  }

  const rows = [...byCustomer.values()].sort((a, b) => b.outstandingAmount - a.outstandingAmount);

  return {
    title: "Customer Outstanding",
    subtitle: "Per-customer AR summary from posted/partially-paid Sales Invoices.",
    filtersApplied: [],
    columns: [
      { key: "customer", label: "Customer", linkTo: "customer" },
      { key: "invoiceCount", label: "Outstanding Invoice Count", type: "number", align: "right" },
      { key: "outstandingAmount", label: "Total Outstanding", type: "currency", align: "right" },
    ],
    rows,
    totals: {
      invoiceCount: rows.reduce((s, r) => s + r.invoiceCount, 0),
      outstandingAmount: rows.reduce((s, r) => s + r.outstandingAmount, 0),
    },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

registerReport({
  category: CUSTOMERS_CATEGORY,
  key: "customer-register",
  title: "Customer Register",
  buildDescriptor: getCustomerRegisterDescriptor,
});
registerReport({
  category: CUSTOMERS_CATEGORY,
  key: "customer-outstanding",
  title: "Customer Outstanding",
  buildDescriptor: getCustomerOutstandingDescriptor,
});

// ===========================================================================
// Category: products
// ===========================================================================
const PRODUCTS_CATEGORY = "products" as const;

// ---------------------------------------------------------------------------
// 3. Style Register
// ---------------------------------------------------------------------------
async function getStyleRegisterDescriptor(
  companyId: string,
  generatedByName: string,
  filters: Record<string, string>
): Promise<ReportDescriptor> {
  const products = await prisma.product.findMany({
    where: {
      companyId,
      itemType: "STYLE",
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      ...(filters.seasonId ? { seasonId: filters.seasonId } : {}),
      ...(filters.status ? { isActive: filters.status === "true" } : {}),
    },
    select: {
      id: true,
      styleCode: true,
      styleName: true,
      designNumber: true,
      isActive: true,
      category: { select: { name: true } },
      season: { select: { name: true } },
    },
    orderBy: { styleCode: "asc" },
  });

  const rows = products.map((p) => ({
    productId: p.id,
    styleCode: p.styleCode,
    styleName: p.styleName,
    designNumber: p.designNumber ?? "—",
    category: p.category?.name ?? "—",
    season: p.season?.name ?? "—",
    status: p.isActive ? "Active" : "Inactive",
  }));

  return {
    title: "Style Register",
    subtitle: "All styles matching the selected filters.",
    filtersApplied: filtersApplied(filters, { categoryId: "Category", seasonId: "Season", status: "Status" }),
    columns: [
      { key: "styleCode", label: "Style Code" },
      { key: "styleName", label: "Style Name", linkTo: "product" },
      { key: "designNumber", label: "Design Number" },
      { key: "category", label: "Category" },
      { key: "season", label: "Season" },
      { key: "status", label: "Status" },
    ],
    rows,
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ---------------------------------------------------------------------------
// 4. Style-wise Production — aggregates JobOrder quantities grouped by style
// (via productionOrder.productId), not by ProductionOrder — a different
// grouping than the Production category's own reports, so queried directly
// here rather than reusing that file.
// ---------------------------------------------------------------------------
async function getStyleWiseProductionDescriptor(companyId: string, generatedByName: string): Promise<ReportDescriptor> {
  const jobOrders = await prisma.jobOrder.findMany({
    where: { companyId },
    select: {
      completedQuantity: true,
      rejectedQuantity: true,
      damagedQuantity: true,
      productionOrder: { select: { productId: true, product: { select: { styleCode: true, styleName: true } } } },
    },
  });

  const byStyle = new Map<
    string,
    { productId: string; styleCode: string; styleName: string; totalCompleted: number; totalRejected: number; totalDamaged: number }
  >();
  for (const job of jobOrders) {
    const productId = job.productionOrder.productId;
    const existing = byStyle.get(productId) ?? {
      productId,
      styleCode: job.productionOrder.product.styleCode,
      styleName: job.productionOrder.product.styleName,
      totalCompleted: 0,
      totalRejected: 0,
      totalDamaged: 0,
    };
    existing.totalCompleted += Number(job.completedQuantity);
    existing.totalRejected += Number(job.rejectedQuantity);
    existing.totalDamaged += Number(job.damagedQuantity);
    byStyle.set(productId, existing);
  }

  const rows = [...byStyle.values()].sort((a, b) => b.totalCompleted - a.totalCompleted);

  return {
    title: "Style-wise Production",
    subtitle: "Job Order quantities aggregated by style.",
    filtersApplied: [],
    columns: [
      { key: "styleCode", label: "Style Code" },
      { key: "styleName", label: "Style Name" },
      { key: "totalCompleted", label: "Total Completed", type: "number", align: "right" },
      { key: "totalRejected", label: "Total Rejected", type: "number", align: "right" },
      { key: "totalDamaged", label: "Total Damaged", type: "number", align: "right" },
    ],
    rows,
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

registerReport({
  category: PRODUCTS_CATEGORY,
  key: "style-register",
  title: "Style Register",
  buildDescriptor: getStyleRegisterDescriptor,
});
registerReport({
  category: PRODUCTS_CATEGORY,
  key: "style-wise-production",
  title: "Style-wise Production",
  buildDescriptor: getStyleWiseProductionDescriptor,
});
