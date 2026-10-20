import type { CrmEntityType } from "@prisma/client";

/**
 * Client-safe whitelist of what a workflow condition may look at. A condition
 * names a field key from this list ("record.status", "trigger.toStageId",
 * "custom.budget"); nothing else is reachable — no arbitrary paths, no code.
 * The engine builds a flat snapshot with exactly these keys
 * (workflow-context.ts) when it evaluates.
 *
 * Adding a field: one entry here + one line in that entity's snapshot loader.
 */

export type WorkflowFieldType = "string" | "number" | "date" | "boolean" | "ref" | "enum" | "tags";

/** Option list the UI loads for `ref` fields (ids → names). Server-side values are ids. */
export type WorkflowLookup = "user" | "leadStatus" | "leadSource" | "companyStatus" | "pipeline" | "stage" | "tag" | "channel";

export interface WorkflowFieldDef {
  key: string;
  label: string;
  type: WorkflowFieldType;
  lookup?: WorkflowLookup;
  /** Fixed values for `enum` fields. */
  options?: readonly { value: string; label: string }[];
}

export type WorkflowEntity = Extract<CrmEntityType, "LEAD" | "CONTACT" | "COMPANY" | "OPPORTUNITY" | "ACTIVITY" | "CONVERSATION">;
export const WORKFLOW_ENTITIES: Record<WorkflowEntity, { label: string; plural: string }> = {
  LEAD: { label: "Lead", plural: "Leads" },
  CONTACT: { label: "Contact", plural: "Contacts" },
  COMPANY: { label: "Company", plural: "Companies" },
  OPPORTUNITY: { label: "Opportunity", plural: "Opportunities" },
  ACTIVITY: { label: "Task / appointment", plural: "Tasks & appointments" },
  CONVERSATION: { label: "Conversation", plural: "Conversations" },
};
export function isWorkflowEntity(v: unknown): v is WorkflowEntity {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(WORKFLOW_ENTITIES, v);
}

const opt = (...values: string[]) => values.map((v) => ({ value: v, label: v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, " ") }));

const COMMON = (entity: string): WorkflowFieldDef[] => [
  { key: "record.created_at", label: `${entity} created`, type: "date" },
  { key: "record.updated_at", label: `${entity} last updated`, type: "date" },
];

