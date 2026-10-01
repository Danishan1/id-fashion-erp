/**
 * The CRM lead fields an incoming record (file column, API field, webhook
 * payload key) can be mapped to, with the header aliases used for automatic
 * mapping suggestions. Client-safe: the import wizard and the server use the
 * same catalog, so a mapping chosen in the browser means the same thing on
 * the server. Custom fields are mapped as `cf:<key>`.
 */

export type LeadTargetKind = "text" | "email" | "phone" | "number" | "date" | "lookup" | "list";

export interface LeadTargetField {
  key: string;
  label: string;
  kind: LeadTargetKind;
  group: "Person" | "Contact" | "Company" | "Lead" | "Attribution" | "Other";
  aliases: string[];
  hint?: string;
}

export const LEAD_TARGET_FIELDS: LeadTargetField[] = [
  { key: "fullName", label: "Full name (split into first/last)", kind: "text", group: "Person", aliases: ["name", "full name", "customer name", "contact name", "contact person", "person name", "lead name", "client name", "buyer name"] },
  { key: "firstName", label: "First name", kind: "text", group: "Person", aliases: ["first name", "firstname", "given name", "fname"] },
  { key: "lastName", label: "Last name", kind: "text", group: "Person", aliases: ["last name", "lastname", "surname", "family name", "lname"] },
  { key: "designation", label: "Designation", kind: "text", group: "Person", aliases: ["designation", "title", "job title", "position", "role"] },
  { key: "email", label: "Email", kind: "email", group: "Contact", aliases: ["email", "email id", "email address", "e-mail", "mail", "mail id", "emailid"] },
  { key: "alternateEmail", label: "Alternate email", kind: "email", group: "Contact", aliases: ["alternate email", "alt email", "secondary email", "other email", "email 2"] },
  { key: "phone", label: "Phone", kind: "phone", group: "Contact", aliases: ["phone", "phone no", "phone number", "telephone", "tel", "landline", "contact no", "contact number"] },
  { key: "mobile", label: "Mobile", kind: "phone", group: "Contact", aliases: ["mobile", "mobile no", "mobile number", "cell", "cell phone", "mob", "mob no", "mobile phone"] },
  { key: "whatsapp", label: "WhatsApp", kind: "phone", group: "Contact", aliases: ["whatsapp", "whatsapp no", "whatsapp number", "wa number"] },
  { key: "companyName", label: "Company", kind: "text", group: "Company", aliases: ["company", "company name", "organisation", "organization", "firm", "business name", "account", "account name"] },
  { key: "industry", label: "Industry", kind: "text", group: "Company", aliases: ["industry", "sector", "business type", "segment"] },
  { key: "city", label: "City", kind: "text", group: "Company", aliases: ["city", "town", "location", "place"] },
  { key: "state", label: "State", kind: "text", group: "Company", aliases: ["state", "province", "region"] },
  { key: "country", label: "Country", kind: "text", group: "Company", aliases: ["country", "nation"] },
  { key: "requirement", label: "Requirement", kind: "text", group: "Lead", aliases: ["requirement", "requirements", "enquiry", "inquiry", "message", "query", "description", "details", "comments", "notes", "product", "product interest"] },
  { key: "estimatedValue", label: "Estimated value", kind: "number", group: "Lead", aliases: ["estimated value", "value", "budget", "deal value", "amount", "order value"] },
  { key: "currencyCode", label: "Currency (3 letters)", kind: "text", group: "Lead", aliases: ["currency", "currency code"] },
  { key: "score", label: "Score (0–100)", kind: "number", group: "Lead", aliases: ["score", "lead score", "rating"] },
  { key: "temperature", label: "Temperature (Hot/Warm/Cold)", kind: "text", group: "Lead", aliases: ["temperature", "temp", "priority", "lead temperature"] },
  { key: "status", label: "Status (by name)", kind: "lookup", group: "Lead", aliases: ["status", "lead status", "stage"], hint: "Matched by status name or key; unknown values use the default status." },
  { key: "source", label: "Lead source (by name)", kind: "lookup", group: "Attribution", aliases: ["source", "lead source", "channel", "origin"], hint: "Matched by source name or key; unknown values use the import's source." },
  { key: "owner", label: "Owner (email or name)", kind: "lookup", group: "Lead", aliases: ["owner", "lead owner", "assigned to", "assignee", "sales person", "salesperson", "executive"], hint: "Matched to an active user by email or full name." },
  { key: "tags", label: "Tags (comma separated)", kind: "list", group: "Lead", aliases: ["tags", "tag", "labels", "label"] },
  { key: "nextFollowUpAt", label: "Next follow-up", kind: "date", group: "Lead", aliases: ["next follow up", "follow up", "follow up date", "next followup", "followup date"] },
  { key: "lastContactedAt", label: "Last contacted", kind: "date", group: "Lead", aliases: ["last contacted", "last contact", "last contact date"] },
  { key: "utmSource", label: "UTM source", kind: "text", group: "Attribution", aliases: ["utm source", "utm_source"] },
  { key: "utmMedium", label: "UTM medium", kind: "text", group: "Attribution", aliases: ["utm medium", "utm_medium"] },
  { key: "utmCampaign", label: "UTM campaign", kind: "text", group: "Attribution", aliases: ["utm campaign", "utm_campaign"] },
  { key: "utmTerm", label: "UTM term", kind: "text", group: "Attribution", aliases: ["utm term", "utm_term"] },
  { key: "utmContent", label: "UTM content", kind: "text", group: "Attribution", aliases: ["utm content", "utm_content"] },
  { key: "campaignSource", label: "Campaign", kind: "text", group: "Attribution", aliases: ["campaign", "campaign name", "campaign source"] },
  { key: "referralSource", label: "Referred by", kind: "text", group: "Attribution", aliases: ["referral", "referred by", "referral source", "referrer"] },
  { key: "externalId", label: "External lead ID", kind: "text", group: "Other", aliases: ["external id", "lead id", "external lead id", "reference", "ref no", "reference id", "enquiry id"], hint: "The record's id in the system it came from — re-importing the same id is recognised." },
];

