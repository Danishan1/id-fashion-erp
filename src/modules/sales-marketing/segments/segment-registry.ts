import { z } from "zod";

/**
 * Audience segments (Phase 09) — client-safe registry: sources, statuses,
 * the allow-listed fields per source, operators per field type and the
 * criteria shape. The UI builder, the API validation and the server-side query
 * builder (segment-query.ts) all read from here, so a field or operator that
 * isn't listed can't be saved, previewed or evaluated.
 *
 * Semantics (PHASE_09_SEGMENTS.md §3):
 *  - Text comparisons ignore case. "Is empty" = no value or blank text.
 *  - Positive operators (equals, contains, in, >, before, …) never match an
 *    empty value. Negative operators (not equals, does not contain, not in)
 *    DO match empty values: a record with no country is "not India".
 *  - Dates are calendar days in Asia/Kolkata. "Before D" = earlier than day D,
 *    "after D" = later than day D, "between A and B" includes both days,
 *    "in the last N days" = today and the N-1 days before it.
 *  - Archived / merged CRM records and deleted or inactive customers are never
 *    part of any segment.
 */

export const SEGMENT_SOURCES = {
  CONTACT: { label: "CRM contacts", singular: "contact", consentAvailable: true },
  COMPANY: { label: "CRM companies", singular: "company", consentAvailable: false },
  LEAD: { label: "CRM leads", singular: "lead", consentAvailable: false },
  CUSTOMER: { label: "ERP customers", singular: "customer", consentAvailable: false },
} as const;
export type SegmentSourceKey = keyof typeof SEGMENT_SOURCES;
export const SEGMENT_SOURCE_KEYS = Object.keys(SEGMENT_SOURCES) as [SegmentSourceKey, ...SegmentSourceKey[]];

export const SEGMENT_TYPES = {
  DYNAMIC: { label: "Dynamic", hint: "Members are whoever matches the saved rules when the segment is evaluated." },
  STATIC: { label: "Static", hint: "Members are added and removed by hand; rules aren't used." },
} as const;
export type SegmentTypeKey = keyof typeof SEGMENT_TYPES;
export const SEGMENT_TYPE_KEYS = Object.keys(SEGMENT_TYPES) as [SegmentTypeKey, ...SegmentTypeKey[]];

export const SEGMENT_STATUSES = {
  DRAFT: { label: "Draft", tone: "zinc" },
  ACTIVE: { label: "Active", tone: "green" },
  PAUSED: { label: "Paused", tone: "amber" },
  ARCHIVED: { label: "Archived", tone: "red" },
} as const;
export type SegmentStatusKey = keyof typeof SEGMENT_STATUSES;
export const SEGMENT_STATUS_KEYS = Object.keys(SEGMENT_STATUSES) as [SegmentStatusKey, ...SegmentStatusKey[]];

/** Lifecycle moves (archive is final). */
export const SEGMENT_ACTIONS = {
  activate: { label: "Activate", from: ["DRAFT", "PAUSED"], to: "ACTIVE" },
  pause: { label: "Pause", from: ["ACTIVE"], to: "PAUSED" },
  archive: { label: "Archive", from: ["DRAFT", "ACTIVE", "PAUSED"], to: "ARCHIVED" },
} as const satisfies Record<string, { label: string; from: readonly SegmentStatusKey[]; to: SegmentStatusKey }>;
export type SegmentActionKey = keyof typeof SEGMENT_ACTIONS;

export const SEGMENT_REFRESH = { MANUAL: "Only when someone refreshes it", NIGHTLY: "Every night (and on demand)" } as const;
export type SegmentRefreshKey = keyof typeof SEGMENT_REFRESH;

export const EVALUATION_STATUSES = {
  QUEUED: { label: "Queued", tone: "zinc" },
  RUNNING: { label: "Running", tone: "indigo" },
  COMPLETED: { label: "Completed", tone: "green" },
  FAILED: { label: "Failed", tone: "red" },
  SUPERSEDED: { label: "Outdated (definition changed)", tone: "amber" },
} as const;
export type EvaluationStatusKey = keyof typeof EVALUATION_STATUSES;