export const WORKFLOW_RECORD_FIELDS: Record<WorkflowEntity, WorkflowFieldDef[]> = {
  LEAD: [
    { key: "record.full_name", label: "Name", type: "string" },
    { key: "record.company_name", label: "Company name", type: "string" },
    { key: "record.email", label: "Email", type: "string" },
    { key: "record.phone", label: "Phone (any)", type: "string" },
    { key: "record.status", label: "Status", type: "ref", lookup: "leadStatus" },
    { key: "record.status_kind", label: "Status kind", type: "enum", options: opt("OPEN", "CONVERTED", "LOST") },
    { key: "record.source", label: "Source", type: "ref", lookup: "leadSource" },
    { key: "record.owner", label: "Owner", type: "ref", lookup: "user" },
    { key: "record.score", label: "Score", type: "number" },
    { key: "record.temperature", label: "Temperature", type: "enum", options: opt("HOT", "WARM", "COLD") },
    { key: "record.estimated_value", label: "Estimated value", type: "number" },
    { key: "record.capture_channel", label: "Capture channel", type: "enum", options: opt("MANUAL", "CSV", "XLSX", "WEBSITE_FORM", "API", "WEBHOOK", "INTEGRATION") },
    { key: "record.industry", label: "Industry", type: "string" },
    { key: "record.city", label: "City", type: "string" },
    { key: "record.state", label: "State", type: "string" },
    { key: "record.country", label: "Country", type: "string" },
    { key: "record.utm_source", label: "UTM source", type: "string" },
    { key: "record.utm_campaign", label: "UTM campaign", type: "string" },
    { key: "record.next_follow_up_at", label: "Next follow-up", type: "date" },
    { key: "record.last_contacted_at", label: "Last contacted", type: "date" },
    { key: "record.is_converted", label: "Converted", type: "boolean" },
    { key: "record.is_archived", label: "Archived", type: "boolean" },
    { key: "record.tags", label: "Tags", type: "tags", lookup: "tag" },
    ...COMMON("Lead"),
  ],
  CONTACT: [
    { key: "record.full_name", label: "Name", type: "string" },
    { key: "record.email", label: "Email", type: "string" },
    { key: "record.phone", label: "Phone (any)", type: "string" },
    { key: "record.designation", label: "Designation", type: "string" },
    { key: "record.department", label: "Department", type: "string" },
    { key: "record.owner", label: "Owner", type: "ref", lookup: "user" },
    { key: "record.has_company", label: "Linked to a company", type: "boolean" },
    { key: "record.last_activity_at", label: "Last activity", type: "date" },
    { key: "record.is_archived", label: "Archived", type: "boolean" },
    { key: "record.tags", label: "Tags", type: "tags", lookup: "tag" },
    ...COMMON("Contact"),
  ],
  COMPANY: [
    { key: "record.name", label: "Name", type: "string" },
    { key: "record.status", label: "Status", type: "ref", lookup: "companyStatus" },
    { key: "record.owner", label: "Owner", type: "ref", lookup: "user" },
    { key: "record.company_type", label: "Type", type: "string" },
    { key: "record.industry", label: "Industry", type: "string" },
    { key: "record.city", label: "City", type: "string" },
    { key: "record.state", label: "State", type: "string" },
    { key: "record.country", label: "Country", type: "string" },
    { key: "record.email", label: "Email", type: "string" },
    { key: "record.website", label: "Website", type: "string" },
    { key: "record.is_erp_customer", label: "Linked to an ERP customer", type: "boolean" },
    { key: "record.last_activity_at", label: "Last activity", type: "date" },
    { key: "record.is_archived", label: "Archived", type: "boolean" },
    { key: "record.tags", label: "Tags", type: "tags", lookup: "tag" },
    ...COMMON("Company"),
  ],
  OPPORTUNITY: [
    { key: "record.name", label: "Name", type: "string" },
    { key: "record.status", label: "Status", type: "enum", options: opt("OPEN", "WON", "LOST", "ABANDONED") },
    { key: "record.pipeline", label: "Pipeline", type: "ref", lookup: "pipeline" },
    { key: "record.stage", label: "Stage", type: "ref", lookup: "stage" },
    { key: "record.owner", label: "Owner", type: "ref", lookup: "user" },
    { key: "record.amount", label: "Value", type: "number" },
    { key: "record.currency", label: "Currency", type: "string" },
    { key: "record.probability", label: "Probability %", type: "number" },
    { key: "record.expected_close_date", label: "Expected close date", type: "date" },
    { key: "record.stage_changed_at", label: "Entered current stage", type: "date" },
    { key: "record.has_company", label: "Linked to a company", type: "boolean" },
    { key: "record.has_contact", label: "Linked to a contact", type: "boolean" },
    { key: "record.last_activity_at", label: "Last activity", type: "date" },
    { key: "record.is_archived", label: "Archived", type: "boolean" },
    { key: "record.tags", label: "Tags", type: "tags", lookup: "tag" },
    ...COMMON("Opportunity"),
  ],
  ACTIVITY: [
    { key: "record.type", label: "Type", type: "enum", options: opt("TASK", "CALL", "MEETING", "APPOINTMENT", "EMAIL", "SMS", "WHATSAPP", "OTHER") },
    { key: "record.subject", label: "Subject", type: "string" },
    { key: "record.status", label: "Status", type: "enum", options: opt("PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED", "SCHEDULED", "CONFIRMED", "RESCHEDULED", "NO_SHOW") },
    { key: "record.priority", label: "Priority", type: "enum", options: opt("LOW", "NORMAL", "HIGH", "URGENT") },
    { key: "record.assigned_to", label: "Assigned to", type: "ref", lookup: "user" },
    { key: "record.due_at", label: "Due / starts", type: "date" },
    { key: "record.outcome", label: "Outcome", type: "string" },
    { key: "record.record_type", label: "Linked record type", type: "enum", options: opt("LEAD", "CONTACT", "COMPANY", "OPPORTUNITY") },
    ...COMMON("Activity"),
  ],
  CONVERSATION: [
    { key: "record.status", label: "Status", type: "enum", options: opt("OPEN", "PENDING", "CLOSED", "ARCHIVED") },
    { key: "record.channel_type", label: "Channel", type: "string" },
    { key: "record.assigned_to", label: "Assigned to", type: "ref", lookup: "user" },
    { key: "record.has_contact", label: "Linked to a contact", type: "boolean" },
    { key: "record.unread_count", label: "Unread messages", type: "number" },
    { key: "record.last_inbound_at", label: "Last message received", type: "date" },
    { key: "record.last_outbound_at", label: "Last message sent", type: "date" },
    ...COMMON("Conversation"),
  ],
};

