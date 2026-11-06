/**
 * Marketing campaigns registry (Sales & Marketing Phase 08, 2026-11-04).
 * Client-safe — no Prisma runtime. Statuses, transitions, the system metric
 * catalogue (what is measured and from where) and the default type /
 * objective lists offered to a company the first time it opens Campaigns.
 * Rules: docs/sales-marketing/PHASE_08_CAMPAIGNS.md §3–§5.
 */

export type CampaignStatusKey = "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELLED";
export type CampaignPriorityKey = "LOW" | "NORMAL" | "HIGH";
export type LookupKindKey = "TYPE" | "OBJECTIVE" | "SPEND_CATEGORY";
export type RevisionStatusKey = "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "WITHDRAWN";

export const CAMPAIGN_STATUSES: Record<CampaignStatusKey, { label: string; tone: "zinc" | "amber" | "indigo" | "green" | "red"; open: boolean; help: string }> = {
  DRAFT: { label: "Draft", tone: "zinc", open: true, help: "Being planned. Submit it for approval when the plan is ready." },
  PENDING_APPROVAL: { label: "Waiting for approval", tone: "amber", open: true, help: "Someone other than the preparer must approve the plan." },
  APPROVED: { label: "Approved", tone: "indigo", open: true, help: "Plan approved. Activate it when it actually starts." },
  ACTIVE: { label: "Active", tone: "green", open: true, help: "Running. Activating here doesn't send or publish anything." },
  PAUSED: { label: "Paused", tone: "amber", open: true, help: "On hold. Resume or complete it." },
  COMPLETED: { label: "Completed", tone: "zinc", open: false, help: "Finished. Kept for reporting." },
  CANCELLED: { label: "Cancelled", tone: "red", open: false, help: "Cancelled. Kept for reporting." },
};
export const CAMPAIGN_STATUS_KEYS = Object.keys(CAMPAIGN_STATUSES) as CampaignStatusKey[];

export const PRIORITY_LABELS: Record<CampaignPriorityKey, string> = { LOW: "Low", NORMAL: "Normal", HIGH: "High" };

/** Actions the lifecycle service accepts, with the statuses they start from. */
export const CAMPAIGN_ACTIONS = {
  submit: { from: ["DRAFT"], label: "Submit for approval" },
  "return-to-draft": { from: ["PENDING_APPROVAL"], label: "Return to draft" },
  "send-back": { from: ["PENDING_APPROVAL"], label: "Send back" },
  approve: { from: ["PENDING_APPROVAL"], label: "Approve" },
  activate: { from: ["APPROVED"], label: "Activate" },
  pause: { from: ["ACTIVE"], label: "Pause" },
  resume: { from: ["PAUSED"], label: "Resume" },
  complete: { from: ["ACTIVE", "PAUSED"], label: "Complete" },
  cancel: { from: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "ACTIVE", "PAUSED"], label: "Cancel" },
} as const satisfies Record<string, { from: readonly CampaignStatusKey[]; label: string }>;
export type CampaignActionKey = keyof typeof CAMPAIGN_ACTIONS;

/** After the first approval, these plan fields change only through an approved revision. */
export const PLAN_FIELDS = ["plannedStartDate", "plannedEndDate", "plannedBudget", "budgetNotes"] as const;

export const REVISION_STATUS_LABELS: Record<RevisionStatusKey, string> = {
  PENDING_APPROVAL: "Waiting for approval",
  APPROVED: "Approved",
  REJECTED: "Sent back",
  WITHDRAWN: "Withdrawn",
};

export type MetricUnitKey = "COUNT" | "CURRENCY" | "PERCENT" | "NUMBER";
export const METRIC_UNITS: Record<MetricUnitKey, string> = { COUNT: "Count", CURRENCY: "₹ amount", PERCENT: "%", NUMBER: "Number" };

export type SystemMetricKey =
  | "LEADS"
  | "CONVERTED_LEADS"
  | "ENQUIRIES"
  | "ACCEPTED_QUOTATION_COUNT"
  | "ACCEPTED_QUOTATION_VALUE"
  | "BOOKED_ORDER_COUNT"
  | "BOOKED_ORDER_VALUE"
  | "INVOICED_VALUE";

