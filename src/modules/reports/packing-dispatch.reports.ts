import { prisma } from "@/core/db/client";
import type { ReportDescriptor } from "@/core/reports/report-types";
import { registerReport } from "./registry";
import { parseReportDateRange } from "./report-date-range";
import { validateStatusFilter } from "./report-filters";
import { DispatchStatus } from "@prisma/client";

function filtersApplied(filters: Record<string, string>, labels: Record<string, string>) {
  return Object.entries(filters)
    .filter(([, v]) => v)
    .map(([k, v]) => ({ label: labels[k] ?? k, value: v }));
}

// ===========================================================================
// Category: packing
// ===========================================================================
const PACKING_CATEGORY = "packing" as const;

// ---------------------------------------------------------------------------
// 1. Carton Summary — one row per Carton, filterable by the carton's own
// createdAt date.
// ---------------------------------------------------------------------------
async function getCartonSummaryDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  const { dateFrom, dateToExclusive } = parseReportDateRange(filters);
  const cartons = await prisma.carton.findMany({
    where: {
      dispatch: { companyId },
      ...(dateFrom || dateToExclusive ? { createdAt: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateToExclusive ? { lt: dateToExclusive } : {}) } } : {}),
    },
    select: {
      id: true,
      cartonNumber: true,
      totalQuantity: true,
      createdAt: true,
      dispatch: { select: { id: true, dispatchNumber: true, customer: { select: { name: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  const rows = cartons.map((c) => ({
    dispatchId: c.dispatch.id,
    cartonNumber: c.cartonNumber,
    dispatchNumber: c.dispatch.dispatchNumber,
    customer: c.dispatch.customer.name,
    totalQuantity: c.totalQuantity,
    createdAt: c.createdAt,
  }));

  return {
    title: "Carton Summary",
    // Includes cartons from every Dispatch status, including CANCELLED —
    // packing genuinely happened even if the dispatch was later cancelled,
    // and this is a packing-composition record, not a shipped-quantity one
    // (that's Customer-wise Dispatch's job, scoped to DISPATCHED/DELIVERED
    // only). Called out explicitly since the two totals won't match and
    // that's by design, not a bug (Phase 10 QA pass).
    subtitle: "Every Carton packed, matching the selected filters — includes cartons from cancelled dispatches; see Customer-wise Dispatch for shipped-only quantities.",
    filtersApplied: filtersApplied(filters, { dateFrom: "Date From", dateTo: "Date To" }),
    columns: [
      { key: "cartonNumber", label: "Carton Number", type: "number" },
      { key: "dispatchNumber", label: "Dispatch Number", linkTo: "dispatch" },
      { key: "customer", label: "Customer" },
      { key: "totalQuantity", label: "Total Quantity", type: "number", align: "right" },
      { key: "createdAt", label: "Created Date", type: "date" },
    ],
    rows,
    totals: { totalQuantity: rows.reduce((s, r) => s + r.totalQuantity, 0) },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ---------------------------------------------------------------------------
// 2. Color-wise / Size-wise Packing — aggregates real CartonItem.quantity by
// (color, size) across every carton for the company. This is packing
// composition as actually packed, never a sales/revenue figure.
// ---------------------------------------------------------------------------
async function getColorSizePackingDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  const { dateFrom, dateToExclusive } = parseReportDateRange(filters);
  const cartonItems = await prisma.cartonItem.findMany({
    where: {
      carton: {
        dispatch: { companyId },
        ...(dateFrom || dateToExclusive ? { createdAt: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateToExclusive ? { lt: dateToExclusive } : {}) } } : {}),
      },
    },
    select: {
      quantity: true,
      productVariant: { select: { color: { select: { name: true } }, size: { select: { name: true } } } },
    },
  });

  const UNSPECIFIED = "Unspecified";
  const byColorSize = new Map<string, { color: string; size: string; totalQuantity: number }>();
  for (const item of cartonItems) {
    const color = item.productVariant?.color.name ?? UNSPECIFIED;
    const size = item.productVariant?.size.name ?? UNSPECIFIED;
    const key = `${color} ${size}`;
    const existing = byColorSize.get(key) ?? { color, size, totalQuantity: 0 };
    existing.totalQuantity += item.quantity;
    byColorSize.set(key, existing);
  }

  const rows = [...byColorSize.values()].sort((a, b) => b.totalQuantity - a.totalQuantity);

  return {
    title: "Color-wise / Size-wise Packing",
    subtitle: "Packing composition by color/size, as actually packed — not a sales or revenue figure. Includes cartons from cancelled dispatches, same scope as Carton Summary.",
    filtersApplied: filtersApplied(filters, { dateFrom: "Date From", dateTo: "Date To" }),
    columns: [
      { key: "color", label: "Color" },
      { key: "size", label: "Size" },
      { key: "totalQuantity", label: "Total Quantity", type: "number", align: "right" },
    ],
    rows,
    totals: { totalQuantity: rows.reduce((s, r) => s + r.totalQuantity, 0) },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ===========================================================================
// Category: dispatch
// ===========================================================================
const DISPATCH_CATEGORY = "dispatch" as const;

// ---------------------------------------------------------------------------
// 3. Dispatch Register — every Dispatch matching the selected filters.
// ---------------------------------------------------------------------------
async function getDispatchRegisterDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  const { dateFrom, dateToExclusive } = parseReportDateRange(filters);
  const dispatches = await prisma.dispatch.findMany({
    where: {
      companyId,
      ...(filters.customerId ? { customerId: filters.customerId } : {}),
      ...validateStatusFilter(filters, DispatchStatus),
      ...(dateFrom || dateToExclusive ? { dispatchDate: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateToExclusive ? { lt: dateToExclusive } : {}) } } : {}),
    },
    select: {
      id: true,
      dispatchNumber: true,
      dispatchDate: true,
      status: true,
      transporterName: true,
      vehicleNumber: true,
      customer: { select: { name: true } },
    },
    orderBy: { dispatchDate: "desc" },
  });

  const rows = dispatches.map((d) => ({
    dispatchId: d.id,
    dispatchNumber: d.dispatchNumber,
    dispatchDate: d.dispatchDate,
    customer: d.customer.name,
    status: d.status,
    transporter: d.transporterName ?? "—",
    vehicleNumber: d.vehicleNumber ?? "—",
  }));

  return {
    title: "Dispatch Register",
    subtitle: "Every Dispatch matching the selected filters.",
    filtersApplied: filtersApplied(filters, { dateFrom: "Date From", dateTo: "Date To", customerId: "Customer", status: "Status" }),
    columns: [
      { key: "dispatchNumber", label: "Dispatch Number", linkTo: "dispatch" },
      { key: "dispatchDate", label: "Dispatch Date", type: "date" },
      { key: "customer", label: "Customer" },
      { key: "status", label: "Status" },
      { key: "transporter", label: "Transporter" },
      { key: "vehicleNumber", label: "Vehicle Number" },
    ],
    rows,
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

const PENDING_DISPATCH_STATUSES = ["DRAFT", "PACKED", "ON_HOLD"] as const;

// ---------------------------------------------------------------------------
// 4. Pending Dispatch — not yet actually shipped.
// ---------------------------------------------------------------------------
async function getPendingDispatchDescriptor(companyId: string, generatedByName: string): Promise<ReportDescriptor> {
  const dispatches = await prisma.dispatch.findMany({
    where: { companyId, status: { in: [...PENDING_DISPATCH_STATUSES] } },
    select: {
      id: true,
      dispatchNumber: true,
      dispatchDate: true,
      status: true,
      customer: { select: { name: true } },
      salesOrder: { select: { orderNumber: true } },
    },
    orderBy: { dispatchDate: "asc" },
  });

  const rows = dispatches.map((d) => ({
    dispatchId: d.id,
    dispatchNumber: d.dispatchNumber,
    dispatchDate: d.dispatchDate,
    customer: d.customer.name,
    status: d.status,
    orderNumber: d.salesOrder.orderNumber,
  }));

  return {
    title: "Pending Dispatch",
    subtitle: "Dispatches not yet actually shipped (Draft, Packed, or On Hold).",
    filtersApplied: [],
    columns: [
      { key: "dispatchNumber", label: "Dispatch Number", linkTo: "dispatch" },
      { key: "dispatchDate", label: "Dispatch Date", type: "date" },
      { key: "customer", label: "Customer" },
      { key: "status", label: "Status" },
      { key: "orderNumber", label: "Order Number" },
    ],
    rows,
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ---------------------------------------------------------------------------
// 5. Customer-wise Dispatch — dispatch count + total dispatched quantity
// grouped by customer, excluding Cancelled dispatches.
// ---------------------------------------------------------------------------
async function getCustomerWiseDispatchDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  const { dateFrom, dateToExclusive } = parseReportDateRange(filters);
  const dispatches = await prisma.dispatch.findMany({
    where: {
      companyId,
      // DISPATCHED/DELIVERED only — matches the FG-stock-decrementing
      // definition of "dispatched" used everywhere else in this app.
      // `status: { not: "CANCELLED" }` also let DRAFT/PACKED dispatches
      // (never actually shipped, zero stock impact) count toward "Total
      // Dispatched Quantity", disagreeing with Pending Dispatch's own
      // DRAFT/PACKED scope for what's NOT yet dispatched (ERP-BUG-Q10-0003,
      // Phase 10 QA pass — confirmed live: an unconfirmed DRAFT dispatch's
      // quantity was counted as "dispatched").
      status: { in: ["DISPATCHED", "DELIVERED"] },
      ...(dateFrom || dateToExclusive ? { dispatchDate: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateToExclusive ? { lt: dateToExclusive } : {}) } } : {}),
    },
    select: {
      customerId: true,
      customer: { select: { name: true } },
      items: { select: { dispatchedQuantity: true, regularDispatchQuantity: true, extraDispatchQuantity: true } },
    },
  });

  const byCustomer = new Map<
    string,
    { customerId: string; customer: string; dispatchCount: number; totalDispatchedQuantity: number; totalRegularQuantity: number; totalExtraQuantity: number }
  >();
  for (const d of dispatches) {
    const existing =
      byCustomer.get(d.customerId) ??
      { customerId: d.customerId, customer: d.customer.name, dispatchCount: 0, totalDispatchedQuantity: 0, totalRegularQuantity: 0, totalExtraQuantity: 0 };
    existing.dispatchCount += 1;
    existing.totalDispatchedQuantity += d.items.reduce((s, i) => s + i.dispatchedQuantity, 0);
    // Extra Dispatch Quantity (2026-09-30) — reported separately so Extra
    // never gets mistaken for real Sale Order fulfillment; Total is still
    // shown as-is since it's the real physical FG-stock consumption figure.
    existing.totalRegularQuantity += d.items.reduce((s, i) => s + i.regularDispatchQuantity, 0);
    existing.totalExtraQuantity += d.items.reduce((s, i) => s + i.extraDispatchQuantity, 0);
    byCustomer.set(d.customerId, existing);
  }

  const rows = [...byCustomer.values()].sort((a, b) => b.totalDispatchedQuantity - a.totalDispatchedQuantity);

  return {
    title: "Customer-wise Dispatch",
    subtitle:
      "Dispatch count and total dispatched quantity grouped by customer — Dispatched/Delivered only, matching the FG-stock-decrementing definition of dispatched. Regular and Extra are shown separately; only Regular counts toward Sale Order fulfillment.",
    filtersApplied: filtersApplied(filters, { dateFrom: "Date From", dateTo: "Date To" }),
    columns: [
      { key: "customer", label: "Customer" },
      { key: "dispatchCount", label: "Dispatch Count", type: "number", align: "right" },
      { key: "totalRegularQuantity", label: "Regular Dispatched Qty", type: "number", align: "right" },
      { key: "totalExtraQuantity", label: "Extra Dispatched Qty", type: "number", align: "right" },
      { key: "totalDispatchedQuantity", label: "Total Physical Dispatched Qty", type: "number", align: "right" },
    ],
    rows,
    totals: {
      dispatchCount: rows.reduce((s, r) => s + r.dispatchCount, 0),
      totalRegularQuantity: rows.reduce((s, r) => s + r.totalRegularQuantity, 0),
      totalExtraQuantity: rows.reduce((s, r) => s + r.totalExtraQuantity, 0),
      totalDispatchedQuantity: rows.reduce((s, r) => s + r.totalDispatchedQuantity, 0),
    },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

registerReport({ category: PACKING_CATEGORY, key: "carton-summary", title: "Carton Summary", buildDescriptor: getCartonSummaryDescriptor });
registerReport({
  category: PACKING_CATEGORY,
  key: "color-size-packing",
  title: "Color-wise / Size-wise Packing",
  buildDescriptor: getColorSizePackingDescriptor,
});

registerReport({ category: DISPATCH_CATEGORY, key: "dispatch-register", title: "Dispatch Register", buildDescriptor: getDispatchRegisterDescriptor });
registerReport({ category: DISPATCH_CATEGORY, key: "pending-dispatch", title: "Pending Dispatch", buildDescriptor: getPendingDispatchDescriptor });
registerReport({
  category: DISPATCH_CATEGORY,
  key: "customer-wise-dispatch",
  title: "Customer-wise Dispatch",
  buildDescriptor: getCustomerWiseDispatchDescriptor,
});
