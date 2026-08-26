import { prisma } from "@/core/db/client";
import type { ReportDescriptor } from "@/core/reports/report-types";
import { registerReport } from "./registry";
import { parseReportDateRange } from "./report-date-range";
import { validateStatusFilter } from "./report-filters";
import { round2 } from "@/lib/money";
import { SalesInvoiceStatus } from "@prisma/client";

const CATEGORY = "invoicing" as const;

function filtersApplied(filters: Record<string, string>, labels: Record<string, string>) {
  return Object.entries(filters)
    .filter(([, v]) => v)
    .map(([k, v]) => ({ label: labels[k] ?? k, value: v }));
}

// ---------------------------------------------------------------------------
// 1. Sales Invoice Register — every Sales Invoice matching the selected
// filters, regardless of status (unlike Sales Register in sales-orders.reports.ts,
// which is scoped to non-cancelled only — this register is the full list).
// ---------------------------------------------------------------------------
async function getSalesInvoiceRegisterDescriptor(
  companyId: string,
  generatedByName: string,
  filters: Record<string, string>
): Promise<ReportDescriptor> {
  const { dateFrom, dateToExclusive } = parseReportDateRange(filters);
  const invoices = await prisma.salesInvoice.findMany({
    where: {
      companyId,
      ...(filters.customerId ? { customerId: filters.customerId } : {}),
      ...validateStatusFilter(filters, SalesInvoiceStatus),
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

  // Rows deliberately include every status (this register is the full audit
  // trail — see the module comment above), but a CANCELLED invoice has zero
  // real financial impact, so it must not contribute to the totals row — a
  // cancelled invoice's amount inflating "how much did we invoice" broke this
  // report's own documented reconciliation against Sales Register, which
  // already excludes cancelled invoices entirely (ERP-BUG-QA-02, Phase 10 QA
  // pass — confirmed the two disagreed by exactly one cancelled invoice's
  // amount).
  const realRows = rows.filter((r) => r.status !== "CANCELLED");

  return {
    title: "Sales Invoice Register",
    subtitle: "Every Sales Invoice matching the selected filters. Totals exclude cancelled invoices.",
    filtersApplied: filtersApplied(filters, { dateFrom: "Date From", dateTo: "Date To", customerId: "Customer", status: "Status" }),
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
      subtotal: round2(realRows.reduce((s, r) => s + r.subtotal, 0)),
      tax: round2(realRows.reduce((s, r) => s + r.tax, 0)),
      total: round2(realRows.reduce((s, r) => s + r.total, 0)),
    },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ---------------------------------------------------------------------------
// 2. Outstanding Invoice — Sales Invoices with a real unpaid balance
// (status POSTED/PARTIALLY_PAID and totalAmount - paidAmount > 0).
// ---------------------------------------------------------------------------
async function getOutstandingInvoiceDescriptor(
  companyId: string,
  generatedByName: string,
  filters: Record<string, string>
): Promise<ReportDescriptor> {
  const invoices = await prisma.salesInvoice.findMany({
    where: {
      companyId,
      status: { in: ["POSTED", "PARTIALLY_PAID"] },
      ...(filters.customerId ? { customerId: filters.customerId } : {}),
    },
    select: {
      id: true,
      invoiceNumber: true,
      invoiceDate: true,
      dueDate: true,
      totalAmount: true,
      paidAmount: true,
      customer: { select: { name: true } },
    },
  });

  const rows = invoices
    .map((inv) => {
      const total = round2(Number(inv.totalAmount));
      const paid = round2(Number(inv.paidAmount));
      const outstanding = round2(total - paid);
      return {
        salesInvoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate,
        dueDate: inv.dueDate,
        customer: inv.customer.name,
        total,
        paid,
        outstanding,
      };
    })
    .filter((r) => r.outstanding > 0.0001)
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());

  return {
    title: "Outstanding Invoice",
    subtitle: "Sales Invoices with a real unpaid balance.",
    filtersApplied: filtersApplied(filters, { customerId: "Customer" }),
    columns: [
      { key: "invoiceNumber", label: "Invoice Number", linkTo: "salesInvoice" },
      { key: "invoiceDate", label: "Invoice Date", type: "date" },
      { key: "dueDate", label: "Due Date", type: "date" },
      { key: "customer", label: "Customer" },
      { key: "total", label: "Total", type: "currency", align: "right" },
      { key: "paid", label: "Paid", type: "currency", align: "right" },
      { key: "outstanding", label: "Outstanding", type: "currency", align: "right" },
    ],
    rows,
    totals: {
      total: round2(rows.reduce((s, r) => s + r.total, 0)),
      paid: round2(rows.reduce((s, r) => s + r.paid, 0)),
      outstanding: round2(rows.reduce((s, r) => s + r.outstanding, 0)),
    },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

registerReport({
  category: CATEGORY,
  key: "sales-invoice-register",
  title: "Sales Invoice Register",
  buildDescriptor: getSalesInvoiceRegisterDescriptor,
});
registerReport({
  category: CATEGORY,
  key: "outstanding-invoice",
  title: "Outstanding Invoice",
  buildDescriptor: getOutstandingInvoiceDescriptor,
});
