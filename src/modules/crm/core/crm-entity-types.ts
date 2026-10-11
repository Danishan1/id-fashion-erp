import type { CrmEntityType } from "@prisma/client";

/**
 * Client-safe registry of CRM record types (no Prisma runtime / server
 * imports — only the generated enum's *type*). Keyed by the `CrmEntityType`
 * enum so adding a value to the schema without registering it here is a
 * compile error.
 *
 * `basePath` stays undefined until the phase that builds that record's pages
 * lands; the timeline then starts linking to it automatically.
 */
export interface CrmEntityTypeConfig {
  label: string;
  pluralLabel: string;
  /** Table name used for AuditLog rows of this entity. */
  tableName: string;
  /** Detail page is `${basePath}/${id}` once the entity's pages exist. */
  basePath?: string;
}

export const CRM_ENTITY_TYPE_CONFIG: Record<CrmEntityType, CrmEntityTypeConfig> = {
  LEAD: { label: "Lead", pluralLabel: "Leads", tableName: "crm_leads", basePath: "/crm/leads" },
  CONTACT: { label: "Contact", pluralLabel: "Contacts", tableName: "crm_contacts", basePath: "/crm/contacts" },
  COMPANY: { label: "Company", pluralLabel: "Companies", tableName: "crm_companies", basePath: "/crm/companies" },
  OPPORTUNITY: { label: "Opportunity", pluralLabel: "Opportunities", tableName: "crm_opportunities", basePath: "/crm/opportunities" },
  ACTIVITY: { label: "Activity", pluralLabel: "Activities", tableName: "crm_activities", basePath: "/crm/activities" },
  CONVERSATION: { label: "Conversation", pluralLabel: "Conversations", tableName: "crm_conversations", basePath: "/crm/inbox" },
  TEMPLATE: { label: "Message template", pluralLabel: "Message templates", tableName: "crm_message_templates", basePath: "/crm/templates" },
};

export const CRM_ENTITY_TYPES = Object.keys(CRM_ENTITY_TYPE_CONFIG) as CrmEntityType[];

export function isCrmEntityType(value: unknown): value is CrmEntityType {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(CRM_ENTITY_TYPE_CONFIG, value);
}

export function crmEntityLabel(type: CrmEntityType): string {
  return CRM_ENTITY_TYPE_CONFIG[type].label;
}

/** Detail-page URL for a CRM record, or null while that entity has no pages yet. */
export function crmEntityHref(type: CrmEntityType, id: string): string | null {
  const basePath = CRM_ENTITY_TYPE_CONFIG[type].basePath;
  return basePath ? `${basePath}/${id}` : null;
}
