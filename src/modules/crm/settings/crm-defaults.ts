import type { CrmLeadStatusKind } from "@prisma/client";

/**
 * Defaults created for a company the first time it uses the CRM
 * (ensureCrmLeadDefaults). Admins can rename, recolour, reorder and add to
 * these; `key` and `kind` are what the code relies on, never the name.
 */
export const DEFAULT_LEAD_STATUSES: { key: string; name: string; kind: CrmLeadStatusKind; color: string; isDefault?: boolean }[] = [
  { key: "new", name: "New", kind: "OPEN", color: "indigo", isDefault: true },
  { key: "contacted", name: "Contacted", kind: "OPEN", color: "neutral" },
  { key: "qualified", name: "Qualified", kind: "OPEN", color: "green" },
  { key: "nurture", name: "Nurture", kind: "OPEN", color: "amber" },
  { key: "unqualified", name: "Unqualified", kind: "LOST", color: "neutral" },
  { key: "converted", name: "Converted", kind: "CONVERTED", color: "green" },
  { key: "lost", name: "Lost", kind: "LOST", color: "red" },
];

/**
 * `isSystem` sources are referenced by code (manual entry, import, API,
 * future connectors) — they can be renamed but not deactivated.
 * Integrations identify their source by `key` (e.g. "indiamart").
 */
export const DEFAULT_LEAD_SOURCES: { key: string; name: string; isSystem: boolean }[] = [
  { key: "manual", name: "Manual", isSystem: true },
  { key: "website", name: "Website", isSystem: true },
  { key: "facebook", name: "Facebook", isSystem: true },
  { key: "instagram", name: "Instagram", isSystem: true },
  { key: "indiamart", name: "IndiaMART", isSystem: true },
  { key: "google", name: "Google", isSystem: true },
  { key: "linkedin", name: "LinkedIn", isSystem: true },
  { key: "trade_portal", name: "Trade portal", isSystem: true },

  { key: "referral", name: "Referral", isSystem: false },
  { key: "import", name: "Import", isSystem: true },
  { key: "api", name: "API", isSystem: true },
  { key: "other", name: "Other", isSystem: false },
];

export const LEAD_STATUS_COLORS = ["neutral", "indigo", "green", "amber", "red"] as const;

export type LeadDuplicateRuleKey = "EMAIL" | "PHONE" | "COMPANY_AND_EMAIL" | "COMPANY_AND_PHONE";
export type LeadDuplicateAction = "WARN" | "BLOCK" | "OFF";
export interface LeadDuplicateRule {
  rule: LeadDuplicateRuleKey;
  action: LeadDuplicateAction;
}

export const LEAD_DUPLICATE_RULE_LABELS: Record<LeadDuplicateRuleKey, string> = {
  EMAIL: "Same email (email or alternate email)",
  PHONE: "Same phone number (phone, mobile or WhatsApp)",
  COMPANY_AND_EMAIL: "Same company name and same email",
  COMPANY_AND_PHONE: "Same company name and same phone number",
};

/** Decision 2026-10-01: warn and allow with confirmation by default. */
export const DEFAULT_LEAD_DUPLICATE_RULES: LeadDuplicateRule[] = [
  { rule: "EMAIL", action: "WARN" },
  { rule: "PHONE", action: "WARN" },
  { rule: "COMPANY_AND_EMAIL", action: "OFF" },
  { rule: "COMPANY_AND_PHONE", action: "OFF" },
];
