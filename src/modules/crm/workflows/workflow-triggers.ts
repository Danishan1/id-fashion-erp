import type { CrmEventType } from "../core/crm-event-types";
import type { WorkflowEntity, WorkflowFieldDef } from "./workflow-fields";

/**
 * Client-safe trigger registry. A trigger is a business event already
 * written to `crm_events` by the CRM services (the transactional outbox:
 * the event row commits with the change it describes), optionally narrowed
 * by its payload. Workflows never hook into service code directly, so a
 * trigger can never fire for a change that rolled back.
 *
 * `entity: "EVENT"` triggers (tag added / removed) start on whatever record
 * the event is about. `manual` workflows are started from a record or the
 * API, never by an event.
 *
 * Adding a trigger for an existing event: one entry. For a new event: add the
 * event type in crm-event-types.ts (emitted by its service), then an entry.
 */

export interface WorkflowTriggerDef {
  label: string;
  group: string;
  description: string;
  /** The record the execution runs on. "EVENT" = the event's own record. */
  entity: WorkflowEntity | "EVENT";
  /** crm_events.event_type values that start it. Empty for manual. */
  events: readonly CrmEventType[];
  /** Extra payload match: every key must equal one of the listed values. */
  payloadMatch?: Readonly<Record<string, readonly string[]>>;
  /** Payload fields offered as `trigger.<key>` in conditions. */
  payloadFields?: readonly WorkflowFieldDef[];
}

const statusChange: WorkflowFieldDef[] = [
  { key: "trigger.fromStatusId", label: "Previous status", type: "ref", lookup: "leadStatus" },
  { key: "trigger.toStatusId", label: "New status", type: "ref", lookup: "leadStatus" },
];
const ownerChange: WorkflowFieldDef[] = [
  { key: "trigger.fromUserId", label: "Previous owner", type: "ref", lookup: "user" },
  { key: "trigger.toUserId", label: "New owner", type: "ref", lookup: "user" },
];
const tagFields: WorkflowFieldDef[] = [{ key: "trigger.tagId", label: "Tag", type: "ref", lookup: "tag" }];
const stageChange: WorkflowFieldDef[] = [
  { key: "trigger.fromStageId", label: "Previous stage", type: "ref", lookup: "stage" },
  { key: "trigger.toStageId", label: "New stage", type: "ref", lookup: "stage" },
  { key: "trigger.toPipelineId", label: "Pipeline", type: "ref", lookup: "pipeline" },
  { key: "trigger.changeType", label: "Change type", type: "string" },
];
const oppStatus: WorkflowFieldDef[] = [
  { key: "trigger.fromStatus", label: "Previous status", type: "enum", options: [{ value: "OPEN", label: "Open" }, { value: "WON", label: "Won" }, { value: "LOST", label: "Lost" }, { value: "ABANDONED", label: "Abandoned" }] },
  { key: "trigger.toStatus", label: "New status", type: "enum", options: [{ value: "OPEN", label: "Open" }, { value: "WON", label: "Won" }, { value: "LOST", label: "Lost" }, { value: "ABANDONED", label: "Abandoned" }] },
  { key: "trigger.reason", label: "Reason", type: "string" },
];
const activityFields: WorkflowFieldDef[] = [
  { key: "trigger.type", label: "Activity type", type: "string" },
  { key: "trigger.wasOverdue", label: "Was overdue", type: "boolean" },
];
const appointmentFields: WorkflowFieldDef[] = [
  { key: "trigger.status", label: "Appointment status", type: "string" },
  { key: "trigger.previousStatus", label: "Previous status", type: "string" },
  { key: "trigger.appointmentType", label: "Appointment type", type: "string" },
];
const messageFields: WorkflowFieldDef[] = [
  { key: "trigger.channelType", label: "Channel", type: "string" },
  { key: "trigger.messageType", label: "Message type", type: "string" },
];
const leadCreatedFields: WorkflowFieldDef[] = [{ key: "trigger.channel", label: "Capture channel", type: "string" }];

