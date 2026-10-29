/**
 * Quotation vocabulary (Sales & Marketing S2, 2026-10-28). Client-safe.
 * Mirrors the QuotationStatus / QuotationRevisionStatus / QuotationLineType
 * enums in schema.prisma.
 *
 * S2 builds drafts only: a quotation is created as DRAFT, edited freely while
 * DRAFT and can be cancelled. Approval, issue, revision, acceptance (S3) and
 * conversion (S4) set the other statuses.
 */

export const QUOTATION_STATUSES = {
  DRAFT: { label: "Draft", tone: "neutral", open: true },
  PENDING_APPROVAL: { label: "Awaiting approval", tone: "amber", open: true },
  APPROVED: { label: "Approved", tone: "indigo", open: true },
  ISSUED: { label: "Issued", tone: "sky", open: true },
  ACCEPTED: { label: "Accepted", tone: "green", open: true },
  REJECTED: { label: "Rejected", tone: "red", open: false },
  CONVERTED: { label: "Converted", tone: "violet", open: false },
  CANCELLED: { label: "Cancelled", tone: "neutral", open: false },
} as const;
export type QuotationStatus = keyof typeof QUOTATION_STATUSES;
export const QUOTATION_STATUS_KEYS = Object.keys(QUOTATION_STATUSES) as [QuotationStatus, ...QuotationStatus[]];
export const OPEN_QUOTATION_STATUSES = QUOTATION_STATUS_KEYS.filter((s) => QUOTATION_STATUSES[s].open);

export const QUOTATION_REVISION_STATUSES = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Awaiting approval",
  APPROVED: "Approved",
  ISSUED: "Issued",
  SUPERSEDED: "Superseded",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
} as const;
export type QuotationRevisionStatus = keyof typeof QUOTATION_REVISION_STATUSES;

export const QUOTATION_LINE_TYPES = {
  STYLE: { label: "Style" },
  DESIGN: { label: "Design (sample)" },
  FREE_TEXT: { label: "New item" },
} as const;
export type QuotationLineType = keyof typeof QUOTATION_LINE_TYPES;

/** Default validity when a new quotation is started. */
export const DEFAULT_VALIDITY_DAYS = 30;
export const MAX_QUOTATION_LINES = 200;

export const QUOTATION_SORT_FIELDS = ["quotationNumber", "createdAt", "updatedAt", "status"] as const;
export type QuotationSortField = (typeof QUOTATION_SORT_FIELDS)[number];

// ── S3: lifecycle vocabulary ─────────────────────────────────────

/** Timeline event types (quotation_events.type). */
export const QUOTATION_EVENT_TYPES = {
  CREATED: "Created",
  UPDATED: "Draft saved",
  SUBMITTED: "Submitted for approval",
  WITHDRAWN: "Returned to draft",
  APPROVED: "Approved",
  APPROVAL_REJECTED: "Approval declined",
  ISSUED: "Issued",
  SENT: "Marked as sent",
  ACCEPTED: "Accepted by customer",
  REJECTED: "Rejected by customer",
  REVISED: "New revision started",
  CANCELLED: "Cancelled",
  CUSTOMER_LINKED: "Customer linked",
  CONVERTED: "Converted to Sales Order",
} as const;
export type QuotationEventType = keyof typeof QUOTATION_EVENT_TYPES;

/** How the quotation reached the customer (recorded by hand — nothing is sent from the ERP). */
export const SENT_METHODS = { EMAIL: "Email", WHATSAPP: "WhatsApp", COURIER: "Courier / post", IN_PERSON: "In person", OTHER: "Other" } as const;
export type SentMethod = keyof typeof SENT_METHODS;
export const SENT_METHOD_KEYS = Object.keys(SENT_METHODS) as [SentMethod, ...SentMethod[]];

/** How the customer gave their decision. */
export const DECISION_METHODS = { PURCHASE_ORDER: "Purchase order", EMAIL: "Email", SIGNED_COPY: "Signed quotation", PHONE: "Phone", IN_PERSON: "In person", OTHER: "Other" } as const;
export type DecisionMethod = keyof typeof DECISION_METHODS;
export const DECISION_METHOD_KEYS = Object.keys(DECISION_METHODS) as [DecisionMethod, ...DecisionMethod[]];

/** Expiry is derived (no background job): an issued revision past its valid-until date. `today` is YYYY-MM-DD. */
export function isQuotationExpired(status: string, validUntil: string | Date, today: string): boolean {
  const v = typeof validUntil === "string" ? validUntil.slice(0, 10) : validUntil.toISOString().slice(0, 10);
  return status === "ISSUED" && v < today;
}