/** Eligibility channel: which channel the audience is meant for (checks address + consent). */
export const ELIGIBILITY_CHANNELS = { EMAIL: "Email", WHATSAPP: "WhatsApp", SMS: "SMS", PHONE: "Phone calls" } as const;
export type EligibilityChannelKey = keyof typeof ELIGIBILITY_CHANNELS;
export const ELIGIBILITY_CHANNEL_KEYS = Object.keys(ELIGIBILITY_CHANNELS) as [EligibilityChannelKey, ...EligibilityChannelKey[]];

/** Why a record was left out of a snapshot. */
export const ENTRY_REASONS = {
  MANUAL_EXCLUSION: "Excluded by hand",
  EXCLUSION_RULE: "Matches an exclusion rule",
  CONSENT_RESTRICTED: "Opted out / do not contact on this channel",
  NO_ADDRESS: "No address for this channel",
  NOT_ACCESSIBLE: "Outside the access of the person who ran it",
  SOURCE_UNAVAILABLE: "Record archived, merged, deleted or inactive",
} as const;
export type EntryReasonKey = keyof typeof ENTRY_REASONS;

// ── Fields and operators ─────────────────────────────────────────────

export type FieldType = "text" | "number" | "date" | "boolean" | "enum" | "lookup" | "tags";
/** Option lists loaded from the company's own masters (segment field-options API). */
export type LookupKey = "users" | "leadSources" | "leadStatuses" | "companyStatuses" | "territories" | "campaigns" | "tags";

export interface SegmentFieldDef {
  key: string;
  label: string;
  type: FieldType;
  options?: readonly { value: string; label: string }[];
  lookup?: LookupKey;
  /** Restricts the type's default operators (e.g. computed fields). */
  operators?: readonly OperatorKey[];
  hint?: string;
}

export const OPERATORS = {
  equals: { label: "is", arity: 1 },
  not_equals: { label: "is not", arity: 1 },
  contains: { label: "contains", arity: 1 },
  not_contains: { label: "does not contain", arity: 1 },
  starts_with: { label: "starts with", arity: 1 },
  gt: { label: "greater than", arity: 1 },
  gte: { label: "at least", arity: 1 },
  lt: { label: "less than", arity: 1 },
  lte: { label: "at most", arity: 1 },
  between: { label: "between", arity: 2 },
  on: { label: "on", arity: 1 },
  before: { label: "before", arity: 1 },
  after: { label: "after", arity: 1 },
  in_last_days: { label: "in the last … days", arity: 1 },
  not_in_last_days: { label: "not in the last … days", arity: 1 },
  in: { label: "is any of", arity: "list" },
  not_in: { label: "is none of", arity: "list" },
  has_any: { label: "has any of", arity: "list" },
  has_all: { label: "has all of", arity: "list" },
  has_none: { label: "has none of", arity: "list" },
  is_true: { label: "is yes", arity: 0 },
  is_false: { label: "is no", arity: 0 },
  is_empty: { label: "is empty", arity: 0 },
  is_not_empty: { label: "is not empty", arity: 0 },
} as const;
export type OperatorKey = keyof typeof OPERATORS;

export const OPERATORS_BY_TYPE: Record<FieldType, readonly OperatorKey[]> = {
  text: ["equals", "not_equals", "contains", "not_contains", "starts_with", "is_empty", "is_not_empty"],
  number: ["equals", "not_equals", "gt", "gte", "lt", "lte", "between", "is_empty", "is_not_empty"],
  date: ["on", "before", "after", "between", "in_last_days", "not_in_last_days", "is_empty", "is_not_empty"],
  boolean: ["is_true", "is_false"],
  enum: ["in", "not_in", "is_empty", "is_not_empty"],
  lookup: ["in", "not_in", "is_empty", "is_not_empty"],
  tags: ["has_any", "has_all", "has_none"],
};

const LEAD_TEMPERATURES = [
  { value: "COLD", label: "Cold" },
  { value: "WARM", label: "Warm" },
  { value: "HOT", label: "Hot" },
] as const;
const CAPTURE_CHANNELS = [
  { value: "MANUAL", label: "Manual" },
  { value: "CSV", label: "CSV import" },
  { value: "XLSX", label: "Excel import" },
  { value: "WEBSITE_FORM", label: "Website form" },
  { value: "API", label: "API" },
  { value: "WEBHOOK", label: "Webhook" },
  { value: "INTEGRATION", label: "Integration" },
] as const;

