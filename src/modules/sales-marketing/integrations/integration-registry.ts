import { z } from "zod";

/**
 * Phase 16 — the S&M integration ecosystem's fixed vocabulary. Client-safe
 * (no Prisma): lifecycle states and transitions, integration kinds, API
 * scopes (each tied to the ERP permission its run-as user must hold), the
 * public event catalogue (versioned, minimal payloads) and the limits.
 * The UI, the API, the docs and the tests read this one file.
 */

// ── Registry lifecycle ───────────────────────────────────────────

export const INTEGRATION_STATUSES = {
  DRAFT: { label: "Draft", tone: "zinc", help: "Being set up; not used yet." },
  CONFIGURED: { label: "Configured", tone: "zinc", help: "Set up; not used or checked yet." },
  PENDING_VERIFICATION: { label: "Waiting for first success", tone: "amber", help: "Set up; waiting for its first successful call or delivery." },
  CONNECTED: { label: "Connected", tone: "green", help: "The last call, check or delivery succeeded." },
  DEGRADED: { label: "Degraded", tone: "amber", help: "Recent failures; still in use." },
  DISABLED: { label: "Disabled", tone: "zinc", help: "Turned off by a person; not used." },
  REVOKED: { label: "Revoked", tone: "red", help: "Its credential was revoked. Final." },
  FAILED: { label: "Failed", tone: "red", help: "Not working (repeated failures or a failed check)." },
} as const;
export type IntegrationStatus = keyof typeof INTEGRATION_STATUSES;
export const INTEGRATION_STATUS_KEYS = Object.keys(INTEGRATION_STATUSES) as IntegrationStatus[];

/**
 * Legal transitions. Health changes (CONNECTED ↔ DEGRADED ↔ FAILED,
 * PENDING_VERIFICATION → CONNECTED) come from real outcomes; DISABLED and
 * REVOKED only from a person. REVOKED is final.
 */
export const INTEGRATION_TRANSITIONS: Record<IntegrationStatus, readonly IntegrationStatus[]> = {
  DRAFT: ["CONFIGURED", "PENDING_VERIFICATION", "DISABLED", "REVOKED"],
  CONFIGURED: ["PENDING_VERIFICATION", "CONNECTED", "DEGRADED", "FAILED", "DISABLED", "REVOKED"],
  PENDING_VERIFICATION: ["CONNECTED", "DEGRADED", "FAILED", "DISABLED", "REVOKED", "CONFIGURED"],
  CONNECTED: ["DEGRADED", "FAILED", "DISABLED", "REVOKED", "PENDING_VERIFICATION", "CONFIGURED"],
  DEGRADED: ["CONNECTED", "FAILED", "DISABLED", "REVOKED", "PENDING_VERIFICATION", "CONFIGURED"],
  FAILED: ["CONNECTED", "DEGRADED", "DISABLED", "REVOKED", "PENDING_VERIFICATION", "CONFIGURED"],
  DISABLED: ["CONFIGURED", "PENDING_VERIFICATION", "CONNECTED", "DEGRADED", "FAILED", "REVOKED"],
  REVOKED: [],
};
export const canIntegrationTransition = (from: IntegrationStatus, to: IntegrationStatus) => from === to || INTEGRATION_TRANSITIONS[from].includes(to);
/** Statuses only a person sets (health refreshes never leave or enter them). */
export const MANUAL_STATUSES: readonly IntegrationStatus[] = ["DISABLED", "REVOKED"];

export const INTEGRATION_KINDS = {
  DELIVERY_PROVIDER: { label: "Marketing delivery provider", managedIn: "SALES_MARKETING", href: "/sales-marketing/delivery" },
  API_CLIENT: { label: "API client (S&M API key)", managedIn: "SALES_MARKETING", href: null },
  WEBHOOK_SUBSCRIPTION: { label: "Outgoing webhook (S&M events)", managedIn: "SALES_MARKETING", href: null },
  CRM_CAPTURE_KEY: { label: "CRM lead capture API key", managedIn: "CRM", href: "/crm/settings?tab=api-keys" },
  CRM_INBOUND_WEBHOOK: { label: "CRM incoming lead webhook", managedIn: "CRM", href: "/crm/settings?tab=webhooks" },
  CRM_WEBHOOK_SUBSCRIPTION: { label: "Outgoing webhook (CRM events)", managedIn: "CRM", href: "/crm/settings?tab=webhooks-out" },
} as const;
export type IntegrationKind = keyof typeof INTEGRATION_KINDS;

export const CAPABILITY_LABELS: Record<string, string> = {
  "send.email": "Send email",
  "send.sms": "Send SMS",
  "send.whatsapp": "Send WhatsApp",
  "webhook.delivery_status": "Receives delivery status callbacks",
  "webhook.unsubscribe": "Receives unsubscribes / complaints",
  "check.connection": "Connection check",
  "api.read": "Reads via the API",
  "api.write": "Writes via the API",
  "sync.enquiries": "Enquiry intake sync",
  "events.outbound": "Receives ERP events (webhooks)",
  "leads.ingest": "Creates CRM leads",
};

