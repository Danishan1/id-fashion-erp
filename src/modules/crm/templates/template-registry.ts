import { CHANNEL_TYPES, type ChannelType } from "@/core/communication/CommunicationProvider";

/**
 * Client-safe registry for CRM message templates (Phase 12). Stored as text
 * and validated here (plus CHECK constraints), like every other CRM registry:
 * a new channel, status or merge field is one entry — no migration.
 *
 * Templates are provider-neutral. They hold text for a channel TYPE (email,
 * SMS, WhatsApp…); which provider eventually delivers it is the channel's
 * business (src/core/communication). Nothing here knows about Meta, Twilio or
 * an SMTP server.
 */

export { CHANNEL_TYPES, type ChannelType };

// ── Status lifecycle ────────────────────────────────────────────

export const TEMPLATE_STATUSES = {
  DRAFT: { label: "Draft", tone: "amber", help: "Being written — not offered when sending." },
  ACTIVE: { label: "Active", tone: "green", help: "Offered when sending; new messages use the current version." },
  ARCHIVED: { label: "Archived", tone: "zinc", help: "Kept for history; can't be selected for new messages." },
} as const;
export type TemplateStatus = keyof typeof TEMPLATE_STATUSES;
export const TEMPLATE_STATUS_KEYS = Object.keys(TEMPLATE_STATUSES) as [TemplateStatus, ...TemplateStatus[]];

/** Lifecycle actions and the statuses they start from. */
export const TEMPLATE_ACTIONS = {
  activate: { from: ["DRAFT"], to: "ACTIVE", label: "Activate" },
  deactivate: { from: ["ACTIVE"], to: "DRAFT", label: "Deactivate" },
  archive: { from: ["DRAFT", "ACTIVE"], to: "ARCHIVED", label: "Archive" },
  restore: { from: ["ARCHIVED"], to: "DRAFT", label: "Restore" },
} as const satisfies Record<string, { from: readonly TemplateStatus[]; to: TemplateStatus; label: string }>;
export type TemplateAction = keyof typeof TEMPLATE_ACTIONS;

export function canApplyTemplateAction(status: string, action: TemplateAction): boolean {
  return (TEMPLATE_ACTIONS[action].from as readonly string[]).includes(status);
}

// ── Channels ────────────────────────────────────────────────────

export interface TemplateProviderField {
  /** Key stored in the version's provider metadata and handed to the provider adapter. */
  key: string;
  label: string;
  help: string;
  pattern: string;
  maxLength: number;
}

export interface TemplateChannelConfig {
  label: string;
  /** Offered in the editor today. Other channel types are allowed by the data model for later phases. */
  enabled: boolean;
  /** "required": email subject line; "none": the channel has no subject. */
  subject: "required" | "none";
  /** Hard limit for the rendered body (error above it). */
  maxBodyLength: number;
  /** Soft limit (warning above it). */
  recommendedMaxLength?: number;
  recommendedMaxReason?: string;
  /** Show SMS part counting. */
  smsSegments?: boolean;
  /** Optional provider references (an externally approved template's name…), stored per version. */
  providerFields: TemplateProviderField[];
  /** Plain-text only today: the ERP has no HTML email pipeline, and providers receive `text`. */
  html: false;
}

export const TEMPLATE_MAX_BODY = 10_000;
export const TEMPLATE_MAX_SUBJECT = 250;
export const RENDERED_MAX_SUBJECT = 300;
export const SMS_MAX_LENGTH = 1600;