export const WORKFLOW_TRIGGERS = {
  // Leads
  "lead.created": { label: "Lead created", group: "Leads", description: "Any new lead — typed in, imported or captured.", entity: "LEAD", events: ["lead.created"], payloadFields: leadCreatedFields },
  "lead.imported": { label: "Lead imported", group: "Leads", description: "A lead created by a CSV / Excel import.", entity: "LEAD", events: ["lead.created"], payloadMatch: { channel: ["CSV", "XLSX"] } },
  "lead.captured": { label: "Lead captured", group: "Leads", description: "A lead from a website form, the capture API, a webhook or an integration.", entity: "LEAD", events: ["lead.created"], payloadMatch: { channel: ["WEBSITE_FORM", "API", "WEBHOOK", "INTEGRATION"] }, payloadFields: leadCreatedFields },
  "lead.updated": { label: "Lead updated", group: "Leads", description: "Lead details edited.", entity: "LEAD", events: ["lead.updated"] },
  "lead.status_changed": { label: "Lead status changed", group: "Leads", description: "The lead moved to another status.", entity: "LEAD", events: ["lead.status_changed"], payloadFields: statusChange },
  "lead.owner_changed": { label: "Lead owner changed", group: "Leads", description: "The lead was assigned or reassigned.", entity: "LEAD", events: ["lead.owner_changed"], payloadFields: ownerChange },
  "lead.converted": { label: "Lead converted", group: "Leads", description: "The lead was converted.", entity: "LEAD", events: ["lead.converted"] },
  // Contacts
  "contact.created": { label: "Contact created", group: "Contacts", description: "A new contact.", entity: "CONTACT", events: ["contact.created"] },
  "contact.updated": { label: "Contact updated", group: "Contacts", description: "Contact details edited.", entity: "CONTACT", events: ["contact.updated"] },
  "contact.owner_changed": { label: "Contact owner changed", group: "Contacts", description: "The contact was assigned or reassigned.", entity: "CONTACT", events: ["contact.owner_changed"], payloadFields: ownerChange },
  "contact.contactability_changed": { label: "Contact preferences changed", group: "Contacts", description: "Do-not-contact / consent changed.", entity: "CONTACT", events: ["contact.contactability_changed"] },
  // Companies
  "company.created": { label: "Company created", group: "Companies", description: "A new company.", entity: "COMPANY", events: ["company.created"] },
  "company.updated": { label: "Company updated", group: "Companies", description: "Company details edited.", entity: "COMPANY", events: ["company.updated"] },
  "company.status_changed": { label: "Company status changed", group: "Companies", description: "The company moved to another status.", entity: "COMPANY", events: ["company.status_changed"] },
  "company.owner_changed": { label: "Company owner changed", group: "Companies", description: "The company was assigned or reassigned.", entity: "COMPANY", events: ["company.owner_changed"], payloadFields: ownerChange },
  // Opportunities
  "opportunity.created": { label: "Opportunity created", group: "Opportunities", description: "A new opportunity.", entity: "OPPORTUNITY", events: ["opportunity.created"] },
  "opportunity.updated": { label: "Opportunity updated", group: "Opportunities", description: "Opportunity details edited (value, close date…).", entity: "OPPORTUNITY", events: ["opportunity.updated", "opportunity.value_changed", "opportunity.close_date_changed", "opportunity.probability_changed"] },
  "opportunity.stage_changed": { label: "Opportunity stage changed", group: "Opportunities", description: "Moved to another stage (or pipeline).", entity: "OPPORTUNITY", events: ["opportunity.stage_changed", "opportunity.pipeline_transferred"], payloadFields: stageChange },
  "opportunity.status_changed": { label: "Opportunity won / lost / reopened", group: "Opportunities", description: "Any status change: won, lost, abandoned or reopened.", entity: "OPPORTUNITY", events: ["opportunity.won", "opportunity.lost", "opportunity.abandoned", "opportunity.reopened"], payloadFields: oppStatus },
  "opportunity.won": { label: "Opportunity won", group: "Opportunities", description: "Marked won.", entity: "OPPORTUNITY", events: ["opportunity.won"], payloadFields: oppStatus },
  "opportunity.lost": { label: "Opportunity lost", group: "Opportunities", description: "Marked lost or abandoned.", entity: "OPPORTUNITY", events: ["opportunity.lost", "opportunity.abandoned"], payloadFields: oppStatus },
  "opportunity.owner_changed": { label: "Opportunity owner changed", group: "Opportunities", description: "Assigned or reassigned.", entity: "OPPORTUNITY", events: ["opportunity.owner_changed"], payloadFields: ownerChange },
  // Tasks / appointments
  "task.created": { label: "Task created", group: "Tasks & appointments", description: "A task, call or meeting was scheduled.", entity: "ACTIVITY", events: ["activity.created"], payloadFields: activityFields },
  "task.completed": { label: "Task completed", group: "Tasks & appointments", description: "A task, call or meeting was completed.", entity: "ACTIVITY", events: ["activity.completed"], payloadFields: activityFields },
  "appointment.booked": { label: "Appointment booked", group: "Tasks & appointments", description: "A new appointment.", entity: "ACTIVITY", events: ["appointment.created"], payloadFields: appointmentFields },
  "appointment.confirmed": { label: "Appointment confirmed", group: "Tasks & appointments", description: "Confirmed by the team.", entity: "ACTIVITY", events: ["appointment.confirmed"], payloadFields: appointmentFields },
  "appointment.rescheduled": { label: "Appointment rescheduled", group: "Tasks & appointments", description: "Moved to another time.", entity: "ACTIVITY", events: ["appointment.rescheduled"], payloadFields: appointmentFields },
  "appointment.cancelled": { label: "Appointment cancelled", group: "Tasks & appointments", description: "Cancelled.", entity: "ACTIVITY", events: ["appointment.cancelled"], payloadFields: appointmentFields },
  "appointment.completed": { label: "Appointment completed", group: "Tasks & appointments", description: "Marked done.", entity: "ACTIVITY", events: ["appointment.completed"], payloadFields: appointmentFields },
  "appointment.no_show": { label: "Appointment no-show", group: "Tasks & appointments", description: "The customer didn't come.", entity: "ACTIVITY", events: ["appointment.no_show"], payloadFields: appointmentFields },
  // Conversations
  "message.received": { label: "Message received", group: "Conversations", description: "A customer message arrived in the Inbox.", entity: "CONVERSATION", events: ["message.received"], payloadFields: messageFields },
  "message.failed": { label: "Message failed", group: "Conversations", description: "An outgoing message could not be delivered.", entity: "CONVERSATION", events: ["message.failed"], payloadFields: messageFields },
  "conversation.created": { label: "Conversation started", group: "Conversations", description: "A new conversation.", entity: "CONVERSATION", events: ["conversation.created"], payloadFields: messageFields },
  "conversation.assigned": { label: "Conversation assigned", group: "Conversations", description: "Assigned or reassigned.", entity: "CONVERSATION", events: ["conversation.assigned"] },
  "conversation.closed": { label: "Conversation closed", group: "Conversations", description: "Closed.", entity: "CONVERSATION", events: ["conversation.closed"] },
  // Tags (any record)
  "tag.added": { label: "Tag added", group: "Tags", description: "A tag was added to a lead, contact, company or opportunity.", entity: "EVENT", events: ["lead.tag_added", "contact.tag_added", "company.tag_added", "opportunity.tag_added"], payloadFields: tagFields },
  "tag.removed": { label: "Tag removed", group: "Tags", description: "A tag was removed from a lead, contact, company or opportunity.", entity: "EVENT", events: ["lead.tag_removed", "contact.tag_removed", "company.tag_removed", "opportunity.tag_removed"], payloadFields: tagFields },
  // Manual
  "manual": { label: "Started manually", group: "Manual", description: "Started from a record or the API — never by an event. Choose the record type in the trigger.", entity: "EVENT", events: [] },
} as const satisfies Record<string, WorkflowTriggerDef>;