// ── API scopes ───────────────────────────────────────────────────

/**
 * Each scope names what a key may call AND the ERP permission its run-as user
 * must currently hold. Both are checked on every request; record visibility
 * is then the module service's own rule for that user.
 */
export const SM_API_SCOPES = {
  "sm.campaigns:read": { label: "Read campaigns", permission: { module: "marketing_campaigns", action: "view" } },
  "sm.performance:read": { label: "Read campaign performance (attribution & ROI)", permission: { module: "marketing_attribution", action: "view" } },
  "sm.segments:read": { label: "Read segment metadata (no members)", permission: { module: "marketing_segments", action: "view" } },
  "sm.quotations:read": { label: "Read quotations", permission: { module: "sales_quotations", action: "view" } },
  "sm.enquiries:read": { label: "Read enquiries created through this integration", permission: { module: "sales_marketing", action: "view" } },
  "sm.enquiries:write": { label: "Submit / update enquiries (intake)", permission: { module: "sales_marketing", action: "create" } },
  "sm.jobs:read": { label: "Read status of jobs started by this key's user", permission: { module: "sales_marketing", action: "view" } },
  "sm.exports:create": { label: "Start approved exports (background jobs)", permission: { module: "sales_marketing", action: "export" } },
  "sm.webhooks:manage": { label: "Manage this company's S&M webhook subscriptions", permission: { module: "sales_integrations", action: "edit" } },
} as const;
export type SmApiScope = keyof typeof SM_API_SCOPES;
export const SM_API_SCOPE_KEYS = Object.keys(SM_API_SCOPES) as [SmApiScope, ...SmApiScope[]];

export const SM_API_KEY_PURPOSE = "SALES_MARKETING_API";
export const SM_API_BASE = "/api/v1/integrations/sales-marketing";
export const SM_API_VERSION = "2026-11-06";

export const SM_API_LIMITS = {
  /** Per key unless the key sets its own (1–600). */
  defaultPerKeyPerMinute: 120,
  perCompanyPerMinute: 600,
  /** Writes are tighter. */
  writePerKeyPerMinute: 60,
  maxBodyBytes: 64 * 1024,
  maxPageSize: 100,
  maxDateRangeDays: 366,
  maxKeysPerCompany: 20,
  idempotencyHours: 24,
  usageRetentionDays: 90,
} as const;

// ── Public events (outgoing webhooks), contract version 1 ─────────

/**
 * Only events that come from real, committed transitions (Phase 15 event
 * sources and workflow transitions). Payloads are minimal ids and statuses;
 * receivers fetch details through the API with their own scopes.
 */
export const SM_PUBLIC_EVENTS = {
  "sm.enquiry.qualified": { label: "Enquiry qualified", entity: "ENQUIRY", group: "Enquiries" },
  "sm.enquiry.stage_changed": { label: "Enquiry stage changed", entity: "ENQUIRY", group: "Enquiries" },
  "sm.quotation.created": { label: "Quotation created", entity: "QUOTATION", group: "Quotations" },
  "sm.quotation.submitted": { label: "Quotation submitted for approval", entity: "QUOTATION", group: "Quotations" },
  "sm.quotation.approved": { label: "Quotation approved", entity: "QUOTATION", group: "Quotations" },
  "sm.quotation.approval_rejected": { label: "Quotation approval declined", entity: "QUOTATION", group: "Quotations" },
  "sm.quotation.issued": { label: "Quotation issued", entity: "QUOTATION", group: "Quotations" },
  "sm.quotation.accepted": { label: "Quotation accepted", entity: "QUOTATION", group: "Quotations" },
  "sm.quotation.rejected": { label: "Quotation rejected", entity: "QUOTATION", group: "Quotations" },
  "sm.quotation.revised": { label: "Quotation revised", entity: "QUOTATION", group: "Quotations" },
  "sm.quotation.cancelled": { label: "Quotation cancelled", entity: "QUOTATION", group: "Quotations" },
  "sm.quotation.converted": { label: "Quotation converted to a Sales Order", entity: "QUOTATION", group: "Quotations" },
  "sm.campaign.submitted": { label: "Campaign submitted for approval", entity: "CAMPAIGN", group: "Campaigns" },
  "sm.campaign.approved": { label: "Campaign approved", entity: "CAMPAIGN", group: "Campaigns" },
  "sm.campaign.sent_back": { label: "Campaign sent back", entity: "CAMPAIGN", group: "Campaigns" },
  "sm.campaign.activated": { label: "Campaign activated", entity: "CAMPAIGN", group: "Campaigns" },
  "sm.campaign.completed": { label: "Campaign completed", entity: "CAMPAIGN", group: "Campaigns" },
  "sm.campaign.cancelled": { label: "Campaign cancelled", entity: "CAMPAIGN", group: "Campaigns" },
  "sm.budget.alert_raised": { label: "Budget threshold exceeded", entity: "BUDGET_ALERT", group: "Budgets" },
  "sm.budget.alert_cleared": { label: "Budget alert cleared", entity: "BUDGET_ALERT", group: "Budgets" },
  "sm.attribution.run_finished": { label: "Attribution run finished", entity: "ATTRIBUTION_RUN", group: "Attribution" },
  "sm.bulk.job_finished": { label: "Bulk job finished", entity: "BULK_JOB", group: "Background jobs" },
  "sm.workflow.completed": { label: "Workflow completed", entity: "WORKFLOW_INSTANCE", group: "Workflows" },
  "sm.workflow.needs_attention": { label: "Workflow needs attention", entity: "WORKFLOW_INSTANCE", group: "Workflows" },
} as const;
export type SmPublicEventType = keyof typeof SM_PUBLIC_EVENTS;
export const SM_PUBLIC_EVENT_TYPES = Object.keys(SM_PUBLIC_EVENTS) as SmPublicEventType[];
export const isSmPublicEventType = (t: unknown): t is SmPublicEventType => typeof t === "string" && t in SM_PUBLIC_EVENTS;
export const SM_EVENT_VERSION = 1;

