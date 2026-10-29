import { ERP_DOC_TYPES, ERP_DOC_TYPE_KEYS, type ErpDocType } from "../opportunities/opportunity-registry";

/**
 * Client-safe registry of what a stage (or a single transition) can require
 * before an opportunity may enter it. Stages store plain keys in
 * `required_fields` (JSONB), so a new requirement is one entry here — no
 * migration, nothing hard-coded per stage.
 *
 *   built-in   "company", "contact", "amount", …
 *   ERP links  "erp:any", "erp:SALES_ORDER", … (from ERP_DOC_TYPES)
 *   custom     "custom:<field key>" (active OPPORTUNITY custom fields)
 *
 * Quotations (Sales & Marketing) are an ERP doc type, so "erp:QUOTATION" is
 * selectable like the others. Nothing is unavailable any more.
 */

export interface RequirementSnapshot {
  crmCompanyId: string | null;
  crmContactId: string | null;
  amount: unknown;
  currencyCode: string | null;
  expectedCloseDate: unknown;
  description: string | null;
  ownerUserId: string | null;
  sourceId: string | null;
  probability: number | null;
  customFields: Record<string, unknown>;
  /** Doc types of the ERP documents currently linked to the opportunity. */
  erpLinkTypes: string[];
}

const present = (v: unknown) => v !== null && v !== undefined && !(typeof v === "string" && v.trim() === "") && !(Array.isArray(v) && v.length === 0);

export const BUILT_IN_REQUIREMENTS = {
  company: { label: "Company", field: "crmCompanyId", check: (s: RequirementSnapshot) => present(s.crmCompanyId) },
  contact: { label: "Contact", field: "crmContactId", check: (s: RequirementSnapshot) => present(s.crmContactId) },
  amount: { label: "Estimated value", field: "amount", check: (s: RequirementSnapshot) => present(s.amount) },
  expectedCloseDate: { label: "Expected close date", field: "expectedCloseDate", check: (s: RequirementSnapshot) => present(s.expectedCloseDate) },
  requirement: { label: "Requirement summary", field: "description", check: (s: RequirementSnapshot) => present(s.description) },
  owner: { label: "Owner", field: "ownerUserId", check: (s: RequirementSnapshot) => present(s.ownerUserId) },
  source: { label: "Source", field: "sourceId", check: (s: RequirementSnapshot) => present(s.sourceId) },
  probability: { label: "Probability", field: "probability", check: (s: RequirementSnapshot) => present(s.probability) },
} as const;
export type BuiltInRequirement = keyof typeof BUILT_IN_REQUIREMENTS;

export const ERP_ANY_REQUIREMENT = "erp:any";
export const CUSTOM_PREFIX = "custom:";
export const ERP_PREFIX = "erp:";

export const UNAVAILABLE_REQUIREMENTS: readonly { key: string; label: string; reason: string }[] = [];

export interface RequirementOption {
  key: string;
  label: string;
  group: "Fields" | "ERP documents" | "Custom fields";
  /** Inactive custom fields stay readable on stages that already use them. */
  inactive?: boolean;
}

/** Every requirement a stage may use, for the configuration UI and validation. */
export function requirementOptions(customFields: { key: string; label: string; isActive: boolean }[]): RequirementOption[] {
  return [
    ...Object.entries(BUILT_IN_REQUIREMENTS).map(([key, r]) => ({ key, label: r.label, group: "Fields" as const })),
    { key: ERP_ANY_REQUIREMENT, label: "Any linked ERP document", group: "ERP documents" as const },
    ...ERP_DOC_TYPE_KEYS.map((t) => ({ key: `${ERP_PREFIX}${t}`, label: `Linked ${ERP_DOC_TYPES[t].label.toLowerCase()}`, group: "ERP documents" as const })),
    ...customFields.map((f) => ({ key: `${CUSTOM_PREFIX}${f.key}`, label: f.label, group: "Custom fields" as const, ...(f.isActive ? {} : { inactive: true }) })),
  ];
}

export function isKnownRequirement(key: string, customFieldKeys: string[]) {
  if (key in BUILT_IN_REQUIREMENTS || key === ERP_ANY_REQUIREMENT) return true;
  if (key.startsWith(ERP_PREFIX)) return (ERP_DOC_TYPE_KEYS as string[]).includes(key.slice(ERP_PREFIX.length));
  if (key.startsWith(CUSTOM_PREFIX)) return customFieldKeys.includes(key.slice(CUSTOM_PREFIX.length));
  return false;
}

export function requirementLabel(key: string, customFields: { key: string; label: string }[] = []) {
  if (key in BUILT_IN_REQUIREMENTS) return BUILT_IN_REQUIREMENTS[key as BuiltInRequirement].label;
  if (key === ERP_ANY_REQUIREMENT) return "A linked ERP document";
  if (key.startsWith(ERP_PREFIX)) {
    const t = key.slice(ERP_PREFIX.length) as ErpDocType;
    return ERP_DOC_TYPES[t] ? `A linked ${ERP_DOC_TYPES[t].label.toLowerCase()}` : key;
  }
  if (key.startsWith(CUSTOM_PREFIX)) return customFields.find((f) => f.key === key.slice(CUSTOM_PREFIX.length))?.label ?? key.slice(CUSTOM_PREFIX.length);
  return key;
}

/** The form field a missing requirement points at (for inline errors), if any. */
export function requirementField(key: string) {
  if (key in BUILT_IN_REQUIREMENTS) return BUILT_IN_REQUIREMENTS[key as BuiltInRequirement].field;
  // Same key the custom-field inputs use for their inline errors.
  if (key.startsWith(CUSTOM_PREFIX)) return `customFields.${key.slice(CUSTOM_PREFIX.length)}`;
  return null;
}

export function isRequirementMet(key: string, s: RequirementSnapshot) {
  if (key in BUILT_IN_REQUIREMENTS) return BUILT_IN_REQUIREMENTS[key as BuiltInRequirement].check(s);
  if (key === ERP_ANY_REQUIREMENT) return s.erpLinkTypes.length > 0;
  if (key.startsWith(ERP_PREFIX)) return s.erpLinkTypes.includes(key.slice(ERP_PREFIX.length));
  if (key.startsWith(CUSTOM_PREFIX)) return present(s.customFields?.[key.slice(CUSTOM_PREFIX.length)]);
  // Unknown keys (e.g. a deleted custom field) never block a move.
  return true;
}

export interface MissingRequirement {
  key: string;
  label: string;
  field: string | null;
}

/** Requirements (deduplicated, in order) the snapshot does not meet. */
export function missingRequirements(keys: string[], s: RequirementSnapshot, customFields: { key: string; label: string }[] = []): MissingRequirement[] {
  // A custom field that no longer exists never blocks a move.
  const gone = (k: string) => k.startsWith(CUSTOM_PREFIX) && !customFields.some((f) => f.key === k.slice(CUSTOM_PREFIX.length));
  return [...new Set(keys)].filter((k) => !gone(k) && !isRequirementMet(k, s)).map((k) => ({ key: k, label: requirementLabel(k, customFields), field: requirementField(k) }));
}
