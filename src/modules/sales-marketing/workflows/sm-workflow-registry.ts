import { z } from "zod";
import type { WorkflowFieldDef } from "@/modules/crm/workflows/workflow-fields";

/**
 * Sales & Marketing Phase 15 — client-safe registry of the S&M workflow
 * orchestrator: instance statuses and their legal transitions, the registered
 * workflow types (what starts them, their steps, typed settings, allow-listed
 * condition fields, the permissions their actions need). A definition can only
 * configure these — never add steps, code, SQL or HTTP calls.
 */

// ── Instance lifecycle ───────────────────────────────────────────

export const SM_WF_STATUSES = {
  RUNNING: { label: "Running", tone: "indigo", live: true },
  WAITING_APPROVAL: { label: "Waiting for approval", tone: "amber", live: true },
  WAITING_EVENT: { label: "Waiting", tone: "sky", live: true },
  SCHEDULED: { label: "Scheduled", tone: "sky", live: true },
  RETRY_PENDING: { label: "Retry pending", tone: "amber", live: true },
  NEEDS_ATTENTION: { label: "Needs attention", tone: "red", live: true },
  FAILED: { label: "Failed", tone: "red", live: true },
  COMPLETED: { label: "Completed", tone: "green", live: false },
  CANCELLED: { label: "Cancelled", tone: "zinc", live: false },
} as const;
export type SmWfStatus = keyof typeof SM_WF_STATUSES;
export const SM_WF_STATUS_KEYS = Object.keys(SM_WF_STATUSES) as SmWfStatus[];
export const SM_WF_TERMINAL: readonly SmWfStatus[] = ["COMPLETED", "CANCELLED"];
/** Picked up by the executor when due. */
export const SM_WF_RUNNABLE: readonly SmWfStatus[] = ["RUNNING", "WAITING_APPROVAL", "WAITING_EVENT", "SCHEDULED", "RETRY_PENDING"];

