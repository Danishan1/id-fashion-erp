import { QuotationStatus } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import type { ReportDescriptor } from "@/core/reports/report-types";
import { toIsoDate, todayIsoDate } from "@/lib/date";
import { round2 } from "@/lib/money";
import { getSalesEnquiryScope, scopedWhere as enquiryScopedWhere } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { ENQUIRY_SOURCES, SALES_ENQUIRY_STAGES, SALES_ENQUIRY_STAGE_KEYS, type SalesEnquiryStage } from "@/modules/sales-marketing/enquiries/sales-enquiry-registry";
import { getQuotationScope, scopedWhere as quotationScopedWhere } from "@/modules/sales-marketing/quotations/quotation.service";
import { QUOTATION_STATUSES } from "@/modules/sales-marketing/quotations/quotation-registry";
import { registerReport, type ReportViewer } from "./registry";
import { parseReportDateRange } from "./report-date-range";

/**
 * Sales & Marketing reports (Release 1 / S6, 2026-11-02). Each one shows only
 * records the viewer can see (the same rule as the enquiry / quotation lists),
 * which is why these builders take the viewer. Order details in the
 * conversion report are shown only to people who can view Sales Orders.
 */

const CATEGORY = "sales-marketing" as const;
const MAX_ROWS = 5000;

function filtersApplied(filters: Record<string, string>, labels: Record<string, string>) {
  return Object.entries(filters)
    .filter(([k, v]) => v && labels[k])
    .map(([k, v]) => ({ label: labels[k], value: v }));
}

const actorOf = (companyId: string, viewer: ReportViewer) => ({ companyId, userId: viewer.userId, branchId: null });
const uuid = (v: string | undefined, field: string) => {
  if (!v) return undefined;
  if (!/^[0-9a-f-]{36}$/i.test(v)) throw new BusinessRuleError("VALIDATION_ERROR", `"${v}" is not a valid ${field}.`, { field });
  return v;
};

// ── 1. Enquiry Register ──────────────────────────────────────────

