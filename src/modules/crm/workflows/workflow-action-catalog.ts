import type { WorkflowEntity } from "./workflow-fields";

/**
 * Client-safe catalog of workflow actions: what each does, which record types
 * it acts on, the settings it takes (drives the editor form), what it needs
 * from the run-as user, and whether it is safe to retry automatically. The
 * server implementation of each key lives in workflow-actions.ts and calls
 * the existing CRM services — workflows never write CRM tables directly.
 *
 * Text settings marked `interpolate` accept the Phase 12 merge syntax
 * ({{contact.first_name|there}}), filled from the execution's record.
 */

export type ActionParamType = "text" | "textarea" | "number" | "boolean" | "select" | "user" | "users" | "tags" | "leadStatus" | "companyStatus" | "stage" | "template" | "url" | "json";

export interface ActionParamDef {
  key: string;
  label: string;
  type: ActionParamType;
  required?: boolean;
  options?: readonly { value: string; label: string }[];
  help?: string;
  interpolate?: boolean;
  /** Only shown / used when another param has one of these values. */
  showWhen?: { key: string; values: readonly string[] };
}

/**
 * INTERNAL — changes CRM data through CRM services (audited, on the timeline).
 * MESSAGE  — sends a customer message through Phase 11 channels (DND / consent checked).
 * NOTIFY   — in-app notification to ERP users.
 * EXTERNAL — calls an outside URL.
 */
export type ActionSideEffect = "INTERNAL" | "MESSAGE" | "NOTIFY" | "EXTERNAL";

export interface WorkflowActionDef {
  label: string;
  group: string;
  description: string;
  /** Record types the action can run on. */
  entities: readonly WorkflowEntity[];
  params: readonly ActionParamDef[];
  sideEffect: ActionSideEffect;
  /** ERP permission the run-as user needs (checked at publish and before every run). */
  permission: { module: "crm" | "crm_settings"; action: "view" | "edit" | "create" };
  /**
   * Safe to retry automatically after a failure that may have been partial.
   * Non-retryable actions (messages, webhooks) are never re-sent by the engine
   * when the outcome is unknown; they fail and wait for a person.
   */
  retryable: boolean;
}

const RECORDS: WorkflowEntity[] = ["LEAD", "CONTACT", "COMPANY", "OPPORTUNITY"];
const ALL: WorkflowEntity[] = ["LEAD", "CONTACT", "COMPANY", "OPPORTUNITY", "ACTIVITY", "CONVERSATION"];

const recipientParam: ActionParamDef = {
  key: "recipient",
  label: "Assign to",
  type: "select",
  required: true,
  options: [
    { value: "RECORD_OWNER", label: "The record's owner" },
    { value: "RUN_AS", label: "The workflow's run-as user" },
    { value: "USER", label: "A specific user" },
  ],
};