/** Legal transitions (validated server-side on every change). FAILED / NEEDS_ATTENTION wait for a person. */
export const SM_WF_TRANSITIONS: Record<SmWfStatus, readonly SmWfStatus[]> = {
  RUNNING: ["RUNNING", "WAITING_APPROVAL", "WAITING_EVENT", "SCHEDULED", "RETRY_PENDING", "NEEDS_ATTENTION", "FAILED", "COMPLETED", "CANCELLED"],
  WAITING_APPROVAL: ["RUNNING", "CANCELLED", "COMPLETED"],
  WAITING_EVENT: ["RUNNING", "CANCELLED", "COMPLETED"],
  SCHEDULED: ["RUNNING", "CANCELLED", "COMPLETED"],
  RETRY_PENDING: ["RUNNING", "CANCELLED"],
  NEEDS_ATTENTION: ["RUNNING", "COMPLETED", "CANCELLED"],
  FAILED: ["RUNNING", "COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};
export const canSmWfTransition = (from: SmWfStatus, to: SmWfStatus) => SM_WF_TRANSITIONS[from].includes(to);

/** Operator actions (sales_workflows.approve) and the statuses they apply to. */
export const SM_WF_OPERATOR_ACTIONS = {
  retry: { label: "Retry", from: ["FAILED", "NEEDS_ATTENTION", "RETRY_PENDING"], help: "Runs the step that stopped again. Tasks and notifications already done are not repeated." },
  resolve: { label: "Mark resolved", from: ["FAILED", "NEEDS_ATTENTION", "WAITING_APPROVAL", "WAITING_EVENT", "SCHEDULED"], help: "Ends the workflow as resolved by a person (with a note). Business records are not changed." },
  cancel: { label: "Cancel", from: ["RUNNING", "WAITING_APPROVAL", "WAITING_EVENT", "SCHEDULED", "RETRY_PENDING", "NEEDS_ATTENTION", "FAILED"], help: "Stops the workflow and cancels the open tasks it created. Business records are not changed." },
} as const satisfies Record<string, { label: string; from: readonly SmWfStatus[]; help: string }>;
export type SmWfOperatorAction = keyof typeof SM_WF_OPERATOR_ACTIONS;

export const SM_WF_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000];
export const SM_WF_LIMITS = { stepsPerPass: 20, lockMs: 5 * 60_000, dueBatch: 50, eventBatch: 2000, eventOverlapMs: 5 * 60_000, firstReadLookbackMs: 60 * 60_000, eventLogRetentionDays: 30, maxUsersPerList: 10 } as const;

// ── Events (contract version 1) ──────────────────────────────────

export const SM_WF_EVENT_TYPES = {
  "enquiry.qualified": "Enquiry qualified",
  "enquiry.stage_changed": "Enquiry stage changed",
  "quotation.created": "Quotation created",
  "quotation.submitted": "Quotation submitted for approval",
  "quotation.approved": "Quotation approved",
  "quotation.approval_rejected": "Quotation approval declined",
  "quotation.withdrawn": "Quotation returned to draft",
  "quotation.issued": "Quotation issued",
  "quotation.accepted": "Quotation accepted",
  "quotation.rejected": "Quotation rejected",
  "quotation.revised": "Quotation revised",
  "quotation.cancelled": "Quotation cancelled",
  "quotation.converted": "Quotation converted to a Sales Order",
  "campaign.submitted": "Campaign submitted for approval",
  "campaign.approved": "Campaign approved",
  "campaign.sent_back": "Campaign sent back",
  "campaign.activated": "Campaign activated",
  "campaign.completed": "Campaign completed",
  "campaign.cancelled": "Campaign cancelled",
  "campaign.changed": "Campaign changed",
  "budget.alert_raised": "Budget alert raised",
  "budget.alert_cleared": "Budget alert cleared",
  "attribution.run_finished": "Attribution calculation finished",
  "bulk.job_finished": "Bulk job finished",
} as const;
export type SmWfEventType = keyof typeof SM_WF_EVENT_TYPES;
export const SM_WF_EVENT_TYPE_KEYS = Object.keys(SM_WF_EVENT_TYPES) as [SmWfEventType, ...SmWfEventType[]];

export const SM_WF_ENTITY_TYPES = ["ENQUIRY", "QUOTATION", "CAMPAIGN", "BUDGET_ALERT", "ATTRIBUTION_RUN", "BULK_JOB"] as const;
export type SmWfEntityType = (typeof SM_WF_ENTITY_TYPES)[number];

/** The normalised, validated event every consumer sees. Built only from committed rows of S&M tables — there is no API to post one. */
export const smWfEventSchema = z
  .object({
    schemaVersion: z.literal(1),
    source: z.string().min(1).max(40),
    sourceKey: z.string().min(1).max(120),
    type: z.enum(SM_WF_EVENT_TYPE_KEYS),
    companyId: z.string().uuid(),
    entityType: z.enum(SM_WF_ENTITY_TYPES),
    entityId: z.string().uuid(),
    occurredAt: z.date(),
    actorUserId: z.string().uuid().nullable(),
    /** Small scalar facts only (statuses, ids) — never names, addresses or amounts beyond what the condition fields need. */
    data: z.record(z.string(), z.union([z.string().max(200), z.number(), z.boolean(), z.null()])),
    /** "QUOTATION:<id>"… — instances watching these keys are woken. */
    keys: z.array(z.string().max(80)).max(10),
  })
  .strict();
export type SmWfEvent = z.infer<typeof smWfEventSchema>;
export const smWfKey = (type: string, id: string) => `${type}:${id}`;

// ── Settings (typed, per workflow type) ──────────────────────────

const days = (def: number, max = 60) => z.coerce.number().int().min(1).max(max).default(def);
const hours = (def: number) => z.coerce.number().int().min(1).max(24 * 14).default(def);
const users = z.array(z.string().uuid()).max(SM_WF_LIMITS.maxUsersPerList).default([]);

export const SM_WF_SETTINGS_SCHEMAS = {
  quotation_follow_up: z
    .object({ createTask: z.boolean().default(true), quoteDueDays: days(3), remindAfterDays: days(2), escalateAfterDays: days(5), approvalReminderHours: hours(24), escalationUserIds: users })
    .strict(),
  quotation_to_order: z
    .object({ createTask: z.boolean().default(true), convertDueDays: days(2), remindAfterDays: days(2), escalateAfterDays: days(5), escalationUserIds: users, notifyUserIds: users })
    .strict(),
  campaign_readiness: z
    .object({
      requireAudience: z.boolean().default(true),
      requireChannels: z.boolean().default(true),
      requireApprovedContent: z.boolean().default(true),
      requireBudget: z.boolean().default(true),
      createTask: z.boolean().default(true),
      recheckHours: hours(6),
      approvalReminderHours: hours(24),
      escalateAfterDays: days(3),
      escalationUserIds: users,
    })
    .strict(),
  budget_exception: z.object({ createTask: z.boolean().default(true), reviewDueDays: days(2), escalateAfterDays: days(5), reviewerUserIds: users }).strict(),
  processing_follow_up: z
    .object({
      includeAttribution: z.boolean().default(true),
      includeBulkJobs: z.boolean().default(true),
      includeCompletedWithErrors: z.boolean().default(true),
      /** Also an exception when more than this % of an attribution run's conversions are unattributed (empty = off). */
      unattributedShareAbove: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.coerce.number().min(0).max(100).nullable()).default(null),
      reviewDueDays: days(3),
      notifyUserIds: users,
    })
    .strict(),
} as const;

