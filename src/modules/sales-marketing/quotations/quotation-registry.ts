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
