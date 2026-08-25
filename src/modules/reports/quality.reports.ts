import { prisma } from "@/core/db/client";
import type { ReportDescriptor } from "@/core/reports/report-types";
import { registerReport } from "./registry";

const CATEGORY = "quality" as const;

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
// 1. QC Inspection Register — one row per QcInspection.
// ---------------------------------------------------------------------------
async function getQcInspectionRegisterDescriptor(
  companyId: string,
  generatedByName: string,
  filters: Record<string, string>
): Promise<ReportDescriptor> {
  const { dateFrom, dateTo } = parseDateRange(filters);
  const inspections = await prisma.qcInspection.findMany({
    where: {
      companyId,
      ...(dateFrom || dateTo ? { inspectedAt: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } } : {}),
    },
    select: {
      inspectedAt: true,
      inspectedQuantity: true,
      acceptedQuantity: true,
      rejectedQuantity: true,
      damagedQuantity: true,
      result: true,
      productionOrderId: true,
      productionOrder: { select: { orderNumber: true, product: { select: { styleName: true } } } },
      inspector: { select: { fullName: true } },
    },
    orderBy: { inspectedAt: "desc" },
  });

  const rows = inspections.map((qc) => ({
    productionOrderId: qc.productionOrderId,
    inspectedAt: qc.inspectedAt,
    orderNumber: qc.productionOrder.orderNumber,
    style: qc.productionOrder.product.styleName,
    inspectedQty: Number(qc.inspectedQuantity),
    acceptedQty: Number(qc.acceptedQuantity),
    rejectedQty: Number(qc.rejectedQuantity),
    damagedQty: Number(qc.damagedQuantity),
    result: qc.result,
    inspector: qc.inspector.fullName,
  }));

  return {
    title: "QC Inspection Register",
    subtitle: "Every QC Inspection matching the selected filters.",
    filtersApplied: filtersApplied(filters, { dateFrom: "Date From", dateTo: "Date To" }),
    columns: [
      { key: "inspectedAt", label: "Date", type: "date" },
      { key: "orderNumber", label: "Production Order Number", linkTo: "productionOrder" },
      { key: "style", label: "Style" },
      { key: "inspectedQty", label: "Inspected Qty", type: "number", align: "right" },
      { key: "acceptedQty", label: "Accepted Qty", type: "number", align: "right" },
      { key: "rejectedQty", label: "Rejected Qty", type: "number", align: "right" },
      { key: "damagedQty", label: "Damaged Qty", type: "number", align: "right" },
      { key: "result", label: "Result" },
      { key: "inspector", label: "Inspector" },
    ],
    rows,
    totals: {
      inspectedQty: rows.reduce((s, r) => s + r.inspectedQty, 0),
      acceptedQty: rows.reduce((s, r) => s + r.acceptedQty, 0),
      rejectedQty: rows.reduce((s, r) => s + r.rejectedQty, 0),
      damagedQty: rows.reduce((s, r) => s + r.damagedQty, 0),
    },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ---------------------------------------------------------------------------
// 2. Defect-wise Analysis — QcDefect.quantity aggregated by defect type,
// filtered by the parent QcInspection's inspectedAt via a nested relation
// filter.
// ---------------------------------------------------------------------------
async function getDefectWiseAnalysisDescriptor(
  companyId: string,
  generatedByName: string,
  filters: Record<string, string>
): Promise<ReportDescriptor> {
  const { dateFrom, dateTo } = parseDateRange(filters);
  const defects = await prisma.qcDefect.findMany({
    where: {
      qcInspection: {
        companyId,
        ...(dateFrom || dateTo ? { inspectedAt: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } } : {}),
      },
    },
    select: { quantity: true, defectType: { select: { name: true } } },
  });

  const byDefectType = new Map<string, { defectType: string; occurrenceCount: number; totalQuantity: number }>();
  for (const d of defects) {
    const existing = byDefectType.get(d.defectType.name) ?? { defectType: d.defectType.name, occurrenceCount: 0, totalQuantity: 0 };
    existing.occurrenceCount += 1;
    existing.totalQuantity += Number(d.quantity);
    byDefectType.set(d.defectType.name, existing);
  }

  const rows = [...byDefectType.values()].sort((a, b) => b.totalQuantity - a.totalQuantity);

  return {
    title: "Defect-wise Analysis",
    subtitle: "QC defect quantities aggregated by defect type.",
    filtersApplied: filtersApplied(filters, { dateFrom: "Date From", dateTo: "Date To" }),
    columns: [
      { key: "defectType", label: "Defect Type" },
      { key: "occurrenceCount", label: "Occurrence Count", type: "number", align: "right" },
      { key: "totalQuantity", label: "Total Quantity", type: "number", align: "right" },
    ],
    rows,
    totals: {
      occurrenceCount: rows.reduce((s, r) => s + r.occurrenceCount, 0),
      totalQuantity: rows.reduce((s, r) => s + r.totalQuantity, 0),
    },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ---------------------------------------------------------------------------
// 3. Rework Report — every ProductionStageTransaction of type REWORK, the
// append-only ledger's own explicit marker for a lot sent back for correction
// (never re-derived from `isBackward`/quantity heuristics).
// ---------------------------------------------------------------------------
async function getReworkReportDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  const { dateFrom, dateTo } = parseDateRange(filters);
  const transactions = await prisma.productionStageTransaction.findMany({
    where: {
      companyId,
      transactionType: "REWORK",
      ...(dateFrom || dateTo ? { performedAt: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } } : {}),
    },
    select: {
      performedAt: true,
      quantity: true,
      revertReason: true,
      productionOrderId: true,
      productionOrder: { select: { orderNumber: true, product: { select: { styleName: true } } } },
      lot: { select: { lotNumber: true } },
      fromProductionStage: { select: { name: true } },
      toProductionStage: { select: { name: true } },
      performedBy: { select: { fullName: true } },
    },
    orderBy: { performedAt: "desc" },
  });

  const rows = transactions.map((t) => ({
    productionOrderId: t.productionOrderId,
    performedAt: t.performedAt,
    orderNumber: t.productionOrder.orderNumber,
    style: t.productionOrder.product.styleName,
    lotNumber: t.lot.lotNumber,
    fromStage: t.fromProductionStage?.name ?? "—",
    toStage: t.toProductionStage.name,
    quantity: Number(t.quantity),
    revertReason: t.revertReason ?? "—",
    performedBy: t.performedBy.fullName,
  }));

  return {
    title: "Rework Report",
    subtitle: "Every lot sent backward to an earlier stage for rework, from the production stage-transaction ledger.",
    filtersApplied: filtersApplied(filters, { dateFrom: "Date From", dateTo: "Date To" }),
    columns: [
      { key: "performedAt", label: "Date", type: "date" },
      { key: "orderNumber", label: "Production Order Number", linkTo: "productionOrder" },
      { key: "style", label: "Style" },
      { key: "lotNumber", label: "Lot Number" },
      { key: "fromStage", label: "From Stage" },
      { key: "toStage", label: "To Stage" },
      { key: "quantity", label: "Quantity", type: "number", align: "right" },
      { key: "revertReason", label: "Revert Reason" },
      { key: "performedBy", label: "Performed By" },
    ],
    rows,
    totals: { quantity: rows.reduce((s, r) => s + r.quantity, 0) },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

registerReport({
  category: CATEGORY,
  key: "qc-inspection-register",
  title: "QC Inspection Register",
  buildDescriptor: getQcInspectionRegisterDescriptor,
});
registerReport({ category: CATEGORY, key: "defect-wise-analysis", title: "Defect-wise Analysis", buildDescriptor: getDefectWiseAnalysisDescriptor });
registerReport({ category: CATEGORY, key: "rework-report", title: "Rework Report", buildDescriptor: getReworkReportDescriptor });
