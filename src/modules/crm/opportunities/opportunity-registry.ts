/**
 * Client-safe vocabulary for CRM Opportunities (no Prisma runtime / server
 * imports). Pipelines and stages are per-company configuration
 * (crm_pipelines / crm_pipeline_stages); DEFAULT_PIPELINE is only what a
 * company gets the first time it uses opportunities. Pipeline management
 * (create / reorder / rules) is Phase 07.
 */

export const DEFAULT_PIPELINE = {
  key: "sales",
  name: "Sales",
  stages: [
    { key: "new", name: "New", probability: 10 },
    { key: "qualified", name: "Qualified", probability: 25 },
    { key: "proposal", name: "Proposal", probability: 50 },
    { key: "negotiation", name: "Negotiation", probability: 75 },
    { key: "closing", name: "Closing", probability: 90 },
  ],
} as const;

// ── Status ───────────────────────────────────────────────────────

/** Mirrors the CrmOpportunityStatus enum (Phase 02); add a value there + here to extend. */
export const OPPORTUNITY_STATUSES = {
  OPEN: { label: "Open", tone: "indigo", closed: false },
  WON: { label: "Won", tone: "green", closed: true },
  LOST: { label: "Lost", tone: "red", closed: true },
  ABANDONED: { label: "Abandoned", tone: "neutral", closed: true },
} as const;
export type OpportunityStatus = keyof typeof OPPORTUNITY_STATUSES;
export const OPPORTUNITY_STATUS_KEYS = Object.keys(OPPORTUNITY_STATUSES) as [OpportunityStatus, ...OpportunityStatus[]];

export const isClosedStatus = (s: OpportunityStatus) => OPPORTUNITY_STATUSES[s].closed;

/**
 * Allowed transitions. Open can close any way; a closed opportunity can only
 * be reopened (which is audited) — it is never silently edited as if open.
 */
export const OPPORTUNITY_STATUS_TRANSITIONS: Record<OpportunityStatus, readonly OpportunityStatus[]> = {
  OPEN: ["WON", "LOST", "ABANDONED"],
  WON: ["OPEN"],
  LOST: ["OPEN"],
  ABANDONED: ["OPEN"],
};

export function canTransition(from: OpportunityStatus, to: OpportunityStatus) {
  return OPPORTUNITY_STATUS_TRANSITIONS[from].includes(to);
}

/** Timeline event for each target status (status_changed stays registered for future custom statuses). */
export const STATUS_EVENT: Record<OpportunityStatus, "opportunity.won" | "opportunity.lost" | "opportunity.abandoned" | "opportunity.reopened"> = {
  WON: "opportunity.won",
  LOST: "opportunity.lost",
  ABANDONED: "opportunity.abandoned",
  OPEN: "opportunity.reopened",
};

// ── Option lists (Settings → Contact, company & opportunity options) ──

export const OPPORTUNITY_OPTION_LISTS = {
  opportunity_close_reason: { label: "Win / loss reasons", help: "Suggested when an opportunity is won, lost or abandoned — e.g. Price, Lead time, Quality, Competitor." },
} as const;
export type OpportunityOptionListKey = keyof typeof OPPORTUNITY_OPTION_LISTS;
export const DEFAULT_OPPORTUNITY_OPTION_VALUES: Record<OpportunityOptionListKey, string[]> = {
  opportunity_close_reason: ["Price", "Lead time", "Quality / sampling", "Chose a competitor", "Budget cancelled", "No response", "Order confirmed"],
};

// ── ERP document references ──────────────────────────────────────

/**
 * ERP documents an opportunity can reference (many per opportunity). Data is
 * always read live from the ERP. The ERP has no quotation module yet — when
 * one exists, add a "QUOTATION" provider in crm-opportunity-erp.service.ts
 * and an entry here (no migration: doc_type is validated in code).
 */
export const ERP_DOC_TYPES = {
  BUYER_ENQUIRY: { label: "Buyer enquiry", plural: "Buyer enquiries", module: "buyer_enquiries" },
  SAMPLE_REQUEST: { label: "Sample request", plural: "Sample requests", module: "sampling" },
  SALES_ORDER: { label: "Sales order", plural: "Sales orders", module: "sales_orders" },
} as const;
export type ErpDocType = keyof typeof ERP_DOC_TYPES;
export const ERP_DOC_TYPE_KEYS = Object.keys(ERP_DOC_TYPES) as [ErpDocType, ...ErpDocType[]];

export const QUOTATION_NOT_AVAILABLE = "The ERP has no quotation module yet. Link the buyer enquiry, sample request or sales order instead; quotations will appear here once the ERP has them.";

// ── Related sections with no data source yet ─────────────────────

export const OPPORTUNITY_FUTURE_SECTIONS = [
  { key: "activities", title: "Activities (calls, emails, meetings, demos)", phase: "Phase 09 — Activities, Tasks & Follow-ups" },
  { key: "tasks", title: "Tasks", phase: "Phase 09 — Activities, Tasks & Follow-ups" },
  { key: "appointments", title: "Appointments", phase: "Phase 10 — Calendar & Appointments" },
  { key: "conversations", title: "Conversations", phase: "Phase 11 — Unified Conversations" },
  { key: "board", title: "Pipeline board and pipeline / stage management", phase: "Phases 07–08 — Pipelines & Opportunity Board" },
] as const;
