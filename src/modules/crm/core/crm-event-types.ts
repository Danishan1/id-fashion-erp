import type { CrmEntityType } from "@prisma/client";
import { humanizeStatus } from "@/lib/humanize-status";

/**
 * Client-safe registry of every CRM business event name. Stored as plain text
 * in `crm_events.event_type` and validated here instead of in a DB enum, so a
 * later phase adds an event by adding one entry — no migration.
 *
 * Names follow `<entity>.<past-tense verb>` and match the list in
 * docs/crm/CRM_INTEGRATION_AWARENESS.md §4, because workflows (Phase 18) and
 * outbound webhooks (Phase 29) will consume these exact strings. Never rename
 * a published event type; add a new one instead.
 *
 * Only events for entity types that exist in `CrmEntityType` are listed.
 * form.* arrive with their phases (activity.* covers tasks; appointment.* since Phase 10; conversation.* and message.* since Phase 11; template.* since Phase 12; workflow.* since Phase 18).
 */
export type CrmEventCategory =
  | "created"
  | "updated"
  | "stage"
  | "status"
  | "won"
  | "lost"
  | "assignment"
  | "tag"
  | "note"
  | "converted"
  | "archived"
  | "restored"
  | "linked"
  | "merged"
  | "contactability"
  | "document"
  | "duplicate"
  | "task"
  | "activity"
  | "message";

export interface CrmEventDefinition {
  label: string;
  entityType: CrmEntityType;
  category: CrmEventCategory;
}