export const WORKFLOW_ACTIONS = {
  "record.assign_owner": {
    label: "Assign owner",
    group: "Records",
    description: "Make a user the owner of the lead, contact, company or opportunity.",
    entities: RECORDS,
    params: [{ key: "userId", label: "Owner", type: "user", required: true }],
    sideEffect: "INTERNAL",
    permission: { module: "crm", action: "edit" },
    retryable: true,
  },
  "record.add_tags": {
    label: "Add tags",
    group: "Records",
    description: "Add existing tags, or new ones by name.",
    entities: RECORDS,
    params: [
      { key: "tagIds", label: "Tags", type: "tags" },
      { key: "tagNames", label: "New tag names (comma separated)", type: "text", help: "Created if they don't exist." },
    ],
    sideEffect: "INTERNAL",
    permission: { module: "crm", action: "edit" },
    retryable: true,
  },
  "record.remove_tags": {
    label: "Remove tags",
    group: "Records",
    description: "Remove tags from the record.",
    entities: RECORDS,
    params: [{ key: "tagIds", label: "Tags", type: "tags", required: true }],
    sideEffect: "INTERNAL",
    permission: { module: "crm", action: "edit" },
    retryable: true,
  },
  "lead.change_status": {
    label: "Change lead status",
    group: "Leads",
    description: "Move the lead to a status.",
    entities: ["LEAD"],
    params: [{ key: "statusId", label: "Status", type: "leadStatus", required: true }],
    sideEffect: "INTERNAL",
    permission: { module: "crm", action: "edit" },
    retryable: true,
  },
  "lead.update": {
    label: "Update lead",
    group: "Leads",
    description: "Set the temperature, score or next follow-up date.",
    entities: ["LEAD"],
    params: [
      { key: "temperature", label: "Temperature", type: "select", options: [{ value: "", label: "Leave as is" }, { value: "HOT", label: "Hot" }, { value: "WARM", label: "Warm" }, { value: "COLD", label: "Cold" }] },
      { key: "score", label: "Score (0–100)", type: "number" },
      { key: "followUpInDays", label: "Next follow-up in (days)", type: "number", help: "From the moment this step runs." },
    ],
    sideEffect: "INTERNAL",
    permission: { module: "crm", action: "edit" },
    retryable: true,
  },
  "company.change_status": {
    label: "Change company status",
    group: "Companies",
    description: "Move the company to a status.",
    entities: ["COMPANY"],
    params: [{ key: "statusId", label: "Status", type: "companyStatus", required: true }],
    sideEffect: "INTERNAL",
    permission: { module: "crm", action: "edit" },
    retryable: true,
  },
  "opportunity.move_stage": {
    label: "Move opportunity stage",
    group: "Opportunities",
    description: "Move to a stage. Stage rules and required fields still apply.",
    entities: ["OPPORTUNITY"],
    params: [{ key: "stageId", label: "Stage", type: "stage", required: true }],
    sideEffect: "INTERNAL",
    permission: { module: "crm", action: "edit" },
    retryable: true,
  },
  "opportunity.change_status": {
    label: "Mark opportunity won / lost",
    group: "Opportunities",
    description: "Set the status (open, won, lost, abandoned).",
    entities: ["OPPORTUNITY"],
    params: [
      { key: "status", label: "Status", type: "select", required: true, options: [{ value: "WON", label: "Won" }, { value: "LOST", label: "Lost" }, { value: "ABANDONED", label: "Abandoned" }, { value: "OPEN", label: "Reopen" }] },
      { key: "reason", label: "Reason", type: "text", interpolate: true },
    ],
    sideEffect: "INTERNAL",
    permission: { module: "crm", action: "edit" },
    retryable: true,
  },
  "opportunity.update": {
    label: "Update opportunity",
    group: "Opportunities",
    description: "Set the probability or the expected close date.",
    entities: ["OPPORTUNITY"],
    params: [
      { key: "probability", label: "Probability %", type: "number" },
      { key: "closeInDays", label: "Expected close in (days)", type: "number" },
    ],
    sideEffect: "INTERNAL",
    permission: { module: "crm", action: "edit" },
    retryable: true,
  },
  "task.create": {
    label: "Create task",
    group: "Tasks",
    description: "Create a follow-up task (or call / meeting) on the record.",
    entities: ALL,
    params: [
      { key: "type", label: "Type", type: "select", required: true, options: [{ value: "TASK", label: "Task" }, { value: "CALL", label: "Call" }, { value: "MEETING", label: "Meeting" }] },
      { key: "subject", label: "Subject", type: "text", required: true, interpolate: true },
      { key: "description", label: "Description", type: "textarea", interpolate: true },
      { key: "dueInDays", label: "Due in (days)", type: "number", help: "0 = today." },
      { key: "dueTime", label: "Due time (HH:mm, business time)", type: "text" },
      { key: "priority", label: "Priority", type: "select", options: [{ value: "NORMAL", label: "Normal" }, { value: "LOW", label: "Low" }, { value: "HIGH", label: "High" }, { value: "URGENT", label: "Urgent" }] },
      recipientParam,
      { key: "userId", label: "User", type: "user", showWhen: { key: "recipient", values: ["USER"] } },
    ],
    sideEffect: "INTERNAL",
    permission: { module: "crm", action: "create" },
    retryable: true,
  },
  "note.add": {
    label: "Add note",
    group: "Records",
    description: "Add an internal note to the record's timeline.",
    entities: ["LEAD", "CONTACT", "COMPANY", "OPPORTUNITY", "CONVERSATION"],
    params: [{ key: "body", label: "Note", type: "textarea", required: true, interpolate: true }],
    sideEffect: "INTERNAL",
    permission: { module: "crm", action: "edit" },
    retryable: false,
  },
  "appointment.change_status": {
    label: "Update appointment",
    group: "Tasks",
    description: "Confirm, cancel, complete or mark an appointment as no-show.",
    entities: ["ACTIVITY"],
    params: [
      { key: "change", label: "Change", type: "select", required: true, options: [{ value: "CONFIRM", label: "Confirm" }, { value: "CANCEL", label: "Cancel" }, { value: "COMPLETE", label: "Complete" }, { value: "NO_SHOW", label: "No-show" }] },
      { key: "reason", label: "Reason / note", type: "text", interpolate: true },
    ],
    sideEffect: "INTERNAL",
    permission: { module: "crm", action: "edit" },
    retryable: true,
  },
  "conversation.assign": {
    label: "Assign conversation",
    group: "Conversations",
    description: "Assign the conversation to a user.",
    entities: ["CONVERSATION"],
    params: [{ key: "userId", label: "User", type: "user", required: true }],
    sideEffect: "INTERNAL",
    permission: { module: "crm", action: "edit" },
    retryable: true,
  },
  "conversation.change_status": {
    label: "Change conversation status",
    group: "Conversations",
    description: "Open, pend or close the conversation.",
    entities: ["CONVERSATION"],
    params: [{ key: "status", label: "Status", type: "select", required: true, options: [{ value: "OPEN", label: "Open" }, { value: "PENDING", label: "Pending" }, { value: "CLOSED", label: "Closed" }] }],
    sideEffect: "INTERNAL",
    permission: { module: "crm", action: "edit" },
    retryable: true,
  },
  "message.send": {
    label: "Send message from template",
    group: "Communication",
    description: "Send an active template through the Inbox: in the triggering conversation, or the contact's latest conversation on the template's channel. Do-not-contact and consent rules apply.",
    entities: ["LEAD", "CONTACT", "COMPANY", "OPPORTUNITY", "ACTIVITY", "CONVERSATION"],
    params: [{ key: "templateId", label: "Template", type: "template", required: true }],
    sideEffect: "MESSAGE",
    permission: { module: "crm", action: "edit" },
    retryable: false,
  },
  "notification.send": {
    label: "Notify users",
    group: "Communication",
    description: "Send an in-app notification to ERP users.",
    entities: ALL,
    params: [
      { key: "recipient", label: "Notify", type: "select", required: true, options: [{ value: "RECORD_OWNER", label: "The record's owner" }, { value: "RUN_AS", label: "The workflow's run-as user" }, { value: "USERS", label: "Specific users" }] },
      { key: "userIds", label: "Users", type: "users", showWhen: { key: "recipient", values: ["USERS"] } },
      { key: "title", label: "Title", type: "text", required: true, interpolate: true },
      { key: "body", label: "Message", type: "textarea", required: true, interpolate: true },
    ],
    sideEffect: "NOTIFY",
    permission: { module: "crm", action: "view" },
    retryable: false,
  },
  "webhook.post": {
    label: "Call a webhook",
    group: "Integrations",
    description: "POST a signed JSON event to an HTTPS URL. Private and internal addresses are blocked.",
    entities: ALL,
    params: [
      { key: "url", label: "URL (https)", type: "url", required: true },
      { key: "includeRecord", label: "Include the record's fields", type: "boolean" },
      { key: "extra", label: "Extra JSON fields", type: "json", help: 'A JSON object merged into "data", e.g. {"source":"crm"}.' },
    ],
    sideEffect: "EXTERNAL",
    permission: { module: "crm_settings", action: "edit" },
    retryable: false,
  },
} as const satisfies Record<string, WorkflowActionDef>;

export type WorkflowActionKey = keyof typeof WORKFLOW_ACTIONS;
export const WORKFLOW_ACTION_KEYS = Object.keys(WORKFLOW_ACTIONS) as WorkflowActionKey[];

export function isWorkflowAction(v: unknown): v is WorkflowActionKey {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(WORKFLOW_ACTIONS, v);
}

export function actionDef(key: WorkflowActionKey): WorkflowActionDef {
  return WORKFLOW_ACTIONS[key];
}

/**
 * Actions the blueprint lists that depend on phases not built yet. Shown in
 * the editor as unavailable — never faked.
 */
export const UNAVAILABLE_ACTIONS = [
  { key: "sequence.enroll", label: "Start / stop a sequence", reason: "Sales sequences (Phase 17) are not built yet." },
  { key: "bulk.run", label: "Run a bulk action", reason: "The bulk action engine is not built yet." },
  { key: "custom_object.create", label: "Create a custom object", reason: "Custom objects are not built yet." },
  { key: "message.send_new", label: "Start a new conversation", reason: "Phase 11 has no outbound 'start conversation' API; messages go to an existing conversation." },
] as const;
