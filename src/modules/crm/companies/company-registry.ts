/**
 * Client-safe vocabulary for CRM Companies (no Prisma runtime / server
 * imports). Statuses are per-company configuration (crm_company_statuses);
 * these are only the defaults created the first time a company uses the CRM.
 */

export const DEFAULT_COMPANY_STATUSES: { key: string; name: string; color: string; isDefault?: boolean }[] = [
  { key: "prospect", name: "Prospect", color: "indigo", isDefault: true },
  { key: "active_prospect", name: "Active prospect", color: "amber" },
  { key: "customer", name: "Customer", color: "green" },
  { key: "partner", name: "Partner", color: "indigo" },
  { key: "inactive", name: "Inactive", color: "neutral" },
  { key: "former_customer", name: "Former customer", color: "neutral" },
  { key: "lost", name: "Lost", color: "red" },
];

export const COMPANY_STATUS_COLORS = ["neutral", "indigo", "green", "amber", "red"] as const;

// ── Duplicate rules ──────────────────────────────────────────────

export type CompanyDuplicateRuleKey = "NAME" | "LEGAL_NAME" | "WEBSITE" | "EMAIL" | "PHONE";
export type CompanyDuplicateAction = "WARN" | "BLOCK" | "FLAG" | "OFF";
export interface CompanyDuplicateRule {
  rule: CompanyDuplicateRuleKey;
  action: CompanyDuplicateAction;
}

export const COMPANY_DUPLICATE_RULE_LABELS: Record<CompanyDuplicateRuleKey, string> = {
  NAME: "Same company name (ignoring punctuation and Pvt / Ltd / LLP… suffixes)",
  LEGAL_NAME: "Same legal name (compared with names and legal names)",
  WEBSITE: "Same website domain",
  EMAIL: "Same company email",
  PHONE: "Same company phone or mobile",
};

/**
 * Defaults (Phase 05): every signal warns — a name alone is never treated as
 * proof, so nothing blocks out of the box. The same ERP customer can never be
 * linked to two CRM companies (database unique key), independent of rules.
 */
export const DEFAULT_COMPANY_DUPLICATE_RULES: CompanyDuplicateRule[] = [
  { rule: "NAME", action: "WARN" },
  { rule: "LEGAL_NAME", action: "WARN" },
  { rule: "WEBSITE", action: "WARN" },
  { rule: "EMAIL", action: "WARN" },
  { rule: "PHONE", action: "WARN" },
];

// ── Option lists ─────────────────────────────────────────────────

export const COMPANY_OPTION_LISTS = {
  company_industry: { label: "Industries", help: "Suggested on the company form — e.g. Apparel retail, Brand, Wholesale, Buying house." },
  company_type: { label: "Company types", help: "Suggested on the company form — e.g. Brand, Retailer, Importer, Buying agent." },
} as const;
export type CompanyOptionListKey = keyof typeof COMPANY_OPTION_LISTS;

export const DEFAULT_COMPANY_OPTION_VALUES: Record<CompanyOptionListKey, string[]> = {
  company_industry: ["Apparel brand", "Retail chain", "Wholesale", "Buying house", "E-commerce", "Uniforms / institutional", "Home textiles"],
  company_type: ["Brand", "Retailer", "Importer", "Buying agent", "Distributor", "Manufacturer", "Partner"],
};

// ── Related records (placeholders for later phases / missing ERP modules) ──

/**
 * Sections on the company page with no data source yet. A later phase (or a
 * future ERP module) replaces its entry with a real provider; until then the
 * page shows this honest placeholder — never sample data.
 */
export const COMPANY_FUTURE_SECTIONS = [
  { key: "activities", title: "Activities (calls, emails, meetings)", phase: "Phase 09 — Activities, Tasks & Follow-ups" },
  { key: "appointments", title: "Appointments", phase: "Phase 10 — Calendar & Appointments" },
  { key: "conversations", title: "Conversations", phase: "Phase 11 — Unified Conversations" },
  { key: "pipeline", title: "Pipeline & stages for opportunities", phase: "Phase 06/07 — Opportunities & Pipelines" },
  { key: "tickets", title: "Support tickets", phase: "the Ticketing phase (the ERP has no ticket module)" },
] as const;
