import { prisma } from "@/core/db/client";
import type { ReportDescriptor } from "@/core/reports/report-types";
import { registerReport } from "./registry";

const CATEGORY = "suppliers" as const;

function filtersApplied(filters: Record<string, string>, labels: Record<string, string>) {
  return Object.entries(filters)
    .filter(([, v]) => v)
    .map(([k, v]) => ({ label: labels[k] ?? k, value: v }));
}

// ---------------------------------------------------------------------------
// 1. Supplier Register
// ---------------------------------------------------------------------------
async function getSupplierRegisterDescriptor(
  companyId: string,
  generatedByName: string,
  filters: Record<string, string>
): Promise<ReportDescriptor> {
  const suppliers = await prisma.supplier.findMany({
    where: {
      companyId,
      ...(filters.status ? { isActive: filters.status === "true" } : {}),
    },
    select: {
      id: true,
      code: true,
      name: true,
      category: true,
      contactPerson: true,
      phone: true,
      paymentTermsDays: true,
      isActive: true,
    },
    orderBy: { name: "asc" },
  });

  const rows = suppliers.map((s) => ({
    supplierId: s.id,
    code: s.code,
    name: s.name,
    category: s.category,
    contactPerson: s.contactPerson ?? "—",
    phone: s.phone ?? "—",
    paymentTermsDays: s.paymentTermsDays,
    status: s.isActive ? "Active" : "Inactive",
  }));

  return {
    title: "Supplier Register",
    subtitle: "All suppliers matching the selected filters.",
    filtersApplied: filtersApplied(filters, { status: "Status" }),
    columns: [
      { key: "code", label: "Code" },
      { key: "name", label: "Name", linkTo: "supplier" },
      { key: "category", label: "Category" },
      { key: "contactPerson", label: "Contact Person" },
      { key: "phone", label: "Phone" },
      { key: "paymentTermsDays", label: "Payment Terms (days)", type: "number", align: "right" },
      { key: "status", label: "Status" },
    ],
    rows,
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ---------------------------------------------------------------------------
// 2. Supplier Outstanding — AP aging from posted/partially-paid Purchase
// Invoices.
// ---------------------------------------------------------------------------
function agingBucket(daysOverdue: number): string {
  if (daysOverdue <= 0) return "Not Due";
  if (daysOverdue <= 30) return "1-30 days";
  if (daysOverdue <= 60) return "31-60 days";
  if (daysOverdue <= 90) return "61-90 days";
  return "90+ days";
}

async function getSupplierOutstandingDescriptor(
  companyId: string,
  generatedByName: string,
  filters: Record<string, string>
): Promise<ReportDescriptor> {
  const invoices = await prisma.purchaseInvoice.findMany({
    where: {
      companyId,
      status: { in: ["POSTED", "PARTIALLY_PAID"] },
      ...(filters.supplierId ? { supplierId: filters.supplierId } : {}),
    },
    select: {
      id: true,
      invoiceNumber: true,
      invoiceDate: true,
      dueDate: true,
      totalAmount: true,
      paidAmount: true,
      supplier: { select: { name: true } },
    },
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
        outstandingAmount: outstanding,
        daysOverdue,
        agingBucket: agingBucket(daysOverdue),
      };
    })
    .filter((r) => r.outstandingAmount > 0.0001)
    .sort((a, b) => b.daysOverdue - a.daysOverdue);

  return {
    title: "Supplier Outstanding",
    subtitle: "AP aging from posted/partially-paid Purchase Invoices.",
    filtersApplied: filtersApplied(filters, { supplierId: "Supplier" }),
    columns: [
      { key: "invoiceNumber", label: "Invoice Number" },
      { key: "supplier", label: "Supplier" },
      { key: "invoiceDate", label: "Invoice Date", type: "date" },
      { key: "dueDate", label: "Due Date", type: "date" },
      { key: "outstandingAmount", label: "Outstanding Amount", type: "currency", align: "right" },
      { key: "daysOverdue", label: "Days Overdue", type: "number", align: "right" },
      { key: "agingBucket", label: "Aging Bucket" },
    ],
    rows,
    totals: { outstandingAmount: rows.reduce((s, r) => s + r.outstandingAmount, 0) },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

registerReport({
  category: CATEGORY,
  key: "supplier-register",
  title: "Supplier Register",
  buildDescriptor: getSupplierRegisterDescriptor,
});
registerReport({
  category: CATEGORY,
  key: "supplier-outstanding",
  title: "Supplier Outstanding",
  buildDescriptor: getSupplierOutstandingDescriptor,
});
