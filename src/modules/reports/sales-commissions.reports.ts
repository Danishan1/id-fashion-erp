import { prisma } from "@/core/db/client";
import { PermissionService } from "@/core/rbac/PermissionService";
import type { ReportDescriptor } from "@/core/reports/report-types";
import { todayIsoDate } from "@/lib/date";
import { round2 } from "@/lib/money";
import { PAYMENT_STATUS_LABELS } from "@/modules/sales-marketing/commissions/commission-statement.service";
import { metricTotals } from "@/modules/sales-marketing/performance/performance-actuals";
import { dbDate, toDbDate } from "@/modules/sales-marketing/performance/performance-common";
import { registerReport, type ReportViewer } from "./registry";

/**
 * Sales channel and commission reports (Sales & Marketing Phase 07,
 * 2026-11-04), in the Sales & Marketing Report Center category. Channel
 * figures come from the same metricTotals() as targets (grouped by the Sales
 * Order's channel); the register reads the statement lines as stored.
 */

const CATEGORY = "sales-marketing" as const;
const isoDate = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

// ── 1. Sales by channel ──────────────────────────────────────────

async function getSalesByChannelDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>, viewer: ReportViewer): Promise<ReportDescriptor> {
  await PermissionService.assert(viewer.userId, "sales_orders", "view");
  const today = todayIsoDate();
  const from = isoDate(filters.dateFrom) ?? `${today.slice(0, 7)}-01`;
  const to = isoDate(filters.dateTo) ?? today;
  const [booked, count, accepted, invoiced, channels] = await Promise.all([
    metricTotals(companyId, "BOOKED_ORDER_VALUE", from, to, "CHANNEL"),
    metricTotals(companyId, "BOOKED_ORDER_COUNT", from, to, "CHANNEL"),
    metricTotals(companyId, "ACCEPTED_QUOTATION_VALUE", from, to, "CHANNEL"),
    metricTotals(companyId, "INVOICED_VALUE", from, to, "CHANNEL"),
    prisma.salesChannel.findMany({ where: { companyId }, select: { id: true, code: true, name: true, isActive: true }, orderBy: { code: "asc" } }),
  ]);
  const keys = [...channels.map((c) => c.id), ""];
  const rows = keys
    .map((k) => {
      const c = channels.find((x) => x.id === k);
      return {
        channelId: k || null,
        channel: c ? `${c.name} (${c.code})${c.isActive ? "" : " — inactive"}` : "No channel",
        bookedValue: round2(booked.get(k)?.value ?? 0),
        orders: count.get(k)?.value ?? 0,
        acceptedQuotationValue: round2(accepted.get(k)?.value ?? 0),
        invoicedValue: round2(invoiced.get(k)?.value ?? 0),
      };
    })
    .filter((r) => r.channelId || r.bookedValue || r.orders || r.acceptedQuotationValue || r.invoicedValue);
  return {
    title: "Sales by Channel",
    subtitle: `${from} to ${to}. Booked orders (order date), accepted quotations (decision date) and posted invoices (invoice date), before GST in INR, by each document's own channel — the same rules as targets. Accepted quotations aren't booked sales.`,
    filtersApplied: [
      { label: "From", value: from },
      { label: "To", value: to },
    ],
    columns: [
      { key: "channel", label: "Channel" },
      { key: "bookedValue", label: "Booked value", type: "currency", align: "right" },
      { key: "orders", label: "Booked orders", type: "number", align: "right" },
      { key: "acceptedQuotationValue", label: "Accepted quotations", type: "currency", align: "right" },
      { key: "invoicedValue", label: "Invoiced", type: "currency", align: "right" },
    ],
    rows,
    totals: {
      channel: `${rows.length} rows`,
      bookedValue: round2(rows.reduce((s, r) => s + r.bookedValue, 0)),
      orders: rows.reduce((s, r) => s + r.orders, 0),
      acceptedQuotationValue: round2(rows.reduce((s, r) => s + r.acceptedQuotationValue, 0)),
      invoicedValue: round2(rows.reduce((s, r) => s + r.invoicedValue, 0)),
    },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ── 2. Commission register ───────────────────────────────────────

const KIND_LABELS: Record<string, string> = { EARNING: "Commission", REVERSAL: "Reversal", CARRY_FORWARD: "Carried forward", ADJUSTMENT: "Adjustment", INCENTIVE: "Incentive" };
const STATUS_LABELS: Record<string, string> = { DRAFT: "Draft", PENDING_APPROVAL: "Waiting for approval", APPROVED: "Approved" };

async function getCommissionRegisterDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>, viewer: ReportViewer): Promise<ReportDescriptor> {
  await PermissionService.assert(viewer.userId, "sales_commissions", "view");
  const viewAll = await PermissionService.can(viewer.userId, "sales_commissions", "view_all");
  const month = filters.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(filters.month) ? filters.month : null;
  const status = ["DRAFT", "PENDING_APPROVAL", "APPROVED"].includes(filters.status ?? "") ? (filters.status as "DRAFT" | "PENDING_APPROVAL" | "APPROVED") : null;
  const lines = await prisma.salesCommissionLine.findMany({
    where: {
      companyId,
      statement: {
        ...(viewAll ? {} : { userId: viewer.userId }),
        ...(month ? { periodStart: toDbDate(`${month}-01`) } : {}),
        ...(status ? { status } : {}),
      },
    },
    orderBy: [{ statement: { periodStart: "desc" } }, { statementId: "asc" }, { kind: "asc" }, { eventDate: "asc" }],
    take: 5000,
    include: {
      statement: { select: { id: true, periodStart: true, status: true, payeeType: true, user: { select: { fullName: true } }, salesAgent: { select: { name: true, code: true } }, paymentRequest: { select: { requestNumber: true, status: true } } } },
    },
  });
  const rows = lines.map((l) => {
    const d = (l.details ?? {}) as Record<string, unknown>;
    const s = l.statement;
    return {
      statementId: s.id,
      month: dbDate(s.periodStart).slice(0, 7),
      payee: s.user?.fullName ?? (s.salesAgent ? `${s.salesAgent.name} (${s.salesAgent.code})` : "—"),
      payeeType: s.payeeType === "REP" ? "Sales rep" : "Sales agent",
      kind: KIND_LABELS[l.kind] ?? l.kind,
      eventDate: l.eventDate ? dbDate(l.eventDate) : null,
      reference: [d.invoiceNumber, d.orderNumber, d.paymentNumber, d.planCode].filter(Boolean).join(" · ") || l.reason || "—",
      basis: l.basisAmount === null ? null : Number(l.basisAmount),
      rate: l.rate === null ? null : Number(l.rate),
      amount: Number(l.amount),
      statementStatus: STATUS_LABELS[s.status],
      payment: s.paymentRequest ? `${s.paymentRequest.requestNumber} — ${PAYMENT_STATUS_LABELS[s.paymentRequest.status] ?? s.paymentRequest.status}` : "—",
    };
  });
  return {
    title: "Commission Register",
    subtitle: `Every line of the commission statements${viewAll ? "" : " (your own)"}: commission per invoice or collection, reversals, incentives, carry-forwards and manual adjustments. Draft amounts can still change.`,
    filtersApplied: [...(month ? [{ label: "Month", value: month }] : []), ...(status ? [{ label: "Statement status", value: STATUS_LABELS[status] }] : [])],
    columns: [
      { key: "month", label: "Month", linkTo: "statement" },
      { key: "payee", label: "Payee" },
      { key: "payeeType", label: "Type" },
      { key: "kind", label: "Line" },
      { key: "eventDate", label: "Date", type: "date" },
      { key: "reference", label: "Reference" },
      { key: "basis", label: "Basis", type: "currency", align: "right" },
      { key: "rate", label: "Rate %", type: "number", align: "right" },
      { key: "amount", label: "Amount", type: "currency", align: "right" },
      { key: "statementStatus", label: "Statement" },
      { key: "payment", label: "Payment" },
    ],
    rows,
    totals: { month: `${rows.length} lines${lines.length === 5000 ? " (first 5,000)" : ""}`, amount: round2(rows.reduce((s, r) => s + r.amount, 0)) },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

registerReport({ category: CATEGORY, key: "sales-by-channel", title: "Sales by Channel", buildDescriptor: getSalesByChannelDescriptor });
registerReport({ category: CATEGORY, key: "commission-register", title: "Commission Register", buildDescriptor: getCommissionRegisterDescriptor, pdfOrientation: "landscape" });

export { getSalesByChannelDescriptor, getCommissionRegisterDescriptor };