export type SmWorkflowKey = keyof typeof SM_WF_SETTINGS_SCHEMAS;
export const SM_WORKFLOW_KEYS = Object.keys(SM_WF_SETTINGS_SCHEMAS) as SmWorkflowKey[];
export type SmWfSettings<K extends SmWorkflowKey> = z.infer<(typeof SM_WF_SETTINGS_SCHEMAS)[K]>;

/** How the settings form renders each setting. */
export type SmWfSettingField =
  | { key: string; label: string; type: "boolean"; help?: string }
  | { key: string; label: string; type: "number"; min: number; max: number; unit?: string; help?: string; optional?: boolean }
  | { key: string; label: string; type: "users"; help?: string };

type Perm = { module: string; action: string };

export interface SmWorkflowTypeDef {
  key: SmWorkflowKey;
  name: string;
  description: string;
  entityType: SmWfEntityType;
  entityLabel: string;
  triggers: readonly SmWfEventType[];
  /** Permissions the run-as user (the activator) must hold; re-checked before every action. */
  requiredPermissions: readonly Perm[];
  /** Additionally when "createTask" is on (CRM tasks). */
  taskPermissions?: readonly Perm[];
  settingFields: readonly SmWfSettingField[];
  conditionFields: readonly WorkflowFieldDef[];
  steps: readonly { key: string; label: string; kind: "CHECK" | "TASK" | "NOTIFY" | "WAIT" | "RECORD" | "COMPLETE" }[];
  /** What the workflow never does (shown on the definition page). */
  boundaries: readonly string[];
}

const TASK_PERMS = [
  { module: "crm", action: "view" },
  { module: "crm", action: "create" },
] as const;
const reminders: SmWfSettingField[] = [
  { key: "remindAfterDays", label: "Remind the owner after", type: "number", min: 1, max: 60, unit: "days" },
  { key: "escalateAfterDays", label: "Escalate after", type: "number", min: 1, max: 60, unit: "days" },
  { key: "escalationUserIds", label: "Escalate to", type: "users", help: "Only users who can view the record are notified." },
];
const enumOf = (o: Record<string, string | { label: string }>) => Object.entries(o).map(([value, l]) => ({ value, label: typeof l === "string" ? l : l.label }));