export type WorkflowTriggerKey = keyof typeof WORKFLOW_TRIGGERS;
export const WORKFLOW_TRIGGER_KEYS = Object.keys(WORKFLOW_TRIGGERS) as WorkflowTriggerKey[];

export function isWorkflowTrigger(v: unknown): v is WorkflowTriggerKey {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(WORKFLOW_TRIGGERS, v);
}

export function triggerDef(key: WorkflowTriggerKey): WorkflowTriggerDef {
  return WORKFLOW_TRIGGERS[key];
}

/** Every event type that can start some workflow (the dispatcher only reads these). */
export const TRIGGERING_EVENT_TYPES: readonly string[] = [...new Set(WORKFLOW_TRIGGER_KEYS.flatMap((k) => [...(WORKFLOW_TRIGGERS[k] as WorkflowTriggerDef).events]))];

/** Trigger keys an event can start (before payload matching). */
export function triggersForEvent(eventType: string): WorkflowTriggerKey[] {
  return WORKFLOW_TRIGGER_KEYS.filter((k) => (WORKFLOW_TRIGGERS[k] as WorkflowTriggerDef).events.includes(eventType as CrmEventType));
}

/** Does the event's payload satisfy the trigger's payload match? */
export function payloadMatches(def: WorkflowTriggerDef, payload: unknown): boolean {
  if (!def.payloadMatch) return true;
  const p = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  return Object.entries(def.payloadMatch).every(([k, allowed]) => typeof p[k] === "string" && allowed.includes(p[k] as string));
}

/** Record types a trigger can run on ("EVENT" triggers: the tag-able records, or the manual record type). */
export function triggerEntities(key: WorkflowTriggerKey): WorkflowEntity[] {
  const def = WORKFLOW_TRIGGERS[key] as WorkflowTriggerDef;
  if (def.entity !== "EVENT") return [def.entity];
  if (key === "manual") return ["LEAD", "CONTACT", "COMPANY", "OPPORTUNITY", "ACTIVITY", "CONVERSATION"];
  return ["LEAD", "CONTACT", "COMPANY", "OPPORTUNITY"];
}

/**
 * Events / trigger types the engine does NOT have yet because their phase
 * isn't built — listed so the UI can say so instead of pretending.
 */
export const UNAVAILABLE_TRIGGERS = [
  { key: "form.submitted", reason: "Forms (Phase 13+) are not built yet." },
  { key: "import.completed", reason: "Lead imports emit lead.created per row (use 'Lead imported'); there is no import-level event yet." },
  { key: "bulk_job.completed", reason: "The bulk action engine (Phase 14+) is not built yet." },
  { key: "custom_object.created", reason: "Custom objects are not built yet." },
  { key: "date.reached", reason: "Scheduled / date triggers are not built in this phase — use a Wait step 'until a date on the record'." },
] as const;