export const SEGMENT_FIELDS: Record<SegmentSourceKey, readonly SegmentFieldDef[]> = {
  CONTACT: [
    { key: "fullName", label: "Name", type: "text" },
    { key: "email", label: "Email", type: "text" },
    { key: "mobile", label: "Mobile", type: "text" },
    { key: "designation", label: "Designation", type: "text" },
    { key: "department", label: "Department", type: "text" },
    { key: "company.name", label: "Company name", type: "text" },
    { key: "company.country", label: "Company country", type: "text" },
    { key: "company.state", label: "Company state", type: "text" },
    { key: "company.city", label: "Company city", type: "text" },
    { key: "company.industry", label: "Company industry", type: "text" },
    { key: "company.isErpCustomer", label: "Company is an ERP customer", type: "boolean" },
    { key: "ownerUserId", label: "Owner", type: "lookup", lookup: "users" },
    { key: "sourceId", label: "Source", type: "lookup", lookup: "leadSources" },
    { key: "createdAt", label: "Created", type: "date" },
    { key: "lastActivityAt", label: "Last activity", type: "date" },
    { key: "tags", label: "Tags", type: "tags", lookup: "tags" },
  ],
  COMPANY: [
    { key: "name", label: "Name", type: "text" },
    { key: "companyType", label: "Company type", type: "text" },
    { key: "industry", label: "Industry", type: "text" },
    { key: "country", label: "Country", type: "text" },
    { key: "state", label: "State", type: "text" },
    { key: "city", label: "City", type: "text" },
    { key: "email", label: "Email", type: "text" },
    { key: "statusId", label: "Status", type: "lookup", lookup: "companyStatuses" },
    { key: "isErpCustomer", label: "Is an ERP customer", type: "boolean" },
    { key: "ownerUserId", label: "Owner", type: "lookup", lookup: "users" },
    { key: "sourceId", label: "Source", type: "lookup", lookup: "leadSources" },
    { key: "createdAt", label: "Created", type: "date" },
    { key: "lastActivityAt", label: "Last activity", type: "date" },
    { key: "tags", label: "Tags", type: "tags", lookup: "tags" },
  ],
  LEAD: [
    { key: "fullName", label: "Name", type: "text" },
    { key: "companyName", label: "Company name", type: "text" },
    { key: "email", label: "Email", type: "text" },
    { key: "industry", label: "Industry", type: "text" },
    { key: "country", label: "Country", type: "text" },
    { key: "state", label: "State", type: "text" },
    { key: "city", label: "City", type: "text" },
    { key: "statusId", label: "Status", type: "lookup", lookup: "leadStatuses" },
    { key: "sourceId", label: "Source", type: "lookup", lookup: "leadSources" },
    { key: "ownerUserId", label: "Owner", type: "lookup", lookup: "users" },
    { key: "campaignId", label: "Campaign", type: "lookup", lookup: "campaigns" },
    { key: "temperature", label: "Temperature", type: "enum", options: LEAD_TEMPERATURES },
    { key: "captureChannel", label: "Captured through", type: "enum", options: CAPTURE_CHANNELS },
    { key: "score", label: "Score", type: "number" },
    { key: "estimatedValue", label: "Estimated value", type: "number" },
    { key: "converted", label: "Converted", type: "boolean" },
    { key: "createdAt", label: "Created", type: "date" },
    { key: "lastContactedAt", label: "Last contacted", type: "date" },
    { key: "tags", label: "Tags", type: "tags", lookup: "tags" },
  ],
  CUSTOMER: [
    { key: "name", label: "Name", type: "text" },
    { key: "code", label: "Code", type: "text" },
    { key: "type", label: "Type", type: "text" },
    { key: "country", label: "Country", type: "text" },
    { key: "city", label: "City", type: "text" },
    { key: "email", label: "Email", type: "text" },
    { key: "salesTerritoryId", label: "Sales territory", type: "lookup", lookup: "territories" },
    { key: "createdAt", label: "Created", type: "date" },
    { key: "lastOrderDate", label: "Last booked order date", type: "date", hint: "Booked Sales Orders only (same rule as Sales Performance). Empty = never ordered." },
    { key: "bookedOrderValue", label: "Total booked order value (₹)", type: "number", operators: ["gt", "gte", "lt", "lte", "between", "equals"], hint: "All booked Sales Orders, in the company currency." },
    { key: "bookedOrderCount", label: "Number of booked orders", type: "number", operators: ["gt", "gte", "lt", "lte", "between", "equals"] },
  ],
};

