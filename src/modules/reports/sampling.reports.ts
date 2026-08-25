import { prisma } from "@/core/db/client";
import type { ReportDescriptor } from "@/core/reports/report-types";
import { registerReport } from "./registry";

const CATEGORY = "sampling" as const;
const RAW_MATERIAL_CATEGORY = "sampling-raw-material" as const;

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
// 1. Sample Register
// ---------------------------------------------------------------------------
async function getSampleRegisterDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  const { dateFrom, dateTo } = parseDateRange(filters);
  const samples = await prisma.sampleRequest.findMany({
    where: {
      companyId,
      ...(filters.customerId ? { customerId: filters.customerId } : {}),
      ...(filters.status ? { status: filters.status as never } : {}),
      ...(dateFrom || dateTo ? { requestDate: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } } : {}),
    },
    select: {
      id: true,
      requestNumber: true,
      requestDate: true,
      styleName: true,
      sampleType: true,
      status: true,
      customer: { select: { name: true } },
      product: { select: { styleName: true } },
    },
    orderBy: { requestDate: "desc" },
  });

  const rows = samples.map((s) => ({
    sampleRequestId: s.id,
    requestNumber: s.requestNumber,
    requestDate: s.requestDate,
    customer: s.customer.name,
    styleName: s.styleName ?? s.product?.styleName ?? "—",
    sampleType: s.sampleType ?? "—",
    status: s.status,
  }));

  return {
    title: "Sample Register",
    subtitle: "Every Sample Request matching the selected filters.",
    filtersApplied: filtersApplied(filters, { dateFrom: "Date From", dateTo: "Date To", customerId: "Customer", status: "Status" }),
    columns: [
      { key: "requestNumber", label: "Request Number", linkTo: "sampleRequest" },
      { key: "requestDate", label: "Request Date", type: "date" },
      { key: "customer", label: "Customer" },
      { key: "styleName", label: "Style Name" },
      { key: "sampleType", label: "Sample Type" },
      { key: "status", label: "Status" },
    ],
    rows,
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ---------------------------------------------------------------------------
// 2. Sample Status Report — every SampleRequest grouped by status.
// ---------------------------------------------------------------------------
async function getSampleStatusReportDescriptor(companyId: string, generatedByName: string): Promise<ReportDescriptor> {
  const samples = await prisma.sampleRequest.findMany({
    where: { companyId },
    select: { status: true },
  });

  const byStatus = new Map<string, number>();
  for (const s of samples) {
    byStatus.set(s.status, (byStatus.get(s.status) ?? 0) + 1);
  }

  const rows = [...byStatus.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);

  return {
    title: "Sample Status Report",
    subtitle: "All Sample Requests grouped by current status.",
    filtersApplied: [],
    columns: [
      { key: "status", label: "Status" },
      { key: "count", label: "Count", type: "number", align: "right" },
    ],
    rows,
    totals: { count: rows.reduce((s, r) => s + r.count, 0) },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ---------------------------------------------------------------------------
// 3. Sample Conversion Report — per customer, how many samples actually
// graduated into a real Style master via "Convert to Style" (productId set
// AND status APPROVED), out of total samples raised.
// ---------------------------------------------------------------------------
async function getSampleConversionReportDescriptor(companyId: string, generatedByName: string): Promise<ReportDescriptor> {
  const samples = await prisma.sampleRequest.findMany({
    where: { companyId },
    select: { customerId: true, status: true, productId: true, customer: { select: { name: true } } },
  });

  const byCustomer = new Map<
    string,
    { customerId: string; customer: string; totalSamples: number; approvedSamples: number; convertedSamples: number }
  >();

  for (const s of samples) {
    const existing =
      byCustomer.get(s.customerId) ?? { customerId: s.customerId, customer: s.customer.name, totalSamples: 0, approvedSamples: 0, convertedSamples: 0 };
    existing.totalSamples += 1;
    if (s.status === "APPROVED") {
      existing.approvedSamples += 1;
      if (s.productId) existing.convertedSamples += 1;
    }
    byCustomer.set(s.customerId, existing);
  }

  const rows = [...byCustomer.values()]
    .map((c) => ({
      ...c,
      conversionRatePercent: c.totalSamples > 0 ? Math.round((c.convertedSamples / c.totalSamples) * 10000) / 100 : 0,
    }))
    .sort((a, b) => b.conversionRatePercent - a.conversionRatePercent);

  const totalSamples = rows.reduce((s, r) => s + r.totalSamples, 0);
  const approvedSamples = rows.reduce((s, r) => s + r.approvedSamples, 0);
  const convertedSamples = rows.reduce((s, r) => s + r.convertedSamples, 0);

  return {
    title: "Sample Conversion Report",
    subtitle: "Per customer: how many raised samples were actually converted into a real Style master (via Convert to Style).",
    filtersApplied: [],
    columns: [
      { key: "customer", label: "Customer" },
      { key: "totalSamples", label: "Total Samples", type: "number", align: "right" },
      { key: "approvedSamples", label: "Approved Samples", type: "number", align: "right" },
      { key: "convertedSamples", label: "Converted Samples", type: "number", align: "right" },
      { key: "conversionRatePercent", label: "Conversion Rate %", type: "percent", align: "right" },
    ],
    rows,
    totals: {
      totalSamples,
      approvedSamples,
      convertedSamples,
      conversionRatePercent: totalSamples > 0 ? Math.round((convertedSamples / totalSamples) * 10000) / 100 : 0,
    },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ---------------------------------------------------------------------------
// 4. Sample Material Requirement — one row per SampleMaterial, across all of
// the company's sample versions.
// ---------------------------------------------------------------------------
async function getSampleMaterialRequirementDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  const { dateFrom, dateTo } = parseDateRange(filters);
  const materials = await prisma.sampleMaterial.findMany({
    where: {
      sampleVersion: {
        sampleRequest: {
          companyId,
          ...(dateFrom || dateTo ? { requestDate: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } } : {}),
        },
      },
    },
    select: {
      id: true,
      plannedQuantity: true,
      damagedQuantity: true,
      damageReason: true,
      uom: { select: { name: true, code: true } },
      material: { select: { styleName: true } },
      sampleVersion: { select: { sampleRequest: { select: { id: true, requestNumber: true } } } },
    },
    orderBy: { id: "desc" },
  });

  const rows = materials.map((m) => ({
    sampleRequestId: m.sampleVersion.sampleRequest.id,
    requestNumber: m.sampleVersion.sampleRequest.requestNumber,
    material: m.material.styleName,
    plannedQuantity: Number(m.plannedQuantity),
    unit: m.uom?.name ?? m.uom?.code ?? "—",
    damagedQuantity: m.damagedQuantity !== null ? Number(m.damagedQuantity) : null,
    damageReason: m.damageReason ?? "—",
  }));

  return {
    title: "Sample Material Requirement",
    subtitle:
      "Only planned and damaged quantities are tracked for sample materials — issue/return/consumption tracking does not exist in this ERP's schema yet.",
    filtersApplied: filtersApplied(filters, { dateFrom: "Date From", dateTo: "Date To" }),
    columns: [
      { key: "requestNumber", label: "Request Number", linkTo: "sampleRequest" },
      { key: "material", label: "Material" },
      { key: "plannedQuantity", label: "Planned Quantity", type: "number", align: "right" },
      { key: "unit", label: "Unit" },
      { key: "damagedQuantity", label: "Damaged Quantity", type: "number", align: "right" },
      { key: "damageReason", label: "Damage Reason" },
    ],
    rows,
    totals: {
      plannedQuantity: rows.reduce((s, r) => s + r.plannedQuantity, 0),
      damagedQuantity: rows.reduce((s, r) => s + (r.damagedQuantity ?? 0), 0),
    },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

registerReport({ category: CATEGORY, key: "sample-register", title: "Sample Register", buildDescriptor: getSampleRegisterDescriptor });
registerReport({ category: CATEGORY, key: "sample-status-report", title: "Sample Status Report", buildDescriptor: getSampleStatusReportDescriptor });
registerReport({
  category: CATEGORY,
  key: "sample-conversion-report",
  title: "Sample Conversion Report",
  buildDescriptor: getSampleConversionReportDescriptor,
});
registerReport({
  category: RAW_MATERIAL_CATEGORY,
  key: "sample-material-requirement",
  title: "Sample Material Requirement",
  buildDescriptor: getSampleMaterialRequirementDescriptor,
  pdfOrientation: "landscape",
});
