/**
 * Client-safe vocabulary for CRM Contacts (no Prisma runtime / server
 * imports). Channel types, contactability channels and option lists are
 * stored as plain text and validated against these registries, so a later
 * phase adds a channel (Telegram, WeChat…) or a list by adding one entry —
 * no migration.
 */

/** Extra ways to reach a contact, stored in crm_contact_channels. */
export const CONTACT_CHANNEL_TYPES = {
  EMAIL: { label: "Email", kind: "email" },
  PHONE: { label: "Phone", kind: "phone" },
  MOBILE: { label: "Mobile", kind: "phone" },
  WHATSAPP: { label: "WhatsApp", kind: "phone" },
  LINKEDIN: { label: "LinkedIn", kind: "url" },
  WEBSITE: { label: "Website", kind: "url" },
  WECHAT: { label: "WeChat", kind: "text" },
  SKYPE: { label: "Skype", kind: "text" },
  OTHER: { label: "Other", kind: "text" },
} as const satisfies Record<string, { label: string; kind: "email" | "phone" | "url" | "text" }>;
export type ContactChannelType = keyof typeof CONTACT_CHANNEL_TYPES;
export const CONTACT_CHANNEL_TYPE_KEYS = Object.keys(CONTACT_CHANNEL_TYPES) as [ContactChannelType, ...ContactChannelType[]];

/**
 * Channels contactability is tracked for. "ALL" is a contact-wide Do Not
 * Contact that overrides every channel. Campaigns (email), sequences, the
 * inbox (WhatsApp/SMS) and telephony check these through canContact().
 */
export const CONTACTABILITY_CHANNELS = {
  ALL: "All channels",
  EMAIL: "Email",
  PHONE: "Phone calls",
  SMS: "SMS",
  WHATSAPP: "WhatsApp",
} as const;
export type ContactabilityChannel = keyof typeof CONTACTABILITY_CHANNELS;
export const CONTACTABILITY_CHANNEL_KEYS = Object.keys(CONTACTABILITY_CHANNELS) as [ContactabilityChannel, ...ContactabilityChannel[]];

export const CONTACTABILITY_STATUSES = {
  ALLOWED: "Allowed",
  DO_NOT_CONTACT: "Do not contact",
  UNSUBSCRIBED: "Unsubscribed",
  BOUNCED: "Bounced / invalid",
} as const;
export type ContactabilityStatus = keyof typeof CONTACTABILITY_STATUSES;
export const CONTACTABILITY_STATUS_KEYS = Object.keys(CONTACTABILITY_STATUSES) as [ContactabilityStatus, ...ContactabilityStatus[]];

/** Where a contactability change came from (free to extend: "UNSUBSCRIBE_LINK", "PROVIDER_BOUNCE"…). */
export const CONTACTABILITY_SOURCES = {
  MANUAL: "Entered by a user",
  CUSTOMER_REQUEST: "Customer request",
  IMPORT: "Import",
  API: "API",
  MERGE: "Contact merge",
  SYSTEM: "System",
} as const;
export type ContactabilitySource = keyof typeof CONTACTABILITY_SOURCES;
export const CONTACTABILITY_SOURCE_KEYS = Object.keys(CONTACTABILITY_SOURCES) as [ContactabilitySource, ...ContactabilitySource[]];
/** Sources a person may pick in the UI / API (MERGE and SYSTEM are written by the system). */
export const USER_CONTACTABILITY_SOURCES = ["MANUAL", "CUSTOMER_REQUEST", "IMPORT", "API"] as const;

/** Severity order — the stricter status wins when two contacts are merged. */
export const CONTACTABILITY_SEVERITY: Record<ContactabilityStatus, number> = { ALLOWED: 0, BOUNCED: 1, UNSUBSCRIBED: 2, DO_NOT_CONTACT: 3 };

export const ADDRESS_TYPES = {
  OFFICE: "Office",
  BILLING: "Billing",
  SHIPPING: "Shipping",
  FACTORY: "Factory",
  HOME: "Home",
  OTHER: "Other",
} as const;
export type AddressType = keyof typeof ADDRESS_TYPES;
export const ADDRESS_TYPE_KEYS = Object.keys(ADDRESS_TYPES) as [AddressType, ...AddressType[]];