export function fieldDef(source: SegmentSourceKey, key: string): SegmentFieldDef | undefined {
  return SEGMENT_FIELDS[source].find((f) => f.key === key);
}
export function operatorsFor(field: SegmentFieldDef): readonly OperatorKey[] {
  return field.operators ?? OPERATORS_BY_TYPE[field.type];
}

// ── Criteria shape and validation ───────────────────────────────────

export const CRITERIA_LIMITS = { groups: 10, conditionsPerGroup: 20, listValues: 200, textLength: 200 } as const;

export interface SegmentCondition {
  field: string;
  operator: OperatorKey;
  value?: unknown;
}
export interface SegmentGroup {
  match: "ALL" | "ANY";
  conditions: SegmentCondition[];
}
/** Groups are combined with `match`; conditions inside a group with the group's own `match`. Zero groups = every record. */
export interface SegmentCriteria {
  match: "ALL" | "ANY";
  groups: SegmentGroup[];
}
export const EMPTY_CRITERIA: SegmentCriteria = { match: "ALL", groups: [] };

const conditionSchema = z.object({ field: z.string().max(60), operator: z.string().max(30), value: z.unknown().optional() }).strict();
const groupSchema = z.object({ match: z.enum(["ALL", "ANY"]), conditions: z.array(conditionSchema).min(1, "A group needs at least one condition").max(CRITERIA_LIMITS.conditionsPerGroup) }).strict();
export const criteriaShapeSchema = z.object({ match: z.enum(["ALL", "ANY"]), groups: z.array(groupSchema).max(CRITERIA_LIMITS.groups) }).strict();

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isIsoDate = (v: unknown): v is string => typeof v === "string" && ISO_DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e13;
const isUuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export interface CriteriaIssue {
  group: number;
  condition: number;
  message: string;
}

/**
 * Checks one condition against the allow-list. Returns the normalised value
 * (trimmed text, numbers, sorted pair) or an error message. Pure — used by the
 * builder for inline messages and by the server as the real gate.
 */
export function validateCondition(source: SegmentSourceKey, c: { field: string; operator: string; value?: unknown }): { ok: true; value: unknown } | { ok: false; message: string } {
  const field = fieldDef(source, c.field);
  if (!field) return { ok: false, message: `"${c.field}" isn't a field you can filter ${SEGMENT_SOURCES[source].label} on.` };
  const ops = operatorsFor(field);
  if (!ops.includes(c.operator as OperatorKey)) return { ok: false, message: `${field.label}: choose a valid comparison.` };
  const op = c.operator as OperatorKey;
  const arity = OPERATORS[op].arity;
  if (arity === 0) return { ok: true, value: undefined };
  const v = c.value;
  if (arity === "list") {
    if (!Array.isArray(v) || v.length === 0) return { ok: false, message: `${field.label}: pick at least one value.` };
    if (v.length > CRITERIA_LIMITS.listValues) return { ok: false, message: `${field.label}: at most ${CRITERIA_LIMITS.listValues} values.` };
    const allowed = field.options?.map((o) => o.value);
    for (const item of v) {
      if (allowed ? !allowed.includes(item as string) : !isUuid(item)) return { ok: false, message: `${field.label}: one of the chosen values isn't valid.` };
    }
    return { ok: true, value: [...new Set(v as string[])] };
  }
  if (field.type === "text") {
    if (typeof v !== "string" || !v.trim()) return { ok: false, message: `${field.label}: enter a value.` };
    if (v.length > CRITERIA_LIMITS.textLength) return { ok: false, message: `${field.label}: value is too long.` };
    return { ok: true, value: v.trim() };
  }
  if (field.type === "number") {
    if (op === "between") {
      if (!Array.isArray(v) || v.length !== 2 || !isNum(v[0]) || !isNum(v[1])) return { ok: false, message: `${field.label}: enter both numbers.` };
      if (v[0] > v[1]) return { ok: false, message: `${field.label}: the first number must not be bigger than the second.` };
      return { ok: true, value: [v[0], v[1]] };
    }
    if (!isNum(v)) return { ok: false, message: `${field.label}: enter a number.` };
    return { ok: true, value: v };
  }
  if (field.type === "date") {
    if (op === "in_last_days" || op === "not_in_last_days") {
      if (!isNum(v) || !Number.isInteger(v) || v < 1 || v > 3650) return { ok: false, message: `${field.label}: enter a number of days between 1 and 3650.` };
      return { ok: true, value: v };
    }
    if (op === "between") {
      if (!Array.isArray(v) || v.length !== 2 || !isIsoDate(v[0]) || !isIsoDate(v[1])) return { ok: false, message: `${field.label}: pick both dates.` };
      if (v[0] > v[1]) return { ok: false, message: `${field.label}: the start date is after the end date.` };
      return { ok: true, value: [v[0], v[1]] };
    }
    if (!isIsoDate(v)) return { ok: false, message: `${field.label}: pick a date.` };
    return { ok: true, value: v };
  }
  return { ok: false, message: `${field.label}: unsupported comparison.` };
}