export const SM_WORKFLOWS: Record<SmWorkflowKey, SmWorkflowTypeDef> = {
  quotation_follow_up: {
    key: "quotation_follow_up",
    name: "Qualified enquiry → approved quotation",
    description: "When an enquiry is qualified: make sure it has an owner, give the owner a quotation task, follow the quotation through the existing approval (reminding approvers, never approving), and finish when the quotation is approved or issued.",
    entityType: "ENQUIRY",
    entityLabel: "Enquiry",
    triggers: ["enquiry.qualified"],
    requiredPermissions: [
      { module: "sales_marketing", action: "view_all" },
      { module: "sales_quotations", action: "view_all" },
    ],
    taskPermissions: TASK_PERMS,
    settingFields: [
      { key: "createTask", label: "Create a CRM task for the owner", type: "boolean" },
      { key: "quoteDueDays", label: "Quotation task due in", type: "number", min: 1, max: 60, unit: "days" },
      ...reminders,
      { key: "approvalReminderHours", label: "Remind approvers after", type: "number", min: 1, max: 336, unit: "hours", help: "Approvers with sales_quotations.approve — never the person who prepared or submitted it." },
    ],
    conditionFields: [
      { key: "enquiry.priority", label: "Priority", type: "enum", options: [{ value: "LOW", label: "Low" }, { value: "NORMAL", label: "Normal" }, { value: "HIGH", label: "High" }, { value: "URGENT", label: "Urgent" }] },
      { key: "enquiry.source", label: "Source", type: "enum", options: enumOf({ EMAIL: "Email", PHONE: "Phone", TRADE_SHOW: "Trade show", REFERRAL: "Referral", WEBSITE: "Website", OTHER: "Other" }) },
      { key: "enquiry.estimatedValue", label: "Estimated value (₹)", type: "number" },
      { key: "enquiry.hasCustomer", label: "Is an existing customer", type: "boolean" },
    ],
    steps: [
      { key: "check", label: "Check the enquiry and its owner", kind: "CHECK" },
      { key: "task", label: "Quotation task for the owner", kind: "TASK" },
      { key: "await_quotation", label: "Wait for a quotation", kind: "WAIT" },
      { key: "await_approval", label: "Follow the quotation's approval", kind: "WAIT" },
      { key: "finish", label: "Close the task", kind: "COMPLETE" },
    ],
    boundaries: ["Never creates, prices, approves or issues a quotation — people do, on the quotation screens.", "Approval stays the quotation approval (separation of duties as configured there)."],
  },
  quotation_to_order: {
    key: "quotation_to_order",
    name: "Accepted quotation → Sales Order",
    description: "When a quotation is accepted: check it can be converted (Phase 04 rules), give the owner a conversion task, wait for the Sales Order made from that exact revision, record it and notify. Re-checks for an existing order first, so it never asks twice.",
    entityType: "QUOTATION",
    entityLabel: "Quotation",
    triggers: ["quotation.accepted"],
    requiredPermissions: [
      { module: "sales_quotations", action: "view_all" },
      { module: "sales_orders", action: "view" },
    ],
    taskPermissions: TASK_PERMS,
    settingFields: [
      { key: "createTask", label: "Create a CRM task for the owner", type: "boolean" },
      { key: "convertDueDays", label: "Conversion task due in", type: "number", min: 1, max: 60, unit: "days" },
      ...reminders,
      { key: "notifyUserIds", label: "Also tell when converted", type: "users", help: "Only users who can view Sales Orders are notified." },
    ],
    conditionFields: [
      { key: "quotation.grandTotal", label: "Grand total (₹)", type: "number" },
      { key: "quotation.hasCustomer", label: "Has a customer (not a prospect)", type: "boolean" },
    ],
    steps: [
      { key: "check", label: "Check the accepted revision (and any existing order)", kind: "CHECK" },
      { key: "task", label: "Conversion task for the owner", kind: "TASK" },
      { key: "await_order", label: "Wait for the Sales Order", kind: "WAIT" },
      { key: "record_order", label: "Record the order and notify", kind: "RECORD" },
      { key: "finish", label: "Close the task", kind: "COMPLETE" },
    ],
    boundaries: [
      "Never creates a Sales Order: the colour × size split is entered by a person on the conversion screen, which keeps the Phase 04 one-order-per-revision guarantee.",
      "The Sales Order module stays the owner of the order and its status.",
    ],
  },
  campaign_readiness: {
    key: "campaign_readiness",
    name: "Campaign readiness and launch",
    description: "When a campaign is submitted: check audience snapshots, approved content, channels (with Phase 10 delivery checks) and budget; give the owner a task for what's missing; remind approvers; when approved and still ready, tell the owner it can be launched and finish when it is activated.",
    entityType: "CAMPAIGN",
    entityLabel: "Campaign",
    triggers: ["campaign.submitted", "campaign.approved"],
    requiredPermissions: [
      { module: "marketing_campaigns", action: "view_all" },
      { module: "marketing_delivery", action: "view" },
    ],
    taskPermissions: TASK_PERMS,
    settingFields: [
      { key: "requireAudience", label: "Audience with complete snapshots", type: "boolean" },
      { key: "requireChannels", label: "At least one active channel without delivery problems", type: "boolean" },
      { key: "requireApprovedContent", label: "All campaign content approved", type: "boolean" },
      { key: "requireBudget", label: "Planned budget set and no open budget alert", type: "boolean" },
      { key: "createTask", label: "Create a CRM task for the owner", type: "boolean" },
      { key: "recheckHours", label: "Check again every", type: "number", min: 1, max: 336, unit: "hours" },
      { key: "approvalReminderHours", label: "Remind approvers after", type: "number", min: 1, max: 336, unit: "hours" },
      { key: "escalateAfterDays", label: "Escalate after", type: "number", min: 1, max: 60, unit: "days" },
      { key: "escalationUserIds", label: "Escalate to", type: "users" },
    ],
    conditionFields: [
      { key: "campaign.priority", label: "Priority", type: "enum", options: [{ value: "LOW", label: "Low" }, { value: "NORMAL", label: "Normal" }, { value: "HIGH", label: "High" }] },
      { key: "campaign.plannedBudget", label: "Planned budget (₹)", type: "number" },
    ],
    steps: [
      { key: "check", label: "Check the campaign", kind: "CHECK" },
      { key: "readiness", label: "Readiness checks", kind: "WAIT" },
      { key: "await_approval", label: "Follow the campaign approval", kind: "WAIT" },
      { key: "await_launch", label: "Ready — wait for launch", kind: "WAIT" },
      { key: "finish", label: "Close the task", kind: "COMPLETE" },
    ],
    boundaries: ["Never approves or activates a campaign and never sends messages — delivery runs (Phase 10) do, with their consent and suppression checks.", "Approval is not proof that anything was sent."],
  },
  budget_exception: {
    key: "budget_exception",
    name: "Campaign budget exception",
    description: "When a Phase 12 budget alert is raised: give the campaign owner a review task, notify reviewers, remind and escalate, and finish when the alert clears or the review task is completed.",
    entityType: "BUDGET_ALERT",
    entityLabel: "Budget alert",
    triggers: ["budget.alert_raised"],
    requiredPermissions: [{ module: "marketing_campaigns", action: "view_all" }],
    taskPermissions: TASK_PERMS,
    settingFields: [
      { key: "createTask", label: "Create a CRM review task for the campaign owner", type: "boolean" },
      { key: "reviewDueDays", label: "Review due in", type: "number", min: 1, max: 60, unit: "days" },
      { key: "escalateAfterDays", label: "Escalate after", type: "number", min: 1, max: 60, unit: "days" },
      { key: "reviewerUserIds", label: "Budget reviewers to notify", type: "users" },
    ],
    conditionFields: [
      { key: "alert.kind", label: "Alert", type: "enum", options: [{ value: "OVER_BUDGET", label: "Over budget" }, { value: "WARN_THRESHOLD", label: "Warning threshold" }, { value: "OVER_ALLOCATED", label: "Over-allocated" }, { value: "ENDED_WITH_OPEN_COMMITMENTS", label: "Ended with open commitments" }] },
      { key: "campaign.plannedBudget", label: "Planned budget (₹)", type: "number" },
    ],
    steps: [
      { key: "check", label: "Check the alert is still open", kind: "CHECK" },
      { key: "task", label: "Review task and notifications", kind: "TASK" },
      { key: "await_resolution", label: "Wait for the alert to clear or the review", kind: "WAIT" },
    ],
    boundaries: ["Never changes budgets, expenses, purchase orders or invoices and never starts a payment.", "Only actual and committed spend (Phase 12) raise alerts — not forecasts."],
  },
  processing_follow_up: {
    key: "processing_follow_up",
    name: "Attribution & bulk processing follow-up",
    description: "When an attribution calculation or an S&M bulk job finishes with failures (or too many unattributed conversions): record the result, notify the people responsible, and finish when a later run or a retry succeeds — or a person resolves it.",
    entityType: "ATTRIBUTION_RUN",
    entityLabel: "Run / job",
    triggers: ["attribution.run_finished", "bulk.job_finished"],
    requiredPermissions: [{ module: "marketing_attribution", action: "view" }],
    settingFields: [
      { key: "includeAttribution", label: "Attribution calculations", type: "boolean" },
      { key: "includeBulkJobs", label: "S&M bulk jobs", type: "boolean" },
      { key: "includeCompletedWithErrors", label: "Also jobs that completed with some failures", type: "boolean" },
      { key: "unattributedShareAbove", label: "Flag runs with more unattributed conversions than", type: "number", min: 0, max: 100, unit: "%", optional: true, help: "Empty = off." },
      { key: "reviewDueDays", label: "Remind after", type: "number", min: 1, max: 60, unit: "days" },
      { key: "notifyUserIds", label: "Also notify", type: "users" },
    ],
    conditionFields: [
      { key: "source.kind", label: "Kind", type: "enum", options: [{ value: "ATTRIBUTION", label: "Attribution calculation" }, { value: "BULK", label: "Bulk job" }] },
      { key: "source.failedCount", label: "Failed records", type: "number" },
    ],
    steps: [
      { key: "check", label: "Record the result and its exceptions", kind: "CHECK" },
      { key: "notify", label: "Notify the people responsible", kind: "NOTIFY" },
      { key: "await_resolution", label: "Wait for a successful re-run, retry or a person", kind: "WAIT" },
    ],
    boundaries: ["Never recalculates attribution itself — a retry goes through the Phase 13 run service; bulk retries through Phase 14.", "A job that finished is not proof the data reconciled; exceptions stay open until resolved."],
  },
};

export const SM_WF_OUTCOMES: Record<string, string> = {
  QUOTED: "Quotation approved / issued",
  ENQUIRY_CLOSED: "Enquiry closed",
  QUOTATION_CLOSED: "Quotation rejected or cancelled",
  CONVERTED: "Converted to a Sales Order",
  NOT_ACCEPTED: "Quotation no longer accepted",
  LAUNCHED: "Campaign activated",
  CAMPAIGN_CLOSED: "Campaign cancelled or completed",
  CLEARED: "Alert cleared",
  REVIEWED: "Reviewed (task completed)",
  NO_EXCEPTION: "No exception",
  RESOLVED_BY_RERUN: "A later run succeeded",
  RESOLVED_BY_RETRY: "The retry succeeded",
  RESOLVED_MANUALLY: "Resolved by a person",
  CANCELLED: "Cancelled",
};

export const SM_WF_DEFINITION_STATUSES = { INACTIVE: { label: "Off", tone: "zinc" }, ACTIVE: { label: "On", tone: "green" } } as const;