async function getEnquiryRegisterDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>, viewer: ReportViewer): Promise<ReportDescriptor> {
  const actor = actorOf(companyId, viewer);
  const { dateFrom, dateToExclusive } = parseReportDateRange(filters);
  if (filters.stage && !(SALES_ENQUIRY_STAGE_KEYS as readonly string[]).includes(filters.stage)) {
    throw new BusinessRuleError("VALIDATION_ERROR", `"${filters.stage}" is not a valid stage.`, { field: "stage" });
  }
  const scope = await getSalesEnquiryScope(actor);
  const where = enquiryScopedWhere(actor, scope, {
    ...(dateFrom || dateToExclusive ? { enquiryDate: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateToExclusive ? { lt: dateToExclusive } : {}) } } : {}),
    ...(filters.stage ? { salesStage: filters.stage as SalesEnquiryStage } : {}),
    ...(filters.customerId ? { customerId: uuid(filters.customerId, "customer") } : {}),
    ...(filters.ownerUserId ? { ownerUserId: uuid(filters.ownerUserId, "owner") } : {}),
  });
  const [rows, totalCount] = await Promise.all([
    prisma.buyerEnquiry.findMany({
      where,
      select: {
        id: true,
        enquiryNumber: true,
        enquiryDate: true,
        subject: true,
        source: true,
        priority: true,
        salesStage: true,
        status: true,
        nextFollowUpDate: true,
        prospectName: true,
        customer: { select: { name: true } },
        owner: { select: { fullName: true } },
        _count: { select: { lines: true, quotations: true } },
      },
      orderBy: [{ enquiryDate: "desc" }, { enquiryNumber: "desc" }],
      take: MAX_ROWS,
    }),
    prisma.buyerEnquiry.count({ where }),
  ]);
  const today = todayIsoDate();
  const data = rows.map((e) => {
    const closed = SALES_ENQUIRY_STAGES[e.salesStage].closed;
    const followUp = e.nextFollowUpDate ? toIsoDate(e.nextFollowUpDate) : null;
    return {
      enquiryId: e.id,
      enquiryNumber: e.enquiryNumber,
      enquiryDate: e.enquiryDate,
      party: e.customer?.name ?? (e.prospectName ? `${e.prospectName} (prospect)` : "—"),
      subject: e.subject ?? "—",
      source: e.source ? (ENQUIRY_SOURCES[e.source as keyof typeof ENQUIRY_SOURCES] ?? e.source) : "—",
      owner: e.owner?.fullName ?? "Unassigned",
      priority: e.priority,
      stage: SALES_ENQUIRY_STAGES[e.salesStage].label + (e.status === "CANCELLED" ? " (cancelled)" : ""),
      nextFollowUp: e.nextFollowUpDate,
      overdue: followUp && followUp < today && !closed && e.status !== "CANCELLED" ? "Overdue" : "",
      lines: e._count.lines,
      quotations: e._count.quotations,
    };
  });
  return {
    title: "Enquiry Register",
    subtitle: `Sales enquiries you can see${totalCount > rows.length ? ` — first ${rows.length} of ${totalCount}; narrow the filters` : ""}.`,
    filtersApplied: filtersApplied(filters, { dateFrom: "Date From", dateTo: "Date To", stage: "Stage", customerId: "Customer", ownerUserId: "Owner" }),
    columns: [
      { key: "enquiryNumber", label: "Enquiry", linkTo: "enquiry" },
      { key: "enquiryDate", label: "Date", type: "date" },
      { key: "party", label: "Customer / prospect" },
      { key: "subject", label: "Subject" },
      { key: "source", label: "Source" },
      { key: "owner", label: "Owner" },
      { key: "priority", label: "Priority" },
      { key: "stage", label: "Stage" },
      { key: "nextFollowUp", label: "Next follow-up", type: "date" },
      { key: "overdue", label: "" },
      { key: "lines", label: "Lines", type: "number", align: "right" },
      { key: "quotations", label: "Quotations", type: "number", align: "right" },
    ],
    rows: data,
    totals: { enquiryNumber: `${totalCount} enquiries`, quotations: data.reduce((s, r) => s + r.quotations, 0) },
    meta: { page: 1, pageSize: data.length, totalCount },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ── 2. Quotation Register ────────────────────────────────────────

const QUOTATION_STATUS_FILTERS = [...Object.values(QuotationStatus), "EXPIRED"] as string[];

async function getQuotationRegisterDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>, viewer: ReportViewer): Promise<ReportDescriptor> {
  const actor = actorOf(companyId, viewer);
  if (filters.status && !QUOTATION_STATUS_FILTERS.includes(filters.status)) {
    throw new BusinessRuleError("VALIDATION_ERROR", `"${filters.status}" is not a valid status. Expected one of: ${QUOTATION_STATUS_FILTERS.join(", ")}.`, { field: "status" });
  }
  const from = filters.dateFrom || null;
  const to = filters.dateTo || null;
  const scope = await getQuotationScope(actor);
  const status = filters.status === "EXPIRED" ? "ISSUED" : (filters.status as QuotationStatus | undefined);
  const rows = await prisma.quotation.findMany({
    where: quotationScopedWhere(actor, scope, {
      ...(status ? { status } : {}),
      ...(filters.customerId ? { customerId: uuid(filters.customerId, "customer") } : {}),
      ...(filters.ownerUserId ? { ownerUserId: uuid(filters.ownerUserId, "owner") } : {}),
    }),
    select: {
      id: true,
      quotationNumber: true,
      status: true,
      prospectName: true,
      customer: { select: { name: true } },
      owner: { select: { fullName: true } },
      buyerEnquiry: { select: { enquiryNumber: true } },
      revisions: { orderBy: { revisionNumber: "desc" }, take: 1, select: { revisionNumber: true, title: true, quotationDate: true, validUntil: true, taxableTotal: true, taxTotal: true, grandTotal: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const today = todayIsoDate();
  const data = rows
    .map((q) => {
      const r = q.revisions[0];
      const qDate = r ? toIsoDate(r.quotationDate) : "";
      const expired = q.status === "ISSUED" && r && toIsoDate(r.validUntil) < today;
      return { q, r, qDate, expired };
    })
    .filter(({ qDate, expired }) => (!from || qDate >= from) && (!to || qDate <= to) && (filters.status !== "EXPIRED" || expired) && (filters.status !== "ISSUED" || !expired))
    .sort((a, b) => (a.qDate < b.qDate ? 1 : a.qDate > b.qDate ? -1 : b.q.quotationNumber.localeCompare(a.q.quotationNumber)));
  const shown = data.slice(0, MAX_ROWS).map(({ q, r, expired }) => ({
    quotationId: q.id,
    quotationNumber: q.quotationNumber,
    revision: r?.revisionNumber ?? 1,
    quotationDate: r?.quotationDate ?? null,
    party: q.customer?.name ?? (q.prospectName ? `${q.prospectName} (prospect)` : "—"),
    title: r?.title ?? "—",
    enquiry: q.buyerEnquiry?.enquiryNumber ?? "—",
    owner: q.owner?.fullName ?? "Unassigned",
    status: expired ? "Expired" : QUOTATION_STATUSES[q.status].label,
    validUntil: r?.validUntil ?? null,
    taxable: Number(r?.taxableTotal ?? 0),
    gst: Number(r?.taxTotal ?? 0),
    total: Number(r?.grandTotal ?? 0),
  }));
  const sum = (k: "taxable" | "gst" | "total") => round2(data.reduce((s, { r }) => s + Number(r?.[k === "taxable" ? "taxableTotal" : k === "gst" ? "taxTotal" : "grandTotal"] ?? 0), 0));
  return {
    title: "Quotation Register",
    subtitle: `Quotations you can see, with their current revision (dated by quotation date)${data.length > shown.length ? ` — first ${shown.length} of ${data.length}; narrow the filters` : ""}.`,
    filtersApplied: filtersApplied(filters, { dateFrom: "Date From", dateTo: "Date To", status: "Status", customerId: "Customer", ownerUserId: "Owner" }),
    columns: [
      { key: "quotationNumber", label: "Quotation", linkTo: "quotation" },
      { key: "revision", label: "Rev", type: "number", align: "right" },
      { key: "quotationDate", label: "Date", type: "date" },
      { key: "party", label: "Customer / prospect" },
      { key: "title", label: "Title" },
      { key: "enquiry", label: "Enquiry" },
      { key: "owner", label: "Owner" },
      { key: "status", label: "Status" },
      { key: "validUntil", label: "Valid until", type: "date" },
      { key: "taxable", label: "Taxable", type: "currency", align: "right" },
      { key: "gst", label: "GST", type: "currency", align: "right" },
      { key: "total", label: "Total", type: "currency", align: "right" },
    ],
    rows: shown,
    totals: { quotationNumber: `${data.length} quotations`, taxable: sum("taxable"), gst: sum("gst"), total: sum("total") },
    meta: { page: 1, pageSize: shown.length, totalCount: data.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ── 3. Quotation → Order Conversion ──────────────────────────────

async function getQuotationConversionDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>, viewer: ReportViewer): Promise<ReportDescriptor> {
  const actor = actorOf(companyId, viewer);
  const { dateFrom, dateToExclusive } = parseReportDateRange(filters);
  const scope = await getQuotationScope(actor);
  const [canOrders, allowedBranches] = await Promise.all([PermissionService.can(viewer.userId, "sales_orders", "view"), PermissionService.getAllowedBranchIds(viewer.userId)]);
  const revisions = await prisma.quotationRevision.findMany({
    where: {
      companyId,
      status: "ACCEPTED",
      customerDecisionAt: { not: null, ...(dateFrom ? { gte: dateFrom } : {}), ...(dateToExclusive ? { lt: dateToExclusive } : {}) },
      quotation: quotationScopedWhere(actor, scope, filters.customerId ? { customerId: uuid(filters.customerId, "customer") } : {}),
    },
    select: {
      revisionNumber: true,
      customerDecisionAt: true,
      customerReference: true,
      taxableTotal: true,
      grandTotal: true,
      quotation: { select: { id: true, quotationNumber: true, prospectName: true, customer: { select: { name: true } } } },
      salesOrder: { select: { id: true, orderNumber: true, orderDate: true, createdAt: true, status: true, totalAmount: true, branchId: true } },
    },
    orderBy: { customerDecisionAt: "desc" },
    take: MAX_ROWS,
  });
  const visibleOrder = (o: { branchId: string | null } | null) => Boolean(o && canOrders && (!allowedBranches || (o.branchId !== null && allowedBranches.has(o.branchId))));
  const day = 24 * 60 * 60 * 1000;
  const rows = revisions
    .filter((r) => (filters.result === "converted" ? r.salesOrder : filters.result === "pending" ? !r.salesOrder : true))
    .map((r) => {
      const o = r.salesOrder;
      const show = visibleOrder(o);
      return {
        quotationId: r.quotation.id,
        quotationNumber: r.quotation.quotationNumber,
        revision: r.revisionNumber,
        party: r.quotation.customer?.name ?? (r.quotation.prospectName ? `${r.quotation.prospectName} (prospect)` : "—"),
        acceptedOn: r.customerDecisionAt,
        customerReference: r.customerReference ?? "—",
        quotedTaxable: Number(r.taxableTotal),
        quotedTotal: Number(r.grandTotal),
        result: o ? "Converted" : "Awaiting conversion",
        salesOrderId: show ? o!.id : null,
        orderNumber: o ? (show ? o.orderNumber : "(no access)") : "—",
        orderDate: show ? o!.orderDate : null,
        orderStatus: show ? o!.status.replace(/_/g, " ").toLowerCase() : "—",
        orderValue: show ? Number(o!.totalAmount) : null,
        daysToConvert: o && r.customerDecisionAt ? Math.max(0, Math.round((new Date(toIsoDate(o.createdAt)).getTime() - new Date(toIsoDate(r.customerDecisionAt)).getTime()) / day)) : null,
      };
    });
  const converted = rows.filter((r) => r.result === "Converted").length;
  return {
    title: "Quotation → Order Conversion",
    subtitle: "Quotation revisions accepted by the customer (dated by acceptance) and the Sales Order made from each. Order value is before GST, like Sales Orders.",
    filtersApplied: filtersApplied(filters, { dateFrom: "Accepted From", dateTo: "Accepted To", customerId: "Customer", result: "Result" }),
    columns: [
      { key: "quotationNumber", label: "Quotation", linkTo: "quotation" },
      { key: "revision", label: "Rev", type: "number", align: "right" },
      { key: "party", label: "Customer" },
      { key: "acceptedOn", label: "Accepted on", type: "date" },
      { key: "customerReference", label: "Customer ref" },
      { key: "quotedTaxable", label: "Quoted (taxable)", type: "currency", align: "right" },
      { key: "result", label: "Result" },
      { key: "orderNumber", label: "Sales Order", linkTo: "salesOrder" },
      { key: "orderDate", label: "Order date", type: "date" },
      { key: "orderStatus", label: "Order status" },
      { key: "orderValue", label: "Order value", type: "currency", align: "right" },
      { key: "daysToConvert", label: "Days to convert", type: "number", align: "right" },
    ],
    rows,
    totals: {
      quotationNumber: `${rows.length} accepted · ${converted} converted · ${rows.length ? round2((converted / rows.length) * 100) : 0}%`,
      quotedTaxable: round2(rows.reduce((s, r) => s + r.quotedTaxable, 0)),
      orderValue: round2(rows.reduce((s, r) => s + (r.orderValue ?? 0), 0)),
    },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

registerReport({ category: CATEGORY, key: "enquiry-register", title: "Enquiry Register", buildDescriptor: getEnquiryRegisterDescriptor, pdfOrientation: "landscape" });
registerReport({ category: CATEGORY, key: "quotation-register", title: "Quotation Register", buildDescriptor: getQuotationRegisterDescriptor, pdfOrientation: "landscape" });
registerReport({ category: CATEGORY, key: "quotation-conversion", title: "Quotation → Order Conversion", buildDescriptor: getQuotationConversionDescriptor, pdfOrientation: "landscape" });

export { getEnquiryRegisterDescriptor, getQuotationRegisterDescriptor, getQuotationConversionDescriptor };