export const LEAD_TARGET_FIELD_KEYS = new Set(LEAD_TARGET_FIELDS.map((f) => f.key));
export const CUSTOM_FIELD_PREFIX = "cf:";

/** Source column (header) → target field key, or "" for "ignore this column". */
export type LeadFieldMapping = Record<string, string>;

export function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/[_\-./]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface CustomFieldTarget {
  key: string;
  label: string;
  isActive: boolean;
}

/**
 * Suggests a target for every header: exact key/label/alias match first,
 * then custom fields by key/label. Each target is suggested at most once
 * (the first matching column wins) so a suggestion never fails validation.
 */
export function suggestLeadMapping(headers: string[], customFields: CustomFieldTarget[] = []): LeadFieldMapping {
  const lookup = new Map<string, string>();
  for (const f of LEAD_TARGET_FIELDS) {
    for (const alias of [f.key, f.label, ...f.aliases]) {
      const k = normalizeHeader(alias);
      if (!lookup.has(k)) lookup.set(k, f.key);
    }
  }
  for (const cf of customFields.filter((c) => c.isActive)) {
    for (const alias of [cf.key, cf.label]) {
      const k = normalizeHeader(alias);
      if (!lookup.has(k)) lookup.set(k, `${CUSTOM_FIELD_PREFIX}${cf.key}`);
    }
  }
  const used = new Set<string>();
  const mapping: LeadFieldMapping = {};
  for (const h of headers) {
    const target = lookup.get(normalizeHeader(h));
    if (target && !used.has(target)) {
      mapping[h] = target;
      used.add(target);
    } else mapping[h] = "";
  }
  return mapping;
}

export interface MappingIssue {
  level: "error" | "warning";
  message: string;
}

const NAME_TARGETS = ["fullName", "firstName", "companyName"];
const CONTACT_TARGETS = ["email", "alternateEmail", "phone", "mobile", "whatsapp"];

/** A mapping must identify the lead (a name or company) and give a way to reach them (email or a phone). */
export function validateLeadMapping(mapping: LeadFieldMapping, customFields: CustomFieldTarget[] = []): MappingIssue[] {
  const issues: MappingIssue[] = [];
  const targets = Object.values(mapping).filter(Boolean);
  const seen = new Map<string, number>();
  for (const t of targets) seen.set(t, (seen.get(t) ?? 0) + 1);
  for (const [t, n] of seen) {
    if (n > 1) issues.push({ level: "error", message: `${labelForTarget(t, customFields)} is mapped from ${n} columns. Map it from one column only.` });
  }
  const cfKeys = new Set(customFields.map((c) => c.key));
  for (const t of seen.keys()) {
    if (t.startsWith(CUSTOM_FIELD_PREFIX) ? !cfKeys.has(t.slice(CUSTOM_FIELD_PREFIX.length)) : !LEAD_TARGET_FIELD_KEYS.has(t)) {
      issues.push({ level: "error", message: `Unknown field "${t}".` });
    }
  }
  if (!NAME_TARGETS.some((t) => seen.has(t))) issues.push({ level: "error", message: "Map a name column (Full name or First name) or a Company column." });
  if (!CONTACT_TARGETS.some((t) => seen.has(t))) issues.push({ level: "error", message: "Map at least one contact column: Email, Phone, Mobile or WhatsApp." });
  if (seen.has("fullName") && (seen.has("firstName") || seen.has("lastName"))) {
    issues.push({ level: "warning", message: "Both Full name and First/Last name are mapped — First/Last name are used when filled." });
  }
  if (!seen.has("fullName") && !seen.has("firstName")) issues.push({ level: "warning", message: "No person name is mapped — the company name will be used as the lead name." });
  return issues;
}

export function labelForTarget(target: string, customFields: CustomFieldTarget[] = []): string {
  if (target.startsWith(CUSTOM_FIELD_PREFIX)) {
    const key = target.slice(CUSTOM_FIELD_PREFIX.length);
    return customFields.find((c) => c.key === key)?.label ?? key;
  }
  return LEAD_TARGET_FIELDS.find((f) => f.key === target)?.label ?? target;
}