/** Measured from records that carry this campaign — linked-record counts, not attribution. */
export const SYSTEM_METRICS: Record<SystemMetricKey, { label: string; unit: MetricUnitKey; source: string }> = {
  LEADS: { label: "Leads", unit: "COUNT", source: "CRM leads with this campaign (archived ones included)." },
  CONVERTED_LEADS: { label: "Converted leads", unit: "COUNT", source: "CRM leads with this campaign that were converted." },
  ENQUIRIES: { label: "Sales enquiries", unit: "COUNT", source: "Sales Enquiries with this campaign, except cancelled ones." },
  ACCEPTED_QUOTATION_COUNT: { label: "Accepted quotations", unit: "COUNT", source: "Accepted quotation revisions of quotations with this campaign (Phase 05 rule, decision date)." },
  ACCEPTED_QUOTATION_VALUE: { label: "Accepted quotation value", unit: "CURRENCY", source: "Value of those accepted revisions, after discount, before charges and GST (Phase 05 rule)." },
  BOOKED_ORDER_COUNT: { label: "Booked orders", unit: "COUNT", source: "Sales Orders with this campaign that count as booked (Phase 05 rule, order date)." },
  BOOKED_ORDER_VALUE: { label: "Booked order value", unit: "CURRENCY", source: "Value of those booked orders before GST, INR (Phase 05 rule)." },
  INVOICED_VALUE: { label: "Invoiced value", unit: "CURRENCY", source: "Posted Sales Invoices of those orders before GST (Phase 05 rule, invoice date)." },
};
export const SYSTEM_METRIC_KEYS = Object.keys(SYSTEM_METRICS) as SystemMetricKey[];

/** Offered once per company (then editable in Campaign settings) — examples, not a fixed taxonomy. */
export const DEFAULT_LOOKUPS: Record<LookupKindKey, { code: string; name: string }[]> = {
  TYPE: [
    { code: "TRADE_FAIR", name: "Trade fair / exhibition" },
    { code: "SHOWROOM", name: "Showroom / buyer visit" },
    { code: "CATALOGUE", name: "Catalogue / collection launch" },
    { code: "EMAIL", name: "Email campaign" },
    { code: "SOCIAL", name: "Social media" },
    { code: "ADS", name: "Online advertising" },
    { code: "AGENT_DRIVE", name: "Agent / channel drive" },
    { code: "OTHER", name: "Other" },
  ],
  OBJECTIVE: [
    { code: "LEADS", name: "Lead generation" },
    { code: "ENQUIRIES", name: "New enquiries" },
    { code: "SALES", name: "Sales growth" },
    { code: "RETENTION", name: "Customer retention" },
    { code: "AWARENESS", name: "Brand / collection awareness" },
    { code: "EVENT", name: "Event participation" },
  ],
  // Phase 12: budget lines are split by these.
  SPEND_CATEGORY: [
    { code: "MEDIA", name: "Media / advertising" },
    { code: "CONTENT", name: "Content & creative" },
    { code: "EVENTS", name: "Events & exhibitions" },
    { code: "PRINT", name: "Print & samples" },
    { code: "MESSAGING", name: "Messaging (email / SMS / WhatsApp)" },
    { code: "AGENCY", name: "Agency & services" },
    { code: "OTHER", name: "Other" },
  ],
};

export const CAMPAIGN_EVENT_LABELS: Record<string, string> = {
  CAMPAIGN_CREATED: "Campaign created",
  CAMPAIGN_UPDATED: "Details changed",
  OWNER_CHANGED: "Owner changed",
  SUBMITTED: "Submitted for approval",
  RETURNED_TO_DRAFT: "Returned to draft",
  SENT_BACK: "Sent back",
  APPROVED: "Approved",
  AUTO_APPROVED: "Approved automatically (approval not required)",
  ACTIVATED: "Activated",
  PAUSED: "Paused",
  RESUMED: "Resumed",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  REVISION_REQUESTED: "Plan change requested",
  REVISION_APPROVED: "Plan change approved",
  REVISION_REJECTED: "Plan change sent back",
  REVISION_WITHDRAWN: "Plan change withdrawn",
  METRIC_ADDED: "Success metric added",
  METRIC_UPDATED: "Success metric changed",
  METRIC_REMOVED: "Success metric removed",
  MANUAL_RESULT: "Manual result recorded",
  EXPENSE_LINKED: "Expense linked",
  EXPENSE_UNLINKED: "Expense unlinked",
};

/** A CRM task on a campaign is a milestone when its metadata says so. */
export const MILESTONE_FLAG = "milestone";
