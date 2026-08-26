import { prisma } from "@/core/db/client";
import type { ReportDescriptor } from "@/core/reports/report-types";
import { registerReport } from "./registry";
import { parseReportDateRange } from "./report-date-range";
import { round2 } from "@/lib/money";

const CATEGORY = "purchase" as const;

function filtersApplied(filters: Record<string, string>, labels: Record<string, string>) {
  return Object.entries(filters)
    .filter(([, v]) => v)
    .map(([k, v]) => ({ label: labels[k] ?? k, value: v }));
}

// ---------------------------------------------------------------------------
// 1. Purchase Order Register
// ---------------------------------------------------------------------------
async function getPurchaseOrderRegisterDescriptor(
  companyId: string,
  generatedByName: string,
  filters: Record<string, string>
): Promise<ReportDescriptor> {
  const { dateFrom, dateToExclusive } = parseReportDateRange(filters);
  const orders = await prisma.purchaseOrder.findMany({
    where: {
      companyId,
      ...(filters.supplierId ? { supplierId: filters.supplierId } : {}),
      ...(dateFrom || dateToExclusive ? { orderDate: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateToExclusive ? { lt: dateToExclusive } : {}) } } : {}),
    },
    select: { id: true, orderNumber: true, orderDate: true, status: true, baseTotalAmount: true, supplier: { select: { name: true } } },
    orderBy: { orderDate: "desc" },
  });

  const rows = orders.map((o) => ({
    purchaseOrderId: o.id,
    orderNumber: o.orderNumber,
    orderDate: o.orderDate,
    supplier: o.supplier.name,
    status: o.status,
    orderAmount: Number(o.baseTotalAmount),
  }));

  // Rows deliberately include every status (this register is the full audit
  // trail), but a CANCELLED order was never really purchased, so it must not
  // contribute to the totals row — otherwise this report's grand total
  // disagreed with Supplier-wise Purchase/Purchase Monthly Summary (both of
  // which already exclude cancelled orders) by exactly the cancelled orders'
  // combined amount (ERP-BUG-0002, Phase 10 QA pass).
  const realRows = rows.filter((r) => r.status !== "CANCELLED");

  return {
    title: "Purchase Order Register",
    subtitle: "Every Purchase Order matching the selected filters. Totals exclude cancelled orders.",
    filtersApplied: filtersApplied(filters, { dateFrom: "Date From", dateTo: "Date To", supplierId: "Supplier" }),
    columns: [
      { key: "orderNumber", label: "PO Number", linkTo: "purchaseOrder" },
      { key: "orderDate", label: "Order Date", type: "date" },
      { key: "supplier", label: "Supplier" },
      { key: "status", label: "Status" },
      { key: "orderAmount", label: "Order Amount", type: "currency", align: "right" },
    ],
    rows,
    totals: { orderAmount: round2(realRows.reduce((sum, r) => sum + r.orderAmount, 0)) },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ---------------------------------------------------------------------------
// 2. Pending Purchase Order — one row per open line, so ordered/received/
// pending quantities are meaningful.
// ---------------------------------------------------------------------------
const PENDING_PO_STATUSES = ["DRAFT", "APPROVED", "SENT_TO_SUPPLIER", "PARTIALLY_RECEIVED", "ON_HOLD"] as const;

async function getPendingPurchaseOrderDescriptor(
  companyId: string,
  generatedByName: string,
  filters: Record<string, string>
): Promise<ReportDescriptor> {
  const orders = await prisma.purchaseOrder.findMany({
    where: {
      companyId,
      status: { in: [...PENDING_PO_STATUSES] },
      ...(filters.supplierId ? { supplierId: filters.supplierId } : {}),
    },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      supplier: { select: { name: true } },
      items: {
        select: {
          orderedQuantity: true,
          receivedQuantity: true,
          product: { select: { styleName: true } },
        },
      },
    },
    orderBy: { orderDate: "desc" },
  });

  const rows: Record<string, unknown>[] = [];
  for (const o of orders) {
    for (const item of o.items) {
      const ordered = Number(item.orderedQuantity);
      const received = Number(item.receivedQuantity);
      const pending = ordered - received;
      if (pending <= 0.0001) continue;
      rows.push({
        purchaseOrderId: o.id,
        orderNumber: o.orderNumber,
        supplier: o.supplier.name,
        material: item.product.styleName,
        orderedQty: ordered,
        receivedQty: received,
        pendingQty: pending,
        status: o.status,
      });
    }
  }

  return {
    title: "Pending Purchase Order",
    subtitle: "Purchase Order lines not yet fully received.",
    filtersApplied: filtersApplied(filters, { supplierId: "Supplier" }),
    columns: [
      { key: "orderNumber", label: "PO Number", linkTo: "purchaseOrder" },
      { key: "supplier", label: "Supplier" },
      { key: "material", label: "Material" },
      { key: "orderedQty", label: "Ordered Qty", type: "number", align: "right" },
      { key: "receivedQty", label: "Received Qty", type: "number", align: "right" },
      { key: "pendingQty", label: "Pending Qty", type: "number", align: "right" },
      { key: "status", label: "Status" },
    ],
    rows,
    totals: {
      orderedQty: rows.reduce((s, r) => s + (r.orderedQty as number), 0),
      receivedQty: rows.reduce((s, r) => s + (r.receivedQty as number), 0),
      pendingQty: rows.reduce((s, r) => s + (r.pendingQty as number), 0),
    },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ---------------------------------------------------------------------------
// 3. Supplier-wise Purchase — aggregates PurchaseOrder.baseTotalAmount by
// supplier, excluding cancelled orders.
// ---------------------------------------------------------------------------
async function getSupplierWisePurchaseDescriptor(
  companyId: string,
  generatedByName: string,
  filters: Record<string, string>
): Promise<ReportDescriptor> {
  const { dateFrom, dateToExclusive } = parseReportDateRange(filters);
  const orders = await prisma.purchaseOrder.findMany({
    where: {
      companyId,
      status: { not: "CANCELLED" },
      ...(dateFrom || dateToExclusive ? { orderDate: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateToExclusive ? { lt: dateToExclusive } : {}) } } : {}),
    },
    select: { supplierId: true, baseTotalAmount: true, supplier: { select: { name: true } } },
  });

  const bySupplier = new Map<string, { supplier: string; orderCount: number; totalAmount: number }>();
  for (const o of orders) {
    const existing = bySupplier.get(o.supplierId) ?? { supplier: o.supplier.name, orderCount: 0, totalAmount: 0 };
    existing.orderCount += 1;
    existing.totalAmount = round2(existing.totalAmount + Number(o.baseTotalAmount));
    bySupplier.set(o.supplierId, existing);
  }

  const rows = [...bySupplier.values()].sort((a, b) => b.totalAmount - a.totalAmount);

  return {
    title: "Supplier-wise Purchase",
    subtitle: "Purchase Order totals grouped by supplier (excludes cancelled orders).",
    filtersApplied: filtersApplied(filters, { dateFrom: "Date From", dateTo: "Date To" }),
    columns: [
      { key: "supplier", label: "Supplier" },
      { key: "orderCount", label: "Order Count", type: "number", align: "right" },
      { key: "totalAmount", label: "Total Amount", type: "currency", align: "right" },
    ],
    rows,
    totals: {
      orderCount: rows.reduce((s, r) => s + r.orderCount, 0),
      totalAmount: round2(rows.reduce((s, r) => s + r.totalAmount, 0)),
    },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ---------------------------------------------------------------------------
// 4. Purchase Monthly Summary — grouped by calendar month across the
// filtered date range (default: no filter = all data).
// ---------------------------------------------------------------------------
async function getPurchaseMonthlySummaryDescriptor(
  companyId: string,
  generatedByName: string,
  filters: Record<string, string>
): Promise<ReportDescriptor> {
  const { dateFrom, dateToExclusive } = parseReportDateRange(filters);
  const orders = await prisma.purchaseOrder.findMany({
    where: {
      companyId,
      status: { not: "CANCELLED" },
      ...(dateFrom || dateToExclusive ? { orderDate: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateToExclusive ? { lt: dateToExclusive } : {}) } } : {}),
    },
    select: { orderDate: true, baseTotalAmount: true },
  });

  const byMonth = new Map<string, { month: string; orderCount: number; totalAmount: number }>();
  for (const o of orders) {
    const month = o.orderDate.toISOString().slice(0, 7);
    const existing = byMonth.get(month) ?? { month, orderCount: 0, totalAmount: 0 };
    existing.orderCount += 1;
    existing.totalAmount = round2(existing.totalAmount + Number(o.baseTotalAmount));
    byMonth.set(month, existing);
  }

  const rows = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));

  return {
    title: "Purchase Monthly Summary",
    subtitle: "Non-cancelled Purchase Orders grouped by calendar month.",
    filtersApplied: filtersApplied(filters, { dateFrom: "Date From", dateTo: "Date To" }),
    columns: [
      { key: "month", label: "Month" },
      { key: "orderCount", label: "Order Count", type: "number", align: "right" },
      { key: "totalAmount", label: "Total Amount", type: "currency", align: "right" },
    ],
    rows,
    totals: {
      orderCount: rows.reduce((s, r) => s + r.orderCount, 0),
      totalAmount: round2(rows.reduce((s, r) => s + r.totalAmount, 0)),
    },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ---------------------------------------------------------------------------
// 5. Purchase Price Comparison — one row per PurchaseOrderItem line, sorted
// by material then unit price, so a buyer can visually compare what price
// was actually paid for the same raw material across different suppliers/
// orders. Straight from PurchaseOrderItem.unitPrice — never re-derived.
// ---------------------------------------------------------------------------
async function getPurchasePriceComparisonDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  const items = await prisma.purchaseOrderItem.findMany({
    where: {
      // PurchaseOrderItem has no own companyId column — scoped via the parent PurchaseOrder.
      purchaseOrder: { companyId, status: { not: "CANCELLED" } },
      ...(filters.materialId ? { productId: filters.materialId } : {}),
    },
    select: {
      unitPrice: true,
      product: { select: { styleCode: true, styleName: true } },
      uom: { select: { code: true } },
      purchaseOrder: { select: { id: true, orderNumber: true, orderDate: true, supplier: { select: { name: true } } } },
    },
  });

  const rows = items
    .map((item) => ({
      purchaseOrderId: item.purchaseOrder.id,
      material: `${item.product.styleCode} — ${item.product.styleName}`,
      supplier: item.purchaseOrder.supplier.name,
      orderNumber: item.purchaseOrder.orderNumber,
      orderDate: item.purchaseOrder.orderDate,
      unitPrice: Number(item.unitPrice),
      unit: item.uom.code,
    }))
    .sort((a, b) => a.material.localeCompare(b.material) || a.unitPrice - b.unitPrice);

  return {
    title: "Purchase Price Comparison",
    subtitle: "Unit price actually paid per material across every Purchase Order, sorted to make cross-supplier price variance visible.",
    filtersApplied: filtersApplied(filters, { materialId: "Material" }),
    columns: [
      { key: "material", label: "Material" },
      { key: "supplier", label: "Supplier" },
      { key: "orderNumber", label: "PO Number", linkTo: "purchaseOrder" },
      { key: "orderDate", label: "Order Date", type: "date" },
      { key: "unitPrice", label: "Unit Price", type: "currency", align: "right" },
      { key: "unit", label: "Unit" },
    ],
    rows,
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

registerReport({
  category: CATEGORY,
  key: "purchase-order-register",
  title: "Purchase Order Register",
  buildDescriptor: getPurchaseOrderRegisterDescriptor,
});
registerReport({
  category: CATEGORY,
  key: "pending-purchase-order",
  title: "Pending Purchase Order",
  buildDescriptor: getPendingPurchaseOrderDescriptor,
});
registerReport({
  category: CATEGORY,
  key: "supplier-wise-purchase",
  title: "Supplier-wise Purchase",
  buildDescriptor: getSupplierWisePurchaseDescriptor,
});
registerReport({
  category: CATEGORY,
  key: "purchase-monthly-summary",
  title: "Purchase Monthly Summary",
  buildDescriptor: getPurchaseMonthlySummaryDescriptor,
});
registerReport({
  category: CATEGORY,
  key: "purchase-price-comparison",
  title: "Purchase Price Comparison",
  buildDescriptor: getPurchasePriceComparisonDescriptor,
});
