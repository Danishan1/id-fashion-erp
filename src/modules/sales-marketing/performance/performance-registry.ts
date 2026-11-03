/**
 * Sales performance registry (Phase 05, 2026-11-03). Client-safe — no Prisma
 * runtime. The single place that names and defines every target metric,
 * scope, period type and credit source; services, screens and reports read
 * from here instead of repeating labels or rules.
 * Rules: docs/sales-marketing/PHASE_05_PERFORMANCE.md §3–§6.
 */

export type SalesTargetMetricKey =
  | "BOOKED_ORDER_VALUE"
  | "BOOKED_ORDER_COUNT"
  | "BOOKED_QUANTITY"
  | "ACCEPTED_QUOTATION_VALUE"
  | "ACCEPTED_QUOTATION_COUNT"
  | "INVOICED_VALUE";
export type SalesTargetScopeKey = "REP" | "TEAM" | "TERRITORY" | "COMPANY";
export type SalesTargetPeriodTypeKey = "MONTH" | "QUARTER" | "YEAR";
export type SalesTargetRevisionStatusKey = "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "SUPERSEDED";
export type SalesCreditSourceKey = "QUOTATION_OWNER" | "CRM_OWNER" | "TERRITORY_PRIMARY" | "CREATOR" | "MANUAL" | "BACKFILL";
export type MetricUnit = "CURRENCY" | "COUNT" | "PIECES";
/** Which source documents a metric reads (drives drill-down). */
export type MetricSource = "SALES_ORDER" | "QUOTATION" | "SALES_INVOICE";

export interface MetricDefinition {
  key: SalesTargetMetricKey;
  label: string;
  short: string;
  unit: MetricUnit;
  source: MetricSource;
  /** What it measures, which records qualify, date basis and credit — shown on screens and reports. */
  definition: string;
  dateBasis: string;
}

const BOOKED_RULE =
  "Sales Orders that are Confirmed, In production, Partially dispatched, Dispatched, Invoiced or Closed (On hold counts only when held from one of those). Draft and Cancelled orders never count; an edited order counts once at its current value.";

export const SALES_TARGET_METRICS: readonly MetricDefinition[] = [
  {
    key: "BOOKED_ORDER_VALUE",
    label: "Booked order value",
    short: "Order value",
    unit: "CURRENCY",
    source: "SALES_ORDER",
    definition: `Order value before GST in INR. ${BOOKED_RULE} Credited to the order's sales rep and territory.`,
    dateBasis: "Order date",
  },
  {
    key: "BOOKED_ORDER_COUNT",
    label: "Booked orders",
    short: "Orders",
    unit: "COUNT",
    source: "SALES_ORDER",
    definition: `Number of orders. ${BOOKED_RULE} Credited to the order's sales rep and territory.`,
    dateBasis: "Order date",
  },
  {
    key: "BOOKED_QUANTITY",
    label: "Booked quantity",
    short: "Pieces",
    unit: "PIECES",
    source: "SALES_ORDER",
    definition: `Pieces ordered (all colour / size lines). ${BOOKED_RULE} Credited to the order's sales rep and territory.`,
    dateBasis: "Order date",
  },
  {
    key: "ACCEPTED_QUOTATION_VALUE",
    label: "Accepted quotation value",
    short: "Accepted quotes",
    unit: "CURRENCY",
    source: "QUOTATION",
    definition:
      "Value of accepted quotation revisions — lines after discount, before charges and GST, in INR. Not booked sales: a quotation only becomes a sale when it is converted to a Sales Order. Credited to the quotation's owner (else its creator); territory = the customer's territory now.",
    dateBasis: "Customer decision date",
  },
  {
    key: "ACCEPTED_QUOTATION_COUNT",
    label: "Accepted quotations",
    short: "Quotes won",
    unit: "COUNT",
    source: "QUOTATION",
    definition: "Number of accepted quotation revisions. Credited to the quotation's owner (else its creator); territory = the customer's territory now.",
    dateBasis: "Customer decision date",
  },
  {
    key: "INVOICED_VALUE",
    label: "Invoiced value",
    short: "Invoiced",
    unit: "CURRENCY",
    source: "SALES_INVOICE",
    definition:
      "Posted Sales Invoices (Posted, Partially paid, Paid, Closed) before GST, in INR. Draft and Cancelled invoices never count. This is the invoiced amount, not revenue or cash collected; sales returns don't reduce it. Credited to the invoice's sales order rep and territory.",
    dateBasis: "Invoice date",
  },
];

