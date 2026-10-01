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
export type CrmEventCategory = "created" | "updated" | "stage" | "status" | "won" | "lost";

export interface CrmEventDefinition {
  label: string;
  entityType: CrmEntityType;
  category: CrmEventCategory;
}

export const CRM_EVENT_TYPES = {
  "lead.created": { label: "Lead created", entityType: "LEAD", category: "created" },
  "lead.updated": { label: "Lead updated", entityType: "LEAD", category: "updated" },
  "contact.created": { label: "Contact created", entityType: "CONTACT", category: "created" },
  "contact.updated": { label: "Contact updated", entityType: "CONTACT", category: "updated" },
  "company.created": { label: "Company created", entityType: "COMPANY", category: "created" },
  "company.updated": { label: "Company updated", entityType: "COMPANY", category: "updated" },
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