import { COMPANY_OPTION_LISTS, DEFAULT_COMPANY_OPTION_VALUES } from "../companies/company-registry";

/** Admin-managed suggestion lists (crm_option_values.list_key). Company lists since Phase 05. */
export const CRM_OPTION_LISTS = {
  contact_department: { label: "Departments", help: "Suggested on the contact form — e.g. Sourcing, Merchandising, Accounts, Quality." },
  contact_designation: { label: "Designations", help: "Suggested on the contact form — e.g. Buyer, Merchandiser, Owner, Director." },
  contact_role: { label: "Relationship roles", help: "The person's role in the deal — e.g. Decision maker, Influencer, Approver, Payments." },
  ...COMPANY_OPTION_LISTS,
} as const;
export type CrmOptionListKey = keyof typeof CRM_OPTION_LISTS;
export const CRM_OPTION_LIST_KEYS = Object.keys(CRM_OPTION_LISTS) as [CrmOptionListKey, ...CrmOptionListKey[]];

export const DEFAULT_OPTION_VALUES: Record<CrmOptionListKey, string[]> = {
  contact_department: ["Sourcing", "Merchandising", "Design", "Quality", "Production", "Accounts", "Logistics", "Management"],
  contact_designation: ["Owner", "Director", "Buyer", "Merchandiser", "Designer", "QA Manager", "Accounts Manager"],
  contact_role: ["Decision maker", "Influencer", "Approver", "Technical contact", "Payments", "Day-to-day contact"],
  ...DEFAULT_COMPANY_OPTION_VALUES,
};

// ── Duplicate rules ──────────────────────────────────────────────

export type ContactDuplicateRuleKey = "EMAIL" | "PHONE" | "MOBILE" | "WHATSAPP" | "NAME_AND_COMPANY" | "NAME_AND_EMAIL";
/** WARN = show and allow with confirmation; BLOCK = refuse; FLAG = save and mark for review; OFF = ignore. */
export type ContactDuplicateAction = "WARN" | "BLOCK" | "FLAG" | "OFF";
export interface ContactDuplicateRule {
  rule: ContactDuplicateRuleKey;
  action: ContactDuplicateAction;
}

export const CONTACT_DUPLICATE_RULE_LABELS: Record<ContactDuplicateRuleKey, string> = {
  EMAIL: "Same email (any email on the contact)",
  PHONE: "This phone number is already on another contact",
  MOBILE: "This mobile number is already on another contact",
  WHATSAPP: "This WhatsApp number is already on another contact",
  NAME_AND_COMPANY: "Same full name at the same company",
  NAME_AND_EMAIL: "Same full name and same email",
};

/**
 * Defaults (Phase 04): personal identifiers warn; the phone rule is off
 * because office landlines are commonly shared by several people at one
 * company.
 */
export const DEFAULT_CONTACT_DUPLICATE_RULES: ContactDuplicateRule[] = [
  { rule: "EMAIL", action: "WARN" },
  { rule: "PHONE", action: "OFF" },
  { rule: "MOBILE", action: "WARN" },
  { rule: "WHATSAPP", action: "WARN" },
  { rule: "NAME_AND_COMPANY", action: "WARN" },
  { rule: "NAME_AND_EMAIL", action: "OFF" },
];

// ── Related records (placeholders for later phases) ──────────────

/**
 * Sections on the contact page whose data arrives in later phases. Each
 * phase replaces its entry with a real provider; until then the page shows
 * this honest placeholder — never sample data.
 */
export const CONTACT_FUTURE_SECTIONS = [
  { key: "activities", title: "Activities", phase: "Phase 09 — Activities, Tasks & Follow-ups" },
  { key: "tasks", title: "Tasks & follow-ups", phase: "Phase 09 — Activities, Tasks & Follow-ups" },
  { key: "appointments", title: "Appointments", phase: "Phase 10 — Calendar & Appointments" },
  { key: "conversations", title: "Conversations", phase: "Phase 11 — Unified Conversations" },
  { key: "sequences", title: "Sequences", phase: "Phase 17 — Sales Sequences" },
] as const;