/**
 * Validates a whole criteria object. Returns the normalised criteria (values
 * cleaned, unknown keys dropped) plus every problem found, so the UI can show
 * them all at once. Contradictions caught: the same field with two different
 * "is" values inside an ALL group.
 */
export function validateCriteria(source: SegmentSourceKey, raw: unknown): { criteria: SegmentCriteria; issues: CriteriaIssue[] } {
  const parsed = criteriaShapeSchema.safeParse(raw ?? EMPTY_CRITERIA);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { criteria: EMPTY_CRITERIA, issues: [{ group: -1, condition: -1, message: first?.message === "Required" ? "The rules are incomplete." : (first?.message ?? "The rules are not valid.") }] };
  }
  const issues: CriteriaIssue[] = [];
  const groups: SegmentGroup[] = parsed.data.groups.map((g, gi) => {
    const conditions = g.conditions.map((c, ci) => {
      const r = validateCondition(source, c);
      if (!r.ok) {
        issues.push({ group: gi, condition: ci, message: r.message });
        return { field: c.field, operator: c.operator as OperatorKey, value: c.value };
      }
      return r.value === undefined ? { field: c.field, operator: c.operator as OperatorKey } : { field: c.field, operator: c.operator as OperatorKey, value: r.value };
    });
    if (g.match === "ALL") {
      const seen = new Map<string, string>();
      conditions.forEach((c, ci) => {
        if (c.operator !== "equals" || typeof c.value !== "string") return;
        const prev = seen.get(c.field);
        if (prev !== undefined && prev.toLowerCase() !== c.value.toLowerCase()) issues.push({ group: gi, condition: ci, message: `${fieldDef(source, c.field)?.label ?? c.field} can't be two different values at once — use "Match any" for this group.` });
        seen.set(c.field, c.value);
      });
    }
    return { match: g.match, conditions };
  });
  return { criteria: { match: parsed.data.match, groups }, issues };
}

export const conditionCount = (c: SegmentCriteria | null | undefined) => (c?.groups ?? []).reduce((n, g) => n + g.conditions.length, 0);

/** Human sentence for a condition (definition summaries, version history). */
export function describeCondition(source: SegmentSourceKey, c: SegmentCondition, labels: Record<string, string> = {}): string {
  const field = fieldDef(source, c.field);
  const name = field?.label ?? c.field;
  const op = OPERATORS[c.operator]?.label ?? c.operator;
  const show = (v: unknown) => (typeof v === "string" ? (field?.options?.find((o) => o.value === v)?.label ?? labels[v] ?? v) : String(v));
  const arity = OPERATORS[c.operator]?.arity;
  if (arity === 0) return `${name} ${op}`;
  if (Array.isArray(c.value)) {
    if (c.operator === "between") return `${name} between ${show(c.value[0])} and ${show(c.value[1])}`;
    return `${name} ${op} ${c.value.map(show).join(", ")}`;
  }
  if (c.operator === "in_last_days" || c.operator === "not_in_last_days") return `${name} ${op.replace("…", String(c.value))}`;
  return `${name} ${op} ${show(c.value)}`;
}