/** Fields every workflow can check, whatever the record type. */
export const WORKFLOW_COMMON_FIELDS: WorkflowFieldDef[] = [
  { key: "event.actor", label: "Change made by (user)", type: "ref", lookup: "user" },
  { key: "event.by_workflow", label: "Change made by a workflow", type: "boolean" },
  { key: "execution.started_at", label: "Execution started", type: "date" },
];

/** Entities whose custom fields (crm_custom_field_definitions) are reachable as `custom.<key>`. */
export const CUSTOM_FIELD_ENTITIES: WorkflowEntity[] = ["LEAD", "CONTACT", "COMPANY", "OPPORTUNITY"];

export const CONDITION_OPERATORS = {
  eq: { label: "is", types: ["string", "number", "ref", "enum", "date"] },
  neq: { label: "is not", types: ["string", "number", "ref", "enum", "date"] },
  in: { label: "is any of", types: ["string", "ref", "enum", "number"] },
  not_in: { label: "is none of", types: ["string", "ref", "enum", "number"] },
  contains: { label: "contains", types: ["string"] },
  not_contains: { label: "does not contain", types: ["string"] },
  starts_with: { label: "starts with", types: ["string"] },
  ends_with: { label: "ends with", types: ["string"] },
  gt: { label: "is greater than", types: ["number"] },
  gte: { label: "is at least", types: ["number"] },
  lt: { label: "is less than", types: ["number"] },
  lte: { label: "is at most", types: ["number"] },
  between: { label: "is between", types: ["number"] },
  before: { label: "is before", types: ["date"] },
  after: { label: "is after", types: ["date"] },
  within_last_days: { label: "is within the last … days", types: ["date"] },
  within_next_days: { label: "is within the next … days", types: ["date"] },
  more_than_days_ago: { label: "is more than … days ago", types: ["date"] },
  is_true: { label: "is yes", types: ["boolean"] },
  is_false: { label: "is no", types: ["boolean"] },
  has_tag: { label: "has tag", types: ["tags"] },
  not_has_tag: { label: "does not have tag", types: ["tags"] },
  is_empty: { label: "is empty", types: ["string", "number", "date", "ref", "enum", "tags"] },
  is_not_empty: { label: "is not empty", types: ["string", "number", "date", "ref", "enum", "tags"] },
} as const satisfies Record<string, { label: string; types: readonly WorkflowFieldType[] }>;
export type ConditionOperator = keyof typeof CONDITION_OPERATORS;
export const CONDITION_OPERATOR_KEYS = Object.keys(CONDITION_OPERATORS) as ConditionOperator[];

/** Operators that take no value. */
export const VALUELESS_OPERATORS: ReadonlySet<ConditionOperator> = new Set(["is_true", "is_false", "is_empty", "is_not_empty"]);
/** Operators whose value is a list. */
export const LIST_OPERATORS: ReadonlySet<ConditionOperator> = new Set(["in", "not_in", "between"]);
/** Operators whose value is a number of days. */
export const DAYS_OPERATORS: ReadonlySet<ConditionOperator> = new Set(["within_last_days", "within_next_days", "more_than_days_ago"]);

export function operatorAllowed(op: ConditionOperator, type: WorkflowFieldType): boolean {
  return (CONDITION_OPERATORS[op].types as readonly string[]).includes(type);
}
