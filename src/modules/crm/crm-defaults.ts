import type { CrmStageKind } from "@prisma/client";

/**
 * Default CRM configuration seeded for a company the first time its CRM is
 * used (existing companies were backfilled by migration
 * 20260927100000_crm_pipeline_stages_and_lead_expansion, which repeats these
 * exact literals — keep the two in sync if a default ever changes).
 *
 * Business rules only ever key on a stage's `kind`, never its code/name, so an
 * admin can rename, reorder, or insert stages later without breaking anything.
 * The one code-based lookup is `DEFAULT_ENTRY_STAGE_CODE` (the stage a new lead
 * lands in), and even that falls back to the first active OPEN stage.
 */
export const DEFAULT_LEAD_STAGES: ReadonlyArray<{ code: string; name: string; kind: CrmStageKind; sortOrder: number }> = [
  { code: "NEW_LEAD", name: "New Lead", kind: "OPEN", sortOrder: 10 },
  { code: "CONTACT_ATTEMPTED", name: "Contact Attempted", kind: "OPEN", sortOrder: 20 },
  { code: "CONTACTED", name: "Contacted", kind: "OPEN", sortOrder: 30 },
  { code: "QUALIFICATION", name: "Qualification", kind: "OPEN", sortOrder: 40 },
  { code: "REQUIREMENT_RECEIVED", name: "Requirement Received", kind: "OPEN", sortOrder: 50 },
  { code: "SAMPLE_DEVELOPMENT", name: "Sample / Development", kind: "OPEN", sortOrder: 60 },
  { code: "QUOTATION_SENT", name: "Quotation Sent", kind: "OPEN", sortOrder: 70 },
  { code: "NEGOTIATION", name: "Negotiation", kind: "OPEN", sortOrder: 80 },
  { code: "HOT_DECISION_PENDING", name: "Hot / Decision Pending", kind: "OPEN", sortOrder: 90 },
  { code: "WON", name: "Won", kind: "WON", sortOrder: 100 },
  { code: "LOST", name: "Lost", kind: "LOST", sortOrder: 110 },
  { code: "DORMANT", name: "Dormant / Follow Later", kind: "DORMANT", sortOrder: 120 },
];

export const DEFAULT_ENTRY_STAGE_CODE = "NEW_LEAD";

export const DEFAULT_LEAD_SOURCES: ReadonlyArray<{ code: string; name: string; sortOrder: number }> = [
  { code: "WEBSITE", name: "Website", sortOrder: 10 },
  { code: "WHATSAPP", name: "WhatsApp", sortOrder: 20 },
  { code: "EMAIL", name: "Email", sortOrder: 30 },
  { code: "PHONE", name: "Phone", sortOrder: 40 },
  { code: "REFERRAL", name: "Referral", sortOrder: 50 },
  { code: "EXISTING_CUSTOMER", name: "Existing Customer", sortOrder: 60 },
  { code: "TRADE_FAIR", name: "Trade Fair", sortOrder: 70 },
  { code: "EXHIBITION", name: "Exhibition", sortOrder: 80 },
  { code: "INDIAMART", name: "IndiaMART", sortOrder: 90 },
  { code: "TRADEINDIA", name: "TradeIndia", sortOrder: 100 },
  { code: "LINKEDIN", name: "LinkedIn", sortOrder: 110 },
  { code: "INSTAGRAM", name: "Instagram", sortOrder: 120 },
  { code: "FACEBOOK", name: "Facebook", sortOrder: 130 },
  { code: "GOOGLE_ADS", name: "Google Ads", sortOrder: 140 },
  { code: "EXPORT_BUYER_PLATFORM", name: "Export Buyer Platform", sortOrder: 150 },
  { code: "BUYING_AGENT", name: "Buying Agent", sortOrder: 160 },
  { code: "SALESPERSON", name: "Salesperson", sortOrder: 170 },
  { code: "WALK_IN", name: "Walk-In", sortOrder: 180 },
  { code: "MANUAL_ENTRY", name: "Manual Entry", sortOrder: 190 },
  { code: "CSV_IMPORT", name: "CSV Import", sortOrder: 200 },
  { code: "API_WEBHOOK", name: "API / Webhook", sortOrder: 210 },
  { code: "OTHER", name: "Other", sortOrder: 220 },
];

/** The source a lead gets when none is supplied (e.g. a blank CSV cell). */
export const FALLBACK_SOURCE_CODE = "OTHER";

/** Old EnquirySource enum values still accepted by the CSV importer, mapped to
 * the new source codes (every other old value already matches a code). */
export const LEGACY_SOURCE_CODE_MAP: Record<string, string> = { TRADE_SHOW: "TRADE_FAIR" };

export const DEFAULT_LOST_REASONS: ReadonlyArray<{ code: string; name: string; sortOrder: number }> = [
  { code: "PRICE_TOO_HIGH", name: "Price Too High", sortOrder: 10 },
  { code: "MOQ", name: "MOQ", sortOrder: 20 },
  { code: "DELIVERY_TIME", name: "Delivery Time", sortOrder: 30 },
  { code: "QUALITY_PRODUCT", name: "Quality / Product", sortOrder: 40 },
  { code: "COMPETITOR", name: "Competitor", sortOrder: 50 },
  { code: "NO_RESPONSE", name: "No Response", sortOrder: 60 },
  { code: "BUYER_CANCELLED", name: "Buyer Cancelled Requirement", sortOrder: 70 },
  { code: "BUDGET", name: "Budget", sortOrder: 80 },
  { code: "PAYMENT_TERMS", name: "Payment Terms", sortOrder: 90 },
  { code: "SAMPLING_ISSUE", name: "Sampling Issue", sortOrder: 100 },
  { code: "NOT_QUALIFIED", name: "Not Qualified", sortOrder: 110 },
  { code: "DUPLICATE", name: "Duplicate", sortOrder: 120 },
  { code: "OTHER", name: "Other", sortOrder: 130 },
];