export const METRIC_BY_KEY = new Map(SALES_TARGET_METRICS.map((m) => [m.key, m]));
export const METRIC_KEYS = SALES_TARGET_METRICS.map((m) => m.key) as [SalesTargetMetricKey, ...SalesTargetMetricKey[]];

export function metricDefinition(key: SalesTargetMetricKey): MetricDefinition {
  const m = METRIC_BY_KEY.get(key);
  if (!m) throw new Error(`Unknown metric ${key}`);
  return m;
}

export const SALES_TARGET_SCOPES: { key: SalesTargetScopeKey; label: string; hint: string }[] = [
  { key: "REP", label: "Sales rep", hint: "One person's own credited sales." },
  { key: "TEAM", label: "Team", hint: "A manager and everyone below them in the CRM reporting tree." },
  { key: "TERRITORY", label: "Territory", hint: "Sales credited to a territory." },
  { key: "COMPANY", label: "Company", hint: "All sales of the company." },
];
export const SCOPE_LABELS: Record<SalesTargetScopeKey, string> = Object.fromEntries(SALES_TARGET_SCOPES.map((s) => [s.key, s.label])) as Record<SalesTargetScopeKey, string>;

export const PERIOD_TYPES: { key: SalesTargetPeriodTypeKey; label: string }[] = [
  { key: "MONTH", label: "Month" },
  { key: "QUARTER", label: "Quarter" },
  { key: "YEAR", label: "Year" },
];

export const REVISION_STATUS_LABELS: Record<SalesTargetRevisionStatusKey, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Waiting for approval",
  APPROVED: "Approved",
  SUPERSEDED: "Superseded",
};

export const CREDIT_SOURCE_LABELS: Record<SalesCreditSourceKey, string> = {
  QUOTATION_OWNER: "Quotation owner",
  CRM_OWNER: "CRM company owner",
  TERRITORY_PRIMARY: "Territory's primary rep",
  CREATOR: "Created the order",
  MANUAL: "Changed by hand",
  BACKFILL: "Set when targets were introduced",
};

export type PerformanceEventType =
  | "TERRITORY_CREATED"
  | "TERRITORY_UPDATED"
  | "TERRITORY_DEACTIVATED"
  | "TERRITORY_REACTIVATED"
  | "REP_ASSIGNED"
  | "REP_ASSIGNMENT_ENDED"
  | "REP_ASSIGNMENT_REMOVED"
  | "CUSTOMER_ASSIGNED"
  | "CUSTOMER_MOVED"
  | "CUSTOMER_REMOVED"
  | "TARGET_CREATED"
  | "REVISION_SAVED"
  | "REVISION_STARTED"
  | "SUBMITTED"
  | "RETURNED_TO_DRAFT"
  | "SENT_BACK"
  | "APPROVED"
  | "DISCARDED"
  | "ARCHIVED"
  | "SALES_CREDIT_CHANGED";

export const EVENT_LABELS: Record<PerformanceEventType, string> = {
  TERRITORY_CREATED: "Territory created",
  TERRITORY_UPDATED: "Details changed",
  TERRITORY_DEACTIVATED: "Deactivated",
  TERRITORY_REACTIVATED: "Reactivated",
  REP_ASSIGNED: "Rep assigned",
  REP_ASSIGNMENT_ENDED: "Rep assignment ended",
  REP_ASSIGNMENT_REMOVED: "Rep assignment removed",
  CUSTOMER_ASSIGNED: "Customer added",
  CUSTOMER_MOVED: "Customer moved here",
  CUSTOMER_REMOVED: "Customer removed",
  TARGET_CREATED: "Target created",
  REVISION_SAVED: "Draft saved",
  REVISION_STARTED: "New revision started",
  SUBMITTED: "Submitted for approval",
  RETURNED_TO_DRAFT: "Returned to draft",
  SENT_BACK: "Sent back",
  APPROVED: "Approved",
  DISCARDED: "Draft discarded",
  ARCHIVED: "Archived",
  SALES_CREDIT_CHANGED: "Sales credit changed",
};

/** Order statuses that count as booked (On hold handled separately via statusBeforeHold). */
export const BOOKED_ORDER_STATUSES = ["CONFIRMED", "IN_PRODUCTION", "PARTIALLY_DISPATCHED", "DISPATCHED", "INVOICED", "CLOSED"] as const;
/** Invoice statuses that count as invoiced. */
export const INVOICED_STATUSES = ["POSTED", "PARTIALLY_PAID", "PAID", "CLOSED"] as const;

export function formatMetricValue(unit: MetricUnit, value: number): string {
  if (unit === "CURRENCY") return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}${unit === "PIECES" ? " pcs" : ""}`;
}
