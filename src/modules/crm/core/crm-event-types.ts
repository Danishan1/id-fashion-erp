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
 * task.*, appointment.*, message.*, form.* arrive with their phases.
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
  | "duplicate";

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
  "opportunity.status_changed": { label: "Status changed", entityType: "OPPORTUNITY", category: "status" },
  "opportunity.won": { label: "Opportunity won", entityType: "OPPORTUNITY", category: "won" },
  "opportunity.lost": { label: "Opportunity lost", entityType: "OPPORTUNITY", category: "lost" },
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