export const CRM_EVENT_TYPES = {
  "lead.created": { label: "Lead created", entityType: "LEAD", category: "created" },
  "lead.updated": { label: "Lead updated", entityType: "LEAD", category: "updated" },
  "lead.status_changed": { label: "Status changed", entityType: "LEAD", category: "status" },
  "lead.owner_changed": { label: "Owner changed", entityType: "LEAD", category: "assignment" },
  "lead.tag_added": { label: "Tag added", entityType: "LEAD", category: "tag" },
  "lead.tag_removed": { label: "Tag removed", entityType: "LEAD", category: "tag" },
  "lead.note_added": { label: "Note added", entityType: "LEAD", category: "note" },
  "lead.note_updated": { label: "Note edited", entityType: "LEAD", category: "note" },
  "lead.note_deleted": { label: "Note deleted", entityType: "LEAD", category: "note" },
  "lead.converted": { label: "Lead converted", entityType: "LEAD", category: "converted" },
  "lead.opportunity_created": { label: "Opportunity created", entityType: "LEAD", category: "linked" },
  "lead.archived": { label: "Lead archived", entityType: "LEAD", category: "archived" },
  "lead.restored": { label: "Lead restored", entityType: "LEAD", category: "restored" },
  "contact.created": { label: "Contact created", entityType: "CONTACT", category: "created" },
  "contact.updated": { label: "Contact updated", entityType: "CONTACT", category: "updated" },
  "contact.owner_changed": { label: "Owner changed", entityType: "CONTACT", category: "assignment" },
  "contact.tag_added": { label: "Tag added", entityType: "CONTACT", category: "tag" },
  "contact.tag_removed": { label: "Tag removed", entityType: "CONTACT", category: "tag" },
  "contact.note_added": { label: "Note added", entityType: "CONTACT", category: "note" },
  "contact.note_updated": { label: "Note edited", entityType: "CONTACT", category: "note" },
  "contact.note_deleted": { label: "Note deleted", entityType: "CONTACT", category: "note" },
  "contact.address_added": { label: "Address added", entityType: "CONTACT", category: "updated" },
  "contact.address_updated": { label: "Address updated", entityType: "CONTACT", category: "updated" },
  "contact.address_removed": { label: "Address removed", entityType: "CONTACT", category: "updated" },
  "contact.channel_added": { label: "Contact detail added", entityType: "CONTACT", category: "updated" },
  "contact.channel_removed": { label: "Contact detail removed", entityType: "CONTACT", category: "updated" },
  "contact.contactability_changed": { label: "Contactability changed", entityType: "CONTACT", category: "contactability" },
  "contact.document_added": { label: "Document added", entityType: "CONTACT", category: "document" },
  "contact.document_removed": { label: "Document removed", entityType: "CONTACT", category: "document" },
  "contact.lead_linked": { label: "Lead linked", entityType: "CONTACT", category: "linked" },
  "contact.duplicate_flagged": { label: "Flagged as possible duplicate", entityType: "CONTACT", category: "duplicate" },
  "contact.duplicate_dismissed": { label: "Duplicate flag cleared", entityType: "CONTACT", category: "duplicate" },
  "contact.merged": { label: "Contact merged in", entityType: "CONTACT", category: "merged" },
  "contact.merged_into": { label: "Merged into another contact", entityType: "CONTACT", category: "merged" },
  "contact.archived": { label: "Contact archived", entityType: "CONTACT", category: "archived" },
  "contact.restored": { label: "Contact restored", entityType: "CONTACT", category: "restored" },
  "company.created": { label: "Company created", entityType: "COMPANY", category: "created" },
  "company.updated": { label: "Company updated", entityType: "COMPANY", category: "updated" },
  "company.owner_changed": { label: "Owner changed", entityType: "COMPANY", category: "assignment" },
  "company.status_changed": { label: "Status changed", entityType: "COMPANY", category: "status" },
  "company.tag_added": { label: "Tag added", entityType: "COMPANY", category: "tag" },
  "company.tag_removed": { label: "Tag removed", entityType: "COMPANY", category: "tag" },
  "company.note_added": { label: "Note added", entityType: "COMPANY", category: "note" },
  "company.note_updated": { label: "Note edited", entityType: "COMPANY", category: "note" },
  "company.note_deleted": { label: "Note deleted", entityType: "COMPANY", category: "note" },
  "company.contact_added": { label: "Contact added", entityType: "COMPANY", category: "linked" },
  "company.contact_removed": { label: "Contact removed", entityType: "COMPANY", category: "linked" },
  "company.primary_contact_changed": { label: "Primary contact changed", entityType: "COMPANY", category: "linked" },
  "company.lead_linked": { label: "Lead associated", entityType: "COMPANY", category: "linked" },
  "company.lead_unlinked": { label: "Lead unlinked", entityType: "COMPANY", category: "linked" },
  "company.opportunity_linked": { label: "Opportunity associated", entityType: "COMPANY", category: "linked" },
  "company.address_added": { label: "Address added", entityType: "COMPANY", category: "updated" },
  "company.address_updated": { label: "Address updated", entityType: "COMPANY", category: "updated" },
  "company.address_removed": { label: "Address removed", entityType: "COMPANY", category: "updated" },
  "company.document_added": { label: "Document added", entityType: "COMPANY", category: "document" },
  "company.document_removed": { label: "Document removed", entityType: "COMPANY", category: "document" },
  "company.erp_customer_linked": { label: "ERP customer linked", entityType: "COMPANY", category: "linked" },
  "company.erp_customer_unlinked": { label: "ERP customer unlinked", entityType: "COMPANY", category: "linked" },
  "company.duplicate_flagged": { label: "Flagged as possible duplicate", entityType: "COMPANY", category: "duplicate" },
  "company.duplicate_dismissed": { label: "Duplicate flag cleared", entityType: "COMPANY", category: "duplicate" },
  "company.merged": { label: "Company merged in", entityType: "COMPANY", category: "merged" },
  "company.merged_into": { label: "Merged into another company", entityType: "COMPANY", category: "merged" },
  "company.archived": { label: "Company archived", entityType: "COMPANY", category: "archived" },
  "company.restored": { label: "Company restored", entityType: "COMPANY", category: "restored" },
  "opportunity.created": { label: "Opportunity created", entityType: "OPPORTUNITY", category: "created" },
  "opportunity.updated": { label: "Opportunity updated", entityType: "OPPORTUNITY", category: "updated" },
  "opportunity.stage_changed": { label: "Stage changed", entityType: "OPPORTUNITY", category: "stage" },
  "opportunity.pipeline_transferred": { label: "Moved to another pipeline", entityType: "OPPORTUNITY", category: "stage" },
  "opportunity.status_changed": { label: "Status changed", entityType: "OPPORTUNITY", category: "status" },
  "opportunity.won": { label: "Opportunity won", entityType: "OPPORTUNITY", category: "won" },
  "opportunity.lost": { label: "Opportunity lost", entityType: "OPPORTUNITY", category: "lost" },
  // Phase 06
  "opportunity.abandoned": { label: "Opportunity abandoned", entityType: "OPPORTUNITY", category: "lost" },
  "opportunity.reopened": { label: "Opportunity reopened", entityType: "OPPORTUNITY", category: "status" },
  "opportunity.owner_changed": { label: "Owner changed", entityType: "OPPORTUNITY", category: "assignment" },
  "opportunity.company_linked": { label: "Company changed", entityType: "OPPORTUNITY", category: "linked" },
  "opportunity.contact_linked": { label: "Contact changed", entityType: "OPPORTUNITY", category: "linked" },
  "opportunity.value_changed": { label: "Value changed", entityType: "OPPORTUNITY", category: "updated" },
  "opportunity.probability_changed": { label: "Probability changed", entityType: "OPPORTUNITY", category: "updated" },
  "opportunity.close_date_changed": { label: "Expected close date changed", entityType: "OPPORTUNITY", category: "updated" },
  "opportunity.tag_added": { label: "Tag added", entityType: "OPPORTUNITY", category: "tag" },
  "opportunity.tag_removed": { label: "Tag removed", entityType: "OPPORTUNITY", category: "tag" },
  "opportunity.note_added": { label: "Note added", entityType: "OPPORTUNITY", category: "note" },
  "opportunity.note_updated": { label: "Note edited", entityType: "OPPORTUNITY", category: "note" },
  "opportunity.note_deleted": { label: "Note deleted", entityType: "OPPORTUNITY", category: "note" },
  "opportunity.document_added": { label: "Document added", entityType: "OPPORTUNITY", category: "document" },
  "opportunity.document_removed": { label: "Document removed", entityType: "OPPORTUNITY", category: "document" },
  "opportunity.erp_document_linked": { label: "ERP document linked", entityType: "OPPORTUNITY", category: "linked" },
  "opportunity.erp_document_unlinked": { label: "ERP document unlinked", entityType: "OPPORTUNITY", category: "linked" },
  "opportunity.archived": { label: "Opportunity archived", entityType: "OPPORTUNITY", category: "archived" },
  "opportunity.restored": { label: "Opportunity restored", entityType: "OPPORTUNITY", category: "restored" },
  "contact.opportunity_linked": { label: "Opportunity associated", entityType: "CONTACT", category: "linked" },
  // Phase 09 — activities. Stored on the activity (entityType ACTIVITY); a
  // record's timeline shows the events of every activity linked to it.
  "activity.created": { label: "Activity scheduled", entityType: "ACTIVITY", category: "task" },
  "activity.updated": { label: "Activity updated", entityType: "ACTIVITY", category: "updated" },
  "activity.assigned": { label: "Activity assigned", entityType: "ACTIVITY", category: "assignment" },
  "activity.rescheduled": { label: "Activity rescheduled", entityType: "ACTIVITY", category: "task" },
  "activity.completed": { label: "Activity completed", entityType: "ACTIVITY", category: "won" },
  "activity.reopened": { label: "Activity reopened", entityType: "ACTIVITY", category: "status" },
  "activity.cancelled": { label: "Activity cancelled", entityType: "ACTIVITY", category: "archived" },
  "activity.deleted": { label: "Activity deleted", entityType: "ACTIVITY", category: "archived" },
  "activity.reminder_sent": { label: "Reminder sent", entityType: "ACTIVITY", category: "task" },
  "activity.call_logged": { label: "Call logged", entityType: "ACTIVITY", category: "activity" },
  "activity.meeting_logged": { label: "Meeting logged", entityType: "ACTIVITY", category: "activity" },
  "activity.message_logged": { label: "Message logged", entityType: "ACTIVITY", category: "activity" },
  "activity.logged": { label: "Activity logged", entityType: "ACTIVITY", category: "activity" },
  // Phase 10 — appointments (activities of type APPOINTMENT). Automation
  // hooks: payload = AppointmentEventPayload (appointment-registry.ts).
  "appointment.created": { label: "Appointment scheduled", entityType: "ACTIVITY", category: "task" },
  "appointment.updated": { label: "Appointment updated", entityType: "ACTIVITY", category: "updated" },
  "appointment.assigned": { label: "Appointment reassigned", entityType: "ACTIVITY", category: "assignment" },
  "appointment.confirmed": { label: "Appointment confirmed", entityType: "ACTIVITY", category: "status" },
  "appointment.rescheduled": { label: "Appointment rescheduled", entityType: "ACTIVITY", category: "task" },
  "appointment.cancelled": { label: "Appointment cancelled", entityType: "ACTIVITY", category: "archived" },
  "appointment.completed": { label: "Appointment completed", entityType: "ACTIVITY", category: "won" },
  "appointment.no_show": { label: "Appointment no-show", entityType: "ACTIVITY", category: "lost" },
  // Phase 11 — unified conversations (entity CONVERSATION). Automation hooks:
  // payload = ConversationEventPayload (conversation-registry.ts). message.*
  // events are stored on the conversation; payload.messageId names the message.
  "conversation.created": { label: "Conversation started", entityType: "CONVERSATION", category: "created" },
  "conversation.updated": { label: "Conversation updated", entityType: "CONVERSATION", category: "updated" },
  "conversation.assigned": { label: "Conversation assigned", entityType: "CONVERSATION", category: "assignment" },
  "conversation.status_changed": { label: "Conversation status changed", entityType: "CONVERSATION", category: "status" },
  "conversation.closed": { label: "Conversation closed", entityType: "CONVERSATION", category: "archived" },
  "conversation.reopened": { label: "Conversation reopened", entityType: "CONVERSATION", category: "restored" },
  "conversation.archived": { label: "Conversation archived", entityType: "CONVERSATION", category: "archived" },
  "conversation.contact_linked": { label: "Contact linked", entityType: "CONVERSATION", category: "linked" },
  "conversation.company_linked": { label: "Company linked", entityType: "CONVERSATION", category: "linked" },
  "conversation.opportunity_linked": { label: "Opportunity linked", entityType: "CONVERSATION", category: "linked" },
  "conversation.note_added": { label: "Internal note added", entityType: "CONVERSATION", category: "note" },
  "conversation.note_updated": { label: "Internal note edited", entityType: "CONVERSATION", category: "note" },
  "conversation.note_deleted": { label: "Internal note deleted", entityType: "CONVERSATION", category: "note" },
  "message.received": { label: "Message received", entityType: "CONVERSATION", category: "message" },
  "message.sent": { label: "Message sent", entityType: "CONVERSATION", category: "message" },
  "message.failed": { label: "Message failed", entityType: "CONVERSATION", category: "lost" },
  "message.delivered": { label: "Message delivered", entityType: "CONVERSATION", category: "message" },
  "message.read": { label: "Message read by customer", entityType: "CONVERSATION", category: "message" },
  // Phase 12 — message templates (entity TEMPLATE): the template's own history.
  // Payload = TemplateEventPayload (crm-templates.service.ts). A message sent
  // from a template is message.sent on its conversation (payload.templateId).
  "template.created": { label: "Template created", entityType: "TEMPLATE", category: "created" },
  "template.updated": { label: "Template details updated", entityType: "TEMPLATE", category: "updated" },
  "template.version_created": { label: "New version saved", entityType: "TEMPLATE", category: "updated" },
  "template.version_restored": { label: "Version restored", entityType: "TEMPLATE", category: "restored" },
  "template.duplicated": { label: "Template duplicated", entityType: "TEMPLATE", category: "created" },
  "template.activated": { label: "Template activated", entityType: "TEMPLATE", category: "status" },
  "template.deactivated": { label: "Template deactivated", entityType: "TEMPLATE", category: "status" },
  "template.archived": { label: "Template archived", entityType: "TEMPLATE", category: "archived" },
  "template.restored": { label: "Template restored", entityType: "TEMPLATE", category: "restored" },
  "template.test_sent": { label: "Test message sent", entityType: "TEMPLATE", category: "message" },
  // Phase 18 — workflows (entity WORKFLOW): the workflow's own history. What a
  // workflow does to records appears on those records' timelines as the normal
  // events of the services it calls (correlation id "wfexec:<executionId>").
  "workflow.created": { label: "Workflow created", entityType: "WORKFLOW", category: "created" },
  "workflow.updated": { label: "Workflow details updated", entityType: "WORKFLOW", category: "updated" },
  "workflow.draft_saved": { label: "Draft saved", entityType: "WORKFLOW", category: "updated" },
  "workflow.draft_discarded": { label: "Draft discarded", entityType: "WORKFLOW", category: "updated" },
  "workflow.published": { label: "Workflow published", entityType: "WORKFLOW", category: "status" },
  "workflow.paused": { label: "Workflow paused", entityType: "WORKFLOW", category: "status" },
  "workflow.resumed": { label: "Workflow resumed", entityType: "WORKFLOW", category: "status" },
  "workflow.disabled": { label: "Workflow disabled", entityType: "WORKFLOW", category: "status" },
  "workflow.archived": { label: "Workflow archived", entityType: "WORKFLOW", category: "archived" },
  "workflow.restored": { label: "Workflow restored", entityType: "WORKFLOW", category: "restored" },
  "workflow.duplicated": { label: "Workflow duplicated", entityType: "WORKFLOW", category: "created" },
  "workflow.secret_rotated": { label: "Webhook secret rotated", entityType: "WORKFLOW", category: "updated" },
  "workflow.execution_started": { label: "Started on a record", entityType: "WORKFLOW", category: "activity" },
  "workflow.execution_failed": { label: "Execution failed", entityType: "WORKFLOW", category: "lost" },
  "workflow.execution_cancelled": { label: "Execution cancelled", entityType: "WORKFLOW", category: "archived" },
} as const satisfies Record<string, CrmEventDefinition>;

export type CrmEventType = keyof typeof CRM_EVENT_TYPES;

export const CRM_EVENT_TYPE_NAMES = Object.keys(CRM_EVENT_TYPES) as CrmEventType[];

export function isCrmEventType(value: unknown): value is CrmEventType {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(CRM_EVENT_TYPES, value);
}

/** Display label for an event type. Falls back to a readable form for any
 * historical row whose type is no longer registered (rows are never deleted). */
export function crmEventLabel(eventType: string): string {
  return isCrmEventType(eventType) ? CRM_EVENT_TYPES[eventType].label : humanizeStatus(eventType.replace(/\./g, "_"));
}

export function crmEventCategory(eventType: string): CrmEventCategory | "other" {
  return isCrmEventType(eventType) ? CRM_EVENT_TYPES[eventType].category : "other";
}
