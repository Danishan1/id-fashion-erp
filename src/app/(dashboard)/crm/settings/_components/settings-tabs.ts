/** Phase 22 — CRM Settings sections (server- and client-safe: the page validates `?tab=` with this list). */

/** Section ids double as the `?tab=` URL value; ids from before Phase 22 are unchanged so existing links keep working. */
export const CRM_SETTINGS_TABS = [
  "overview",
  "access",
  "statuses",
  "sources",
  "tags",
  "custom-fields",
  "duplicates",
  "contact-fields",
  "contact-duplicates",
  "contact-options",
  "company-statuses",
  "company-fields",
  "company-duplicates",
  "pipelines",
  "opportunity-fields",
  "integrations",
  "api",
  "api-keys",
  "webhooks",
  "webhooks-out",
  "channels",
  "automation",
] as const;
export type CrmSettingsTab = (typeof CRM_SETTINGS_TABS)[number];

/** Phase 22 information architecture: grouped sections instead of one long tab strip. */
export const SETTINGS_GROUPS: { label: string; items: { id: CrmSettingsTab; label: string }[] }[] = [
  {
    label: "General",
    items: [
      { id: "overview", label: "Overview" },
      { id: "access", label: "Users & access" },
    ],
  },
  {
    label: "Leads",
    items: [
      { id: "statuses", label: "Lead statuses" },
      { id: "sources", label: "Sources" },
      { id: "tags", label: "Tags" },
      { id: "custom-fields", label: "Lead custom fields" },
      { id: "duplicates", label: "Lead duplicate rules" },
    ],
  },
  {
    label: "Contacts & companies",
    items: [
      { id: "contact-fields", label: "Contact custom fields" },
      { id: "contact-duplicates", label: "Contact duplicate rules" },
      { id: "contact-options", label: "Form options" },
      { id: "company-statuses", label: "Company statuses" },
      { id: "company-fields", label: "Company custom fields" },
      { id: "company-duplicates", label: "Company duplicate rules" },
    ],
  },
  {
    label: "Sales",
    items: [
      { id: "pipelines", label: "Pipelines & stages" },
      { id: "opportunity-fields", label: "Opportunity custom fields" },
    ],
  },
  {
    label: "Integrations",
    items: [
      { id: "integrations", label: "All integrations" },
      { id: "api", label: "API access" },
      { id: "api-keys", label: "API keys" },
      { id: "webhooks", label: "Incoming lead webhooks" },
      { id: "webhooks-out", label: "Outgoing webhooks" },
      { id: "channels", label: "Conversation channels" },
    ],
  },
  {
    label: "Automation",
    items: [{ id: "automation", label: "Workflows & events" }],
  },
];
