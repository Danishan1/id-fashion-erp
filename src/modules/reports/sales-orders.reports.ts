import { prisma } from "@/core/db/client";
import type { ReportDescriptor } from "@/core/reports/report-types";
import { registerReport } from "./registry";
import { parseReportDateRange } from "./report-date-range";
import { round2 } from "@/lib/money";

const CATEGORY = "sales-orders" as const;

interface OrderFilters {
  dateFrom?: string;
  dateTo?: string;
  customerId?: string;
  status?: string;
}

function filtersApplied(filters: Record<string, string>, labels: Record<string, string>) {
  return Object.entries(filters)
    .filter(([, v]) => v)
    .map(([k, v]) => ({ label: labels[k] ?? k, value: v }));
}

// ---------------------------------------------------------------------------
// 1. Order Register
// ---------------------------------------------------------------------------
async function getOrderRegisterDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  const { dateFrom, dateToExclusive } = parseReportDateRange(filters);
  const orders = await prisma.salesOrder.findMany({
    where: {
      companyId,
      ...(filters.customerId ? { customerId: filters.customerId } : {}),
      ...(filters.status ? { status: filters.status as never } : {}),
      ...(dateFrom || dateToExclusive ? { orderDate: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateToExclusive ? { lt: dateToExclusive } : {}) } } : {}),
    },
    select: { id: true, orderNumber: true, orderDate: true, status: true, baseTotalAmount: true, customer: { select: { name: true } } },
    orderBy: { orderDate: "desc" },
  });

  const rows = orders.map((o) => ({
    salesOrderId: o.id,
    orderNumber: o.orderNumber,
    orderDate: o.orderDate,
    customer: o.customer.name,
    status: o.status,
    orderAmount: Number(o.baseTotalAmount),
  }));

  return {
    title: "Order Register",
    subtitle: "Every Sales Order matching the selected filters.",
    filtersApplied: filtersApplied(filters, { dateFrom: "Date From", dateTo: "Date To", customerId: "Customer", status: "Status" }),
    columns: [
      { key: "orderNumber", label: "Order Number", linkTo: "salesOrder" },
      { key: "orderDate", label: "Order Date", type: "date" },
      { key: "customer", label: "Customer" },
      { key: "status", label: "Status" },
      { key: "orderAmount", label: "Order Amount", type: "currency", align: "right" },
    ],
    rows,
    totals: { orderAmount: round2(rows.reduce((sum, r) => sum + r.orderAmount, 0)) },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ---------------------------------------------------------------------------
// 2. Sales Register — from posted Sales Invoices, the actual revenue-recognition
// document. Deliberately NOT built from SalesOrder.totalAmount, which is an
// order commitment, not recognized revenue.
// ---------------------------------------------------------------------------
async function getSalesRegisterDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  const { dateFrom, dateToExclusive } = parseReportDateRange(filters);
  const invoices = await prisma.salesInvoice.findMany({
    where: {
      companyId,
      status: { not: "CANCELLED" },
      ...(filters.customerId ? { customerId: filters.customerId } : {}),
      ...(dateFrom || dateToExclusive ? { invoiceDate: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateToExclusive ? { lt: dateToExclusive } : {}) } } : {}),
    },
    select: {
      id: true,
      invoiceNumber: true,
      invoiceDate: true,
      status: true,
      subtotalAmount: true,
      taxAmount: true,
      totalAmount: true,
      customer: { select: { name: true } },
      salesOrder: { select: { orderNumber: true } },
    },
    orderBy: { invoiceDate: "desc" },
  });

  const rows = invoices.map((inv) => ({
    salesInvoiceId: inv.id,
    invoiceNumber: inv.invoiceNumber,
    invoiceDate: inv.invoiceDate,
    customer: inv.customer.name,
    orderNumber: inv.salesOrder.orderNumber,
    status: inv.status,
    subtotal: Number(inv.subtotalAmount),
    tax: Number(inv.taxAmount),
    total: Number(inv.totalAmount),
  }));

  return {
    title: "Sales Register",
    subtitle: "Posted Sales Invoices — this reconciles exactly with each invoice's own detail page.",
    filtersApplied: filtersApplied(filters, { dateFrom: "Date From", dateTo: "Date To", customerId: "Customer" }),
    columns: [
      { key: "invoiceNumber", label: "Invoice Number", linkTo: "salesInvoice" },
      { key: "invoiceDate", label: "Invoice Date", type: "date" },
      { key: "customer", label: "Customer" },
      { key: "orderNumber", label: "Order Number" },
      { key: "status", label: "Status" },
      { key: "subtotal", label: "Subtotal", type: "currency", align: "right" },
      { key: "tax", label: "Tax", type: "currency", align: "right" },
      { key: "total", label: "Total", type: "currency", align: "right" },
    ],
    rows,
    totals: {
      subtotal: round2(rows.reduce((s, r) => s + r.subtotal, 0)),
      tax: round2(rows.reduce((s, r) => s + r.tax, 0)),
      total: round2(rows.reduce((s, r) => s + r.total, 0)),
    },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ---------------------------------------------------------------------------
// 3. Customer-wise Sales — aggregates the same Sales Invoice source as the
// Sales Register (never a second, independent calculation).
// ---------------------------------------------------------------------------
async function getCustomerWiseSalesDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  const { dateFrom, dateToExclusive } = parseReportDateRange(filters);
  const invoices = await prisma.salesInvoice.findMany({
    where: {
      companyId,
      status: { not: "CANCELLED" },
      ...(dateFrom || dateToExclusive ? { invoiceDate: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateToExclusive ? { lt: dateToExclusive } : {}) } } : {}),
    },
    select: { customerId: true, totalAmount: true, customer: { select: { name: true } } },
  });

  const byCustomer = new Map<string, { customerId: string; customer: string; invoiceCount: number; totalAmount: number }>();
  for (const inv of invoices) {
    const existing = byCustomer.get(inv.customerId) ?? { customerId: inv.customerId, customer: inv.customer.name, invoiceCount: 0, totalAmount: 0 };
    existing.invoiceCount += 1;
    existing.totalAmount = round2(existing.totalAmount + Number(inv.totalAmount));
    byCustomer.set(inv.customerId, existing);
  }

  const rows = [...byCustomer.values()].sort((a, b) => b.totalAmount - a.totalAmount);

  return {
    title: "Customer-wise Sales",
    subtitle: "Posted Sales Invoice totals grouped by customer.",
    filtersApplied: filtersApplied(filters, { dateFrom: "Date From", dateTo: "Date To" }),
    columns: [
      { key: "customer", label: "Customer", linkTo: "customer" },
      { key: "invoiceCount", label: "Invoice Count", type: "number", align: "right" },
      { key: "totalAmount", label: "Total Amount", type: "currency", align: "right" },
    ],
    rows,
    totals: {
      invoiceCount: rows.reduce((s, r) => s + r.invoiceCount, 0),
      totalAmount: round2(rows.reduce((s, r) => s + r.totalAmount, 0)),
    },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

const PENDING_STATUSES = ["DRAFT", "CONFIRMED", "IN_PRODUCTION", "PARTIALLY_DISPATCHED", "ON_HOLD"] as const;

// ---------------------------------------------------------------------------
// 4. Pending Orders — not yet Dispatched/Invoiced/Closed/Cancelled.
// ---------------------------------------------------------------------------
async function getPendingOrdersDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  const orders = await prisma.salesOrder.findMany({
    where: {
      companyId,
      status: { in: [...PENDING_STATUSES] },
      ...(filters.customerId ? { customerId: filters.customerId } : {}),
    },
    select: { id: true, orderNumber: true, orderDate: true, status: true, baseTotalAmount: true, customer: { select: { name: true } } },
    orderBy: { orderDate: "asc" },
  });

  const now = Date.now();
  const rows = orders.map((o) => ({
    salesOrderId: o.id,
    orderNumber: o.orderNumber,
    customer: o.customer.name,
    status: o.status,
    orderDate: o.orderDate,
    daysPending: Math.floor((now - o.orderDate.getTime()) / 86400000),
    orderAmount: Number(o.baseTotalAmount),
  }));

  return {
    title: "Pending Orders",
    subtitle: "Sales Orders not yet fully dispatched, invoiced, closed, or cancelled.",
    filtersApplied: filtersApplied(filters, { customerId: "Customer" }),
    columns: [
      { key: "orderNumber", label: "Order Number", linkTo: "salesOrder" },
      { key: "customer", label: "Customer" },
      { key: "status", label: "Status" },
      { key: "orderDate", label: "Order Date", type: "date" },
      { key: "daysPending", label: "Days Pending", type: "number", align: "right" },
      { key: "orderAmount", label: "Order Amount", type: "currency", align: "right" },
    ],
    rows,
    totals: { orderAmount: round2(rows.reduce((s, r) => s + r.orderAmount, 0)) },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

function ageBucket(days: number): string {
  if (days <= 30) return "0-30 days";
  if (days <= 60) return "31-60 days";
  if (days <= 90) return "61-90 days";
  return "90+ days";
}

// ---------------------------------------------------------------------------
// 5. Order Aging — same pending-order source as report #4, bucketed by age.
// ---------------------------------------------------------------------------
async function getOrderAgingDescriptor(companyId: string, generatedByName: string): Promise<ReportDescriptor> {
  const orders = await prisma.salesOrder.findMany({
    where: { companyId, status: { in: [...PENDING_STATUSES] } },
    select: { id: true, orderNumber: true, orderDate: true, status: true, baseTotalAmount: true, customer: { select: { name: true } } },
  });

  const now = Date.now();
  const rows = orders
    .map((o) => {
      const daysPending = Math.floor((now - o.orderDate.getTime()) / 86400000);
      return {
        salesOrderId: o.id,
        orderNumber: o.orderNumber,
        customer: o.customer.name,
        status: o.status,
        orderDate: o.orderDate,
        daysPending,
        ageBucket: ageBucket(daysPending),
        orderAmount: Number(o.baseTotalAmount),
      };
    })
    .sort((a, b) => b.daysPending - a.daysPending);

  return {
    title: "Order Aging",
    subtitle: "Pending orders bucketed by age since order date.",
    filtersApplied: [],
    columns: [
      { key: "orderNumber", label: "Order Number", linkTo: "salesOrder" },
      { key: "customer", label: "Customer" },
      { key: "status", label: "Status" },
      { key: "orderDate", label: "Order Date", type: "date" },
      { key: "daysPending", label: "Days Pending", type: "number", align: "right" },
      { key: "ageBucket", label: "Age Bucket" },
      { key: "orderAmount", label: "Order Amount", type: "currency", align: "right" },
    ],
    rows,
    totals: { orderAmount: round2(rows.reduce((s, r) => s + r.orderAmount, 0)) },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

registerReport({ category: CATEGORY, key: "order-register", title: "Order Register", buildDescriptor: getOrderRegisterDescriptor });
registerReport({ category: CATEGORY, key: "sales-register", title: "Sales Register", buildDescriptor: getSalesRegisterDescriptor });
registerReport({ category: CATEGORY, key: "customer-wise-sales", title: "Customer-wise Sales", buildDescriptor: getCustomerWiseSalesDescriptor });
registerReport({ category: CATEGORY, key: "pending-orders", title: "Pending Orders", buildDescriptor: getPendingOrdersDescriptor });
registerReport({ category: CATEGORY, key: "order-aging", title: "Order Aging", buildDescriptor: getOrderAgingDescriptor, pdfOrientation: "landscape" });

export type { OrderFilters };
