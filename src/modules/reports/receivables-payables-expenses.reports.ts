import { prisma } from "@/core/db/client";
import type { ReportDescriptor } from "@/core/reports/report-types";
import { registerReport } from "./registry";
import { parseReportDateRange } from "./report-date-range";

function filtersApplied(filters: Record<string, string>, labels: Record<string, string>) {
  return Object.entries(filters)
    .filter(([, v]) => v)
    .map(([k, v]) => ({ label: labels[k] ?? k, value: v }));
}

/** Shared aging-bucket helper — reused by both the Receivables and Payables
 * aging reports below so the bucket boundaries can never silently drift
 * between the two. */
function ageBucket(daysOverdue: number): string {
  if (daysOverdue <= 0) return "Not Due";
  if (daysOverdue <= 30) return "1-30 days";
  if (daysOverdue <= 60) return "31-60 days";
  if (daysOverdue <= 90) return "61-90 days";
  return "90+ days";
}

// ===========================================================================
// Category: receivables
// ===========================================================================
const RECEIVABLES_CATEGORY = "receivables" as const;

async function getCustomerOutstandingAgingDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  const invoices = await prisma.salesInvoice.findMany({
    where: {
      companyId,
      status: { in: ["POSTED", "PARTIALLY_PAID"] },
      ...(filters.customerId ? { customerId: filters.customerId } : {}),
    },
    select: { id: true, invoiceNumber: true, invoiceDate: true, dueDate: true, totalAmount: true, paidAmount: true, customer: { select: { name: true } } },
  });

  const now = Date.now();
  const rows = invoices
    .map((inv) => {
      const outstanding = Number(inv.totalAmount) - Number(inv.paidAmount);
      const daysOverdue = Math.floor((now - inv.dueDate.getTime()) / 86400000);
      return {
        salesInvoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        customer: inv.customer.name,
        invoiceDate: inv.invoiceDate,
        dueDate: inv.dueDate,
        outstanding,
        daysOverdue,
        agingBucket: ageBucket(daysOverdue),
      };
    })
    .filter((r) => r.outstanding > 0.0001)
    .sort((a, b) => b.daysOverdue - a.daysOverdue);

  return {
    title: "Customer Outstanding / AR Aging",
    subtitle: "Per-invoice AR aging — same totalAmount − paidAmount source as every other outstanding report in this app.",
    filtersApplied: filtersApplied(filters, { customerId: "Customer" }),
    columns: [
      { key: "invoiceNumber", label: "Invoice Number", linkTo: "salesInvoice" },
      { key: "customer", label: "Customer" },
      { key: "invoiceDate", label: "Invoice Date", type: "date" },
      { key: "dueDate", label: "Due Date", type: "date" },
      { key: "outstanding", label: "Outstanding", type: "currency", align: "right" },
      { key: "daysOverdue", label: "Days Overdue", type: "number", align: "right" },
      { key: "agingBucket", label: "Aging Bucket" },
    ],
    rows,
    totals: { outstanding: rows.reduce((s, r) => s + r.outstanding, 0) },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

async function getCustomerLedgerDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  if (!filters.customerId) {
    return {
      title: "Customer Ledger",
      subtitle: "Select a customer to view their ledger.",
      filtersApplied: [],
      columns: [],
      rows: [],
      generatedAt: new Date().toISOString(),
      generatedByName,
      unavailableReason: "Select a customer to view their ledger.",
    };
  }

  const { dateFrom, dateToExclusive } = parseReportDateRange(filters);
  const [invoices, payments] = await Promise.all([
    prisma.salesInvoice.findMany({
      where: {
        companyId,
        customerId: filters.customerId,
        status: { not: "CANCELLED" },
        ...(dateFrom || dateToExclusive ? { invoiceDate: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateToExclusive ? { lt: dateToExclusive } : {}) } } : {}),
      },
      select: { invoiceNumber: true, invoiceDate: true, totalAmount: true },
    }),
    prisma.payment.findMany({
      where: {
        companyId,
        customerId: filters.customerId,
        direction: "RECEIPT",
        status: "POSTED",
        ...(dateFrom || dateToExclusive ? { paymentDate: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateToExclusive ? { lt: dateToExclusive } : {}) } } : {}),
      },
      select: { paymentNumber: true, paymentDate: true, amount: true },
    }),
  ]);

  interface LedgerEntry {
    date: Date;
    type: string;
    reference: string;
    amount: number;
  }
  const entries: LedgerEntry[] = [
    ...invoices.map((inv) => ({ date: inv.invoiceDate, type: "Invoice", reference: inv.invoiceNumber, amount: Number(inv.totalAmount) })),
    ...payments.map((p) => ({ date: p.paymentDate, type: "Payment", reference: p.paymentNumber, amount: -Number(p.amount) })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());

  // Rounded to currency precision on every step — summing many float amounts
  // otherwise leaves IEEE-754 noise (e.g. 1.8e-13 instead of exactly 0) that
  // renders fine in the on-screen currency-formatted table but shows up raw
  // and ugly in the CSV export, which prints the number as-is (matches the
  // same fix already applied to MRP's needed/available/shortfall quantities).
  let runningBalance = 0;
  const rows = entries.map((e) => {
    runningBalance = Math.round((runningBalance + e.amount) * 100) / 100;
    return { date: e.date, type: e.type, reference: e.reference, amount: e.amount, runningBalance };
  });

  return {
    title: "Customer Ledger",
    subtitle: "Invoices increase the balance; payments decrease it.",
    filtersApplied: filtersApplied(filters, { customerId: "Customer", dateFrom: "Date From", dateTo: "Date To" }),
    columns: [
      { key: "date", label: "Date", type: "date" },
      { key: "type", label: "Type" },
      { key: "reference", label: "Reference" },
      { key: "amount", label: "Amount", type: "currency", align: "right" },
      { key: "runningBalance", label: "Running Balance", type: "currency", align: "right" },
    ],
    rows,
    totals: { runningBalance },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

registerReport({
  category: RECEIVABLES_CATEGORY,
  key: "customer-outstanding",
  title: "Customer Outstanding / AR Aging",
  buildDescriptor: getCustomerOutstandingAgingDescriptor,
});
registerReport({ category: RECEIVABLES_CATEGORY, key: "customer-ledger", title: "Customer Ledger", buildDescriptor: getCustomerLedgerDescriptor });

// ===========================================================================
// Category: payables
// ===========================================================================
const PAYABLES_CATEGORY = "payables" as const;

async function getSupplierOutstandingAgingDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  const invoices = await prisma.purchaseInvoice.findMany({
    where: {
      companyId,
      status: { in: ["POSTED", "PARTIALLY_PAID"] },
      ...(filters.supplierId ? { supplierId: filters.supplierId } : {}),
    },
    select: { id: true, invoiceNumber: true, invoiceDate: true, dueDate: true, totalAmount: true, paidAmount: true, supplier: { select: { name: true } } },
  });

  const now = Date.now();
  const rows = invoices
    .map((inv) => {
      const outstanding = Number(inv.totalAmount) - Number(inv.paidAmount);
      const daysOverdue = Math.floor((now - inv.dueDate.getTime()) / 86400000);
      return {
        purchaseInvoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        supplier: inv.supplier.name,
        invoiceDate: inv.invoiceDate,
        dueDate: inv.dueDate,
        outstanding,
        daysOverdue,
        agingBucket: ageBucket(daysOverdue),
      };
    })
    .filter((r) => r.outstanding > 0.0001)
    .sort((a, b) => b.daysOverdue - a.daysOverdue);

  return {
    title: "Supplier Outstanding / AP Aging",
    subtitle: "Per-invoice AP aging — same totalAmount − paidAmount source as every other outstanding report in this app.",
    filtersApplied: filtersApplied(filters, { supplierId: "Supplier" }),
    columns: [
      { key: "invoiceNumber", label: "Invoice Number" },
      { key: "supplier", label: "Supplier" },
      { key: "invoiceDate", label: "Invoice Date", type: "date" },
      { key: "dueDate", label: "Due Date", type: "date" },
      { key: "outstanding", label: "Outstanding", type: "currency", align: "right" },
      { key: "daysOverdue", label: "Days Overdue", type: "number", align: "right" },
      { key: "agingBucket", label: "Aging Bucket" },
    ],
    rows,
    totals: { outstanding: rows.reduce((s, r) => s + r.outstanding, 0) },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

async function getPaymentMadeRegisterDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  const { dateFrom, dateToExclusive } = parseReportDateRange(filters);
  const payments = await prisma.payment.findMany({
    where: {
      companyId,
      direction: "PAYMENT_OUT",
      status: { not: "CANCELLED" },
      ...(filters.supplierId ? { supplierId: filters.supplierId } : {}),
      ...(dateFrom || dateToExclusive ? { paymentDate: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateToExclusive ? { lt: dateToExclusive } : {}) } } : {}),
    },
    select: {
      id: true,
      paymentNumber: true,
      paymentDate: true,
      referenceNumber: true,
      amount: true,
      status: true,
      supplier: { select: { name: true } },
    },
    orderBy: { paymentDate: "desc" },
  });

  const rows = payments.map((p) => ({
    paymentId: p.id,
    paymentNumber: p.paymentNumber,
    paymentDate: p.paymentDate,
    supplier: p.supplier?.name ?? "—",
    referenceNumber: p.referenceNumber ?? "—",
    amount: Number(p.amount),
    status: p.status,
  }));

  return {
    title: "Payment Made Register",
    subtitle: "Payments made to suppliers (PAYMENT_OUT direction).",
    filtersApplied: filtersApplied(filters, { dateFrom: "Date From", dateTo: "Date To", supplierId: "Supplier" }),
    columns: [
      { key: "paymentNumber", label: "Payment Number", linkTo: "payment" },
      { key: "paymentDate", label: "Payment Date", type: "date" },
      { key: "supplier", label: "Supplier" },
      { key: "referenceNumber", label: "Reference Number" },
      { key: "amount", label: "Amount", type: "currency", align: "right" },
      { key: "status", label: "Status" },
    ],
    rows,
    totals: { amount: rows.reduce((s, r) => s + r.amount, 0) },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

registerReport({
  category: PAYABLES_CATEGORY,
  key: "supplier-outstanding",
  title: "Supplier Outstanding / AP Aging",
  buildDescriptor: getSupplierOutstandingAgingDescriptor,
});
registerReport({
  category: PAYABLES_CATEGORY,
  key: "payment-made-register",
  title: "Payment Made Register",
  buildDescriptor: getPaymentMadeRegisterDescriptor,
});

// ===========================================================================
// Category: expenses
// ===========================================================================
const EXPENSES_CATEGORY = "expenses" as const;

async function getExpenseRegisterDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  const { dateFrom, dateToExclusive } = parseReportDateRange(filters);
  const expenses = await prisma.expense.findMany({
    where: {
      companyId,
      status: { not: "CANCELLED" },
      ...(dateFrom || dateToExclusive ? { expenseDate: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateToExclusive ? { lt: dateToExclusive } : {}) } } : {}),
    },
    select: {
      id: true,
      expenseNumber: true,
      expenseDate: true,
      description: true,
      amount: true,
      taxAmount: true,
      totalAmount: true,
      status: true,
      account: { select: { code: true, name: true } },
      supplier: { select: { name: true } },
    },
    orderBy: { expenseDate: "desc" },
  });

  const rows = expenses.map((e) => ({
    expenseId: e.id,
    expenseNumber: e.expenseNumber,
    expenseDate: e.expenseDate,
    account: `${e.account.code} — ${e.account.name}`,
    supplier: e.supplier?.name ?? "—",
    description: e.description,
    amount: Number(e.amount),
    tax: Number(e.taxAmount),
    total: Number(e.totalAmount),
    status: e.status,
  }));

  return {
    title: "Expense Register",
    subtitle: "Every non-cancelled Expense matching the selected filters.",
    filtersApplied: filtersApplied(filters, { dateFrom: "Date From", dateTo: "Date To" }),
    columns: [
      { key: "expenseNumber", label: "Expense Number", linkTo: "expense" },
      { key: "expenseDate", label: "Expense Date", type: "date" },
      { key: "account", label: "Account" },
      { key: "supplier", label: "Supplier" },
      { key: "description", label: "Description" },
      { key: "amount", label: "Amount", type: "currency", align: "right" },
      { key: "tax", label: "Tax", type: "currency", align: "right" },
      { key: "total", label: "Total", type: "currency", align: "right" },
      { key: "status", label: "Status" },
    ],
    rows,
    totals: {
      amount: rows.reduce((s, r) => s + r.amount, 0),
      tax: rows.reduce((s, r) => s + r.tax, 0),
      total: rows.reduce((s, r) => s + r.total, 0),
    },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

registerReport({ category: EXPENSES_CATEGORY, key: "expense-register", title: "Expense Register", buildDescriptor: getExpenseRegisterDescriptor });