export const TEMPLATE_CHANNELS: Record<ChannelType, TemplateChannelConfig> = {
  EMAIL: { label: "Email", enabled: true, subject: "required", maxBodyLength: TEMPLATE_MAX_BODY, providerFields: [], html: false },
  SMS: { label: "SMS", enabled: true, subject: "none", maxBodyLength: SMS_MAX_LENGTH, smsSegments: true, providerFields: [], html: false },
  WHATSAPP: {
    label: "WhatsApp",
    enabled: true,
    subject: "none",
    maxBodyLength: 4096,
    recommendedMaxLength: 1024,
    recommendedMaxReason: "WhatsApp's pre-approved templates allow at most 1,024 characters in the body.",
    providerFields: [
      {
        key: "externalTemplateName",
        label: "Approved template name (optional)",
        help: "Only if your WhatsApp provider requires pre-approved templates: the name it was approved under. Passed to the provider with each message.",
        pattern: "^[A-Za-z0-9_.-]{1,120}$",
        maxLength: 120,
      },
      { key: "language", label: "Template language (optional)", help: "Language code of the approved template, e.g. en or en_US.", pattern: "^[A-Za-z]{2,3}([_-][A-Za-z0-9]{2,8})?$", maxLength: 15 },
    ],
    html: false,
  },
  FACEBOOK_MESSENGER: { label: "Facebook Messenger", enabled: false, subject: "none", maxBodyLength: 2000, providerFields: [], html: false },
  INSTAGRAM: { label: "Instagram", enabled: false, subject: "none", maxBodyLength: 1000, providerFields: [], html: false },
  WEB_CHAT: { label: "Website chat", enabled: false, subject: "none", maxBodyLength: 4000, providerFields: [], html: false },
  OTHER: { label: "Other", enabled: false, subject: "none", maxBodyLength: 4096, providerFields: [], html: false },
};

export const TEMPLATE_CHANNEL_TYPES = CHANNEL_TYPES.filter((c) => TEMPLATE_CHANNELS[c].enabled) as ChannelType[];

export function isTemplateChannel(value: unknown): value is ChannelType {
  return typeof value === "string" && TEMPLATE_CHANNEL_TYPES.includes(value as ChannelType);
}

// ── Categories (crm_option_values) ──────────────────────────────

/** Template categories are a CRM option list: create / rename / archive through the existing option-values settings API. */
export const TEMPLATE_CATEGORY_LIST_KEY = "template_category";
export const TEMPLATE_OPTION_LISTS = {
  template_category: { label: "Template categories", help: "Groups message templates — e.g. Sales, Follow-up, Appointment, Payment." },
} as const;
export const DEFAULT_TEMPLATE_OPTION_VALUES: Record<keyof typeof TEMPLATE_OPTION_LISTS, string[]> = {
  template_category: ["General", "Sales", "Follow-up", "Appointment", "Quotation", "Payment", "Support", "Onboarding", "Marketing", "Internal"],
};

// ── Merge fields ────────────────────────────────────────────────

/**
 * Records a template can draw values from. The renderer only ever sees a flat
 * `{ "contact.first_name": "Rahul" }` map built by the server from these
 * definitions — templates can never reach arbitrary database fields.
 * Adding an entity = one entry here + one loader in template-context.ts.
 */
export const TEMPLATE_ENTITIES = {
  contact: { label: "Contact" },
  company: { label: "Company" },
  opportunity: { label: "Opportunity" },
  lead: { label: "Lead" },
  user: { label: "User (sender)" },
  appointment: { label: "Appointment" },
} as const;
export type TemplateEntity = keyof typeof TEMPLATE_ENTITIES;
export const TEMPLATE_ENTITY_KEYS = Object.keys(TEMPLATE_ENTITIES) as TemplateEntity[];

export interface TemplateVariableDef {
  key: string;
  entity: TemplateEntity;
  label: string;
  /** Used by previews when no real record is chosen. */
  sample: string;
}

const v = (entity: TemplateEntity, field: string, label: string, sample: string): TemplateVariableDef => ({ key: `${entity}.${field}`, entity, label, sample });

