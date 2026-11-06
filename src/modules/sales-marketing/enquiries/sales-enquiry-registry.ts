/**
 * Sales Enquiry vocabulary (Release 1 / S1, 2026-10-28). Client-safe — no
 * Prisma runtime. Mirrors the SalesEnquiryStage / SalesEnquiryPriority /
 * SalesEnquiryActivityType enums in schema.prisma; add a value there and here.
 *
 * Lifecycle (decision D1 — the sales enquiry is the Buyer Enquiry record; its
 * Merchandising `status` is a separate, line-derived sampling status):
 *
 *   NEW → UNDER_REVIEW → QUALIFIED → QUOTATION_IN_PROGRESS → QUOTED → WON
 *   any open stage → LOST / NOT_QUALIFIED / ON_HOLD
 *   ON_HOLD → resume (back to the exact stage it was held from)
 *   LOST / NOT_QUALIFIED → reopen with a reason (→ UNDER_REVIEW)
 *
 * QUOTATION_IN_PROGRESS, QUOTED and WON are SYSTEM stages: only the quotation
 * and Sales Order conversion services (S2–S4) set them, so an enquiry can never
 * be marked quoted or won without the real document behind it.
 */

export const SALES_ENQUIRY_STAGES = {
  NEW: { label: "New", tone: "sky", closed: false, system: false },
  UNDER_REVIEW: { label: "Under review", tone: "indigo", closed: false, system: false },
  QUALIFIED: { label: "Qualified", tone: "violet", closed: false, system: false },
  QUOTATION_IN_PROGRESS: { label: "Quotation in progress", tone: "amber", closed: false, system: true },
  QUOTED: { label: "Quoted", tone: "orange", closed: false, system: true },
  WON: { label: "Won", tone: "green", closed: true, system: true },
  LOST: { label: "Lost", tone: "red", closed: true, system: false },
  NOT_QUALIFIED: { label: "Not qualified", tone: "neutral", closed: true, system: false },
  ON_HOLD: { label: "On hold", tone: "neutral", closed: false, system: false },
} as const;

export type SalesEnquiryStage = keyof typeof SALES_ENQUIRY_STAGES;
export const SALES_ENQUIRY_STAGE_KEYS = Object.keys(SALES_ENQUIRY_STAGES) as [SalesEnquiryStage, ...SalesEnquiryStage[]];

/** Stages a user can pick on the "change stage" action (resume and reopen have their own actions). */
export const MANUAL_STAGE_TARGETS = ["UNDER_REVIEW", "QUALIFIED", "NOT_QUALIFIED", "LOST", "ON_HOLD"] as const;
export type ManualStageTarget = (typeof MANUAL_STAGE_TARGETS)[number];

/** Allowed manual transitions. Closed stages have none — they are reopened instead. */
export const SALES_ENQUIRY_TRANSITIONS: Record<SalesEnquiryStage, readonly ManualStageTarget[]> = {
  NEW: ["UNDER_REVIEW", "QUALIFIED", "NOT_QUALIFIED", "LOST", "ON_HOLD"],
  UNDER_REVIEW: ["QUALIFIED", "NOT_QUALIFIED", "LOST", "ON_HOLD"],
  QUALIFIED: ["UNDER_REVIEW", "NOT_QUALIFIED", "LOST", "ON_HOLD"],
  QUOTATION_IN_PROGRESS: ["LOST", "ON_HOLD"],
  QUOTED: ["LOST", "ON_HOLD"],
  ON_HOLD: ["NOT_QUALIFIED", "LOST"],
  WON: [],
  LOST: [],
  NOT_QUALIFIED: [],
};

/** Moving to these needs a reason (stored as the closure / hold reason). */
export const STAGES_REQUIRING_REASON: readonly SalesEnquiryStage[] = ["LOST", "NOT_QUALIFIED"];

/** Closed stages that can be reopened. WON is final: it means a Sales Order exists. */
export const REOPENABLE_STAGES: readonly SalesEnquiryStage[] = ["LOST", "NOT_QUALIFIED"];
export const REOPEN_TARGET: SalesEnquiryStage = "UNDER_REVIEW";

export const OPEN_STAGE_KEYS = SALES_ENQUIRY_STAGE_KEYS.filter((s) => !SALES_ENQUIRY_STAGES[s].closed);
export const isClosedStage = (s: SalesEnquiryStage) => SALES_ENQUIRY_STAGES[s].closed;

export function canMoveTo(from: SalesEnquiryStage, to: SalesEnquiryStage): boolean {
  return (SALES_ENQUIRY_TRANSITIONS[from] as readonly string[]).includes(to);
}

export const SALES_ENQUIRY_PRIORITIES = {
  LOW: { label: "Low", tone: "neutral", rank: 0 },
  NORMAL: { label: "Normal", tone: "sky", rank: 1 },
  HIGH: { label: "High", tone: "amber", rank: 2 },
  URGENT: { label: "Urgent", tone: "red", rank: 3 },
} as const;
export type SalesEnquiryPriority = keyof typeof SALES_ENQUIRY_PRIORITIES;
export const SALES_ENQUIRY_PRIORITY_KEYS = Object.keys(SALES_ENQUIRY_PRIORITIES) as [SalesEnquiryPriority, ...SalesEnquiryPriority[]];

/** Same values as the EnquirySource enum used by Merchandising's form. */
export const ENQUIRY_SOURCES = {
  EMAIL: "Email",
  PHONE: "Phone",
  TRADE_SHOW: "Trade show",
  REFERRAL: "Referral",
  WEBSITE: "Website",
  OTHER: "Other",
} as const;
export type EnquirySourceKey = keyof typeof ENQUIRY_SOURCES;
export const ENQUIRY_SOURCE_KEYS = Object.keys(ENQUIRY_SOURCES) as [EnquirySourceKey, ...EnquirySourceKey[]];

export const SALES_ENQUIRY_ACTIVITY_TYPES = {
  NOTE: { label: "Note", manual: true },
  CALL: { label: "Call", manual: true },
  EMAIL: { label: "Email", manual: true },
  MEETING: { label: "Meeting", manual: true },
  STAGE_CHANGED: { label: "Stage changed", manual: false },
  OWNER_CHANGED: { label: "Owner changed", manual: false },
  FOLLOW_UP_CHANGED: { label: "Follow-up changed", manual: false },
  DETAILS_UPDATED: { label: "Details updated", manual: false },
  OPPORTUNITY_LINKED: { label: "CRM opportunity linked", manual: false },
  OPPORTUNITY_UNLINKED: { label: "CRM opportunity unlinked", manual: false },
} as const;
export type SalesEnquiryActivityType = keyof typeof SALES_ENQUIRY_ACTIVITY_TYPES;
/** Types a user can log by hand: notes and customer interactions. */
export const MANUAL_ACTIVITY_TYPES = ["NOTE", "CALL", "EMAIL", "MEETING"] as const;

/** Merchandising's sampling status labels, shown read-only next to the sales stage. */
export const SAMPLING_STATUS_LABELS = {
  OPEN: "Open",
  PARTIALLY_CONVERTED: "Partly sampled",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
} as const;

/** Tailwind classes per tone (badge). */
export const TONE_BADGE: Record<string, string> = {
  sky: "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  indigo: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  violet: "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  amber: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  orange: "bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  green: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300",
  red: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
  neutral: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

export const SALES_ENQUIRY_SORT_FIELDS = ["enquiryNumber", "enquiryDate", "nextFollowUpDate", "priority", "salesStage", "createdAt", "updatedAt"] as const;
export type SalesEnquirySortField = (typeof SALES_ENQUIRY_SORT_FIELDS)[number];
