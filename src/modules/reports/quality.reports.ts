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

registerReport({
  category: CATEGORY,
  key: "qc-inspection-register",
  title: "QC Inspection Register",
  buildDescriptor: getQcInspectionRegisterDescriptor,
});
registerReport({ category: CATEGORY, key: "defect-wise-analysis", title: "Defect-wise Analysis", buildDescriptor: getDefectWiseAnalysisDescriptor });