export const TEMPLATE_VARIABLES: TemplateVariableDef[] = [
  v("contact", "first_name", "First name", "Rahul"),
  v("contact", "last_name", "Last name", "Sharma"),
  v("contact", "full_name", "Full name", "Rahul Sharma"),
  v("contact", "email", "Email", "rahul.sharma@abctextiles.example"),
  v("contact", "phone", "Phone", "+91 98100 12345"),
  v("contact", "mobile", "Mobile", "+91 98100 12345"),
  v("contact", "whatsapp", "WhatsApp", "+91 98100 12345"),
  v("contact", "designation", "Designation", "Head of Sourcing"),
  v("contact", "department", "Department", "Sourcing"),
  v("contact", "company", "Company", "ABC Textiles"),
  v("company", "name", "Company name", "ABC Textiles"),
  v("company", "legal_name", "Legal name", "ABC Textiles Pvt. Ltd."),
  v("company", "email", "Email", "info@abctextiles.example"),
  v("company", "phone", "Phone", "+91 22 4000 1000"),
  v("company", "website", "Website", "www.abctextiles.example"),
  v("company", "city", "City", "Mumbai"),
  v("company", "address", "Address", "Mumbai, Maharashtra 400001, India"),
  v("opportunity", "name", "Opportunity name", "Website Project"),
  v("opportunity", "number", "Opportunity number", "OPP-0042"),
  v("opportunity", "value", "Value", "INR 2,50,000.00"),
  v("opportunity", "stage", "Stage", "Demo"),
  v("opportunity", "pipeline", "Pipeline", "Sales"),
  v("opportunity", "probability", "Probability", "60%"),
  v("opportunity", "expected_close_date", "Expected close date", "15 Nov 2026"),
  v("opportunity", "owner", "Owner", "Ashish Mehta"),
  v("lead", "full_name", "Lead name", "Rahul Sharma"),
  v("lead", "first_name", "First name", "Rahul"),
  v("lead", "number", "Lead number", "LEAD-0107"),
  v("lead", "source", "Lead source", "Website"),
  v("lead", "status", "Lead status", "Qualified"),
  v("lead", "score", "Lead score", "72"),
  v("lead", "company_name", "Company name", "ABC Textiles"),
  v("user", "name", "User name", "Ashish Mehta"),
  v("user", "first_name", "User first name", "Ashish"),
  v("user", "email", "User email", "ashish@indradhar.example"),
  v("user", "phone", "User phone", "+91 98200 55555"),
  v("appointment", "title", "Appointment title", "Product demo"),
  v("appointment", "date", "Appointment date", "Thu, 15 Oct, 2026"),
  v("appointment", "time", "Appointment time", "11:00 am"),
  v("appointment", "end_time", "End time", "12:00 pm"),
  v("appointment", "timezone", "Time zone", "IST"),
  v("appointment", "location", "Location", "ABC Textiles, Lower Parel"),
  v("appointment", "meeting_link", "Meeting link", "https://meet.example.com/abc-demo"),
];

export const TEMPLATE_VARIABLE_MAP: ReadonlyMap<string, TemplateVariableDef> = new Map(TEMPLATE_VARIABLES.map((d) => [d.key, d]));
export const SAMPLE_VALUES: Readonly<Record<string, string>> = Object.fromEntries(TEMPLATE_VARIABLES.map((d) => [d.key, d.sample]));

/**
 * Not available yet: quotations now exist (Sales & Marketing, 2026-10-29) but
 * have no template entity — add a `quotation` entity above and a loader in
 * template-context.ts to support `{{quotation.number}}`.
 */
export const UNAVAILABLE_ENTITIES: Record<string, string> = {
  quotation: "Quotation fields aren't available in templates yet.",
};

// ── Validation issue codes ──────────────────────────────────────

export type TemplateIssueSeverity = "error" | "warning";
/** CRM-level issues (the template itself) vs provider-level issues (what a channel's provider accepts). */
export type TemplateIssueSource = "template" | "provider";
export interface TemplateIssue {
  code: string;
  severity: TemplateIssueSeverity;
  source: TemplateIssueSource;
  message: string;
  field?: "name" | "subject" | "body" | "channelType" | "categoryId" | "providerMetadata" | "context";
  variable?: string;
}