/** Internal Phase 15 type → public type (internal-only types, e.g. campaign.changed / quotation.withdrawn, are not published). */
export const INTERNAL_TO_PUBLIC: Record<string, SmPublicEventType> = Object.fromEntries(
  SM_PUBLIC_EVENT_TYPES.filter((t) => !t.startsWith("sm.workflow.")).map((t) => [t.slice(3), t])
) as Record<string, SmPublicEventType>;

/** The only payload keys a public event may carry, per type prefix. Everything else is dropped. */
export const PUBLIC_PAYLOAD_KEYS: Record<string, readonly string[]> = {
  enquiry: ["toStage"],
  quotation: ["revisionNumber"],
  campaign: [],
  budget: ["kind", "campaignId"],
  attribution: ["status", "modelId", "conversions", "unattributed"],
  bulk: ["status", "recordType", "actionKey", "failedCount", "retryOfJobId"],
  workflow: ["workflowKey", "recordType", "recordId", "outcome", "errorCode"],
};

export const publicPayloadValue = z.union([z.string().max(200), z.number(), z.boolean(), z.null()]);
/** The documented public envelope (v1). */
export const smPublicEnvelopeSchema = z
  .object({
    id: z.string().uuid(),
    type: z.string(),
    version: z.literal(1),
    occurredAt: z.string(),
    test: z.boolean(),
    companyId: z.string().uuid(),
    correlationId: z.string().nullable(),
    data: z.object({ entity: z.object({ type: z.string(), id: z.string().uuid() }), payload: z.record(z.string(), publicPayloadValue) }).strict(),
  })
  .strict();
export type SmPublicEnvelope = z.infer<typeof smPublicEnvelopeSchema>;

export const SM_WEBHOOK_LIMITS = {
  maxSubscriptionsPerCompany: 20,
  /** Queued + retrying per subscription; beyond this new events wait (backpressure). */
  maxPendingPerSubscription: 1000,
  /** Sends per subscription per worker tick (15 s), one at a time per endpoint. */
  maxSendsPerSubscriptionPerTick: 10,
  eventRetentionDays: 30,
} as const;

// ── Enquiry intake sync ──────────────────────────────────────────

export const INTAKE_SYSTEM_RE = /^[a-z0-9][a-z0-9_.-]{0,39}$/;
/** Fields the external system may keep updating while nobody changed them in the ERP and the enquiry is still at intake. */
export const INTAKE_UPDATABLE_FIELDS = ["subject", "remarks", "priority"] as const;
/** Fields set only at creation; a later change is always a conflict (no service updates them). */
export const INTAKE_CREATE_ONLY_FIELDS = ["prospectName", "prospectContactPerson", "prospectEmail", "prospectPhone", "prospectCountry", "lines"] as const;
/** Stages in which external updates may still apply (intake). */
export const INTAKE_OPEN_STAGES = ["NEW", "UNDER_REVIEW"] as const;

export const CONFLICT_STATUSES = {
  OPEN: { label: "Open", tone: "amber" },
  KEPT_ERP: { label: "Kept the ERP value", tone: "zinc" },
  APPLIED_EXTERNAL: { label: "Applied the external value", tone: "green" },
  DISMISSED: { label: "Dismissed", tone: "zinc" },
} as const;
export const CONFLICT_REASONS = {
  ERP_CHANGED: "Changed in the ERP since the last sync",
  RECORD_ADVANCED: "The enquiry is past intake — the ERP owns it now",
  NOT_UPDATABLE: "Set only when the enquiry is created",
} as const;
