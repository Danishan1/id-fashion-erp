import { z } from "zod";
import { ERP_DOC_TYPE_KEYS, OPPORTUNITY_STATUS_KEYS } from "./opportunity-registry";

/** Client-safe (zod only): used by the API, the forms and saved views. */

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal("")).nullable();
const optionalUuid = z.string().uuid().optional().or(z.literal("")).nullable();
const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");

/** Estimated CRM value (not the ERP document amount). */
const amount = z
  .union([z.number(), z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Enter an amount, e.g. 125000.50"), z.literal("")])
  .transform((v) => (v === "" ? null : Number(v)))
  .pipe(z.number().min(0, "Value can't be negative").max(9_999_999_999_999, "Value is too large").nullable())
  .optional()
  .nullable();
/** 0–100 inclusive; anything else is rejected (never clamped). */
const probability = z
  .union([z.number(), z.string().trim().regex(/^-?\d+$/, "Enter a whole number from 0 to 100"), z.literal("")])
  .transform((v) => (v === "" ? null : Number(v)))
  .pipe(z.number().int("Enter a whole number").min(0, "Probability must be 0–100").max(100, "Probability must be 0–100").nullable())
  .optional()
  .nullable();

const opportunityFields = {
  name: z.string().trim().min(1, "Opportunity name is required").max(200),
  crmCompanyId: optionalUuid,
  crmContactId: optionalUuid,
  pipelineId: optionalUuid,
  stageId: optionalUuid,
  amount,
  currencyCode: z.string().trim().length(3, "Use a 3-letter currency code").toUpperCase().optional().or(z.literal("")).nullable(),
  probability,
  expectedCloseDate: isoDate.optional().or(z.literal("")).nullable(),
  ownerUserId: optionalUuid,
  sourceId: optionalUuid,
  description: optionalText(5000),
  customFields: z.record(z.string(), z.unknown()).optional(),
};

export const createOpportunitySchema = z.object({
  ...opportunityFields,
  /** The lead this opportunity came from (preserved for attribution). */
  leadId: optionalUuid,
  tagIds: z.array(uuid).max(50).optional(),
  tagNames: z.array(z.string().trim().min(1).max(40)).max(50).optional(),
  confirmDuplicate: z.boolean().optional(),
});
export type CreateOpportunityInput = z.infer<typeof createOpportunitySchema>;

/** Status is changed only through the status action; the lead link is fixed. */
export const updateOpportunitySchema = z
  .object(opportunityFields)
  .partial()
  .extend({ version: z.number().int().min(1), confirmDuplicate: z.boolean().optional() })
  .strict();
export type UpdateOpportunityInput = z.infer<typeof updateOpportunitySchema>;

export const assignOpportunitySchema = z.object({ ownerUserId: uuid.nullable(), version: z.number().int().min(1).optional() });
export const changeStageSchema = z.object({ stageId: uuid, pipelineId: uuid.optional(), probability, version: z.number().int().min(1).optional() });
export const changeOpportunityStatusSchema = z.object({
  status: z.enum(OPPORTUNITY_STATUS_KEYS),
  reason: z.string().trim().max(500).optional().or(z.literal("")).nullable(),
  version: z.number().int().min(1).optional(),
});
export const linkErpDocumentSchema = z.object({ docType: z.enum(ERP_DOC_TYPE_KEYS), docId: uuid });
export const erpDocumentSearchSchema = z.object({ docType: z.enum(ERP_DOC_TYPE_KEYS), search: z.string().trim().max(100).optional(), limit: z.coerce.number().int().min(1).max(50).default(20) });
export const opportunityDuplicateCheckSchema = z.object({
  name: z.string().trim().max(200).optional(),
  crmCompanyId: optionalUuid,
  crmContactId: optionalUuid,
  excludeOpportunityId: optionalUuid,
});

// ── Filtering (shared by the list API, saved views and future Smart Lists) ──

const idList = z.array(uuid).max(100);
const dateRange = z
  .object({ from: isoDate.optional(), to: isoDate.optional() })
  .refine((r) => !r.from || !r.to || r.from <= r.to, "'From' must be on or before 'To'.");
const numberRange = (max: number) =>
  z
    .object({ min: z.number().min(0).max(max).optional(), max: z.number().min(0).max(max).optional() })
    .refine((r) => r.min === undefined || r.max === undefined || r.min <= r.max, "'Min' must not be above 'Max'.");

export const CLOSE_DUE_OPTIONS = ["overdue", "next_7_days", "next_30_days", "this_month"] as const;

/** Same conventions as the other CRM filters: AND across filters, OR within a list. */
export const opportunityFilterSchema = z
  .object({
    search: z.string().trim().max(200).optional(),
    pipelineIds: idList.optional(),
    stageIds: idList.optional(),
    statuses: z.array(z.enum(OPPORTUNITY_STATUS_KEYS)).max(10).optional(),
    ownerUserIds: idList.optional(),
    unassigned: z.boolean().optional(),
    crmCompanyIds: idList.optional(),
    crmContactIds: idList.optional(),
    sourceIds: idList.optional(),
    tagIds: idList.optional(),
    fromLead: z.enum(["yes", "no"]).optional(),
    closeDue: z.enum(CLOSE_DUE_OPTIONS).optional(),
    expectedCloseDate: dateRange.optional(),
    createdAt: dateRange.optional(),
    updatedAt: dateRange.optional(),
    amount: numberRange(9_999_999_999_999).optional(),
    probability: numberRange(100).optional(),
    archived: z.enum(["exclude", "only", "include"]).default("exclude"),
  })
  .strict();
export type OpportunityFilter = z.infer<typeof opportunityFilterSchema>;

export const OPPORTUNITY_SORT_FIELDS = ["createdAt", "updatedAt", "name", "amount", "probability", "expectedCloseDate", "lastActivityAt", "stage"] as const;
export type OpportunitySortField = (typeof OPPORTUNITY_SORT_FIELDS)[number];
export const opportunitySortSchema = z.object({
  sortBy: z.enum(OPPORTUNITY_SORT_FIELDS).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

const LIST_KEYS = ["pipelineIds", "stageIds", "statuses", "ownerUserIds", "crmCompanyIds", "crmContactIds", "sourceIds", "tagIds"] as const;
const TEXT_KEYS = ["fromLead", "closeDue"] as const;
const DATE_KEYS = ["expectedCloseDate", "createdAt", "updatedAt"] as const;
const NUMBER_KEYS = ["amount", "probability"] as const;

/** Flat query string → OpportunityFilter (comma lists, `<field>From`/`<field>To`, `<field>Min`/`<field>Max`). Unknown params are ignored. */
export function parseOpportunityFilterParams(sp: URLSearchParams): OpportunityFilter {
  const get = (k: string) => sp.get(k)?.trim() || undefined;
  const list = (k: string) => get(k)?.split(",").map((s) => s.trim()).filter(Boolean);
  const range = (k: string) => (get(`${k}From`) || get(`${k}To`) ? { from: get(`${k}From`), to: get(`${k}To`) } : undefined);
  const num = (k: string) => {
    const v = get(k);
    return v === undefined ? undefined : Number(v);
  };
  const numRange = (k: string) => (get(`${k}Min`) || get(`${k}Max`) ? { min: num(`${k}Min`), max: num(`${k}Max`) } : undefined);
  const raw: Record<string, unknown> = { search: get("search"), archived: get("archived") };
  for (const k of LIST_KEYS) raw[k] = list(k);
  for (const k of TEXT_KEYS) raw[k] = get(k);
  for (const k of DATE_KEYS) raw[k] = range(k);
  for (const k of NUMBER_KEYS) raw[k] = numRange(k);
  if (get("unassigned") === "true") raw.unassigned = true;
  return opportunityFilterSchema.parse(raw);
}

/** Inverse of parseOpportunityFilterParams — a stored filter (saved view) back to query params. */
export function opportunityFilterToParams(filter: Partial<OpportunityFilter>): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (k: string, v: unknown) => {
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) return;
    out[k] = Array.isArray(v) ? v.join(",") : String(v);
  };
  for (const k of LIST_KEYS) put(k, filter[k]);
  for (const k of TEXT_KEYS) put(k, filter[k]);
  if (filter.unassigned) out.unassigned = "true";
  if (filter.archived && filter.archived !== "exclude") out.archived = filter.archived;
  for (const k of DATE_KEYS) {
    put(`${k}From`, filter[k]?.from);
    put(`${k}To`, filter[k]?.to);
  }
  for (const k of NUMBER_KEYS) {
    put(`${k}Min`, filter[k]?.min);
    put(`${k}Max`, filter[k]?.max);
  }
  return out;
}

// ── Bulk ──

export const BULK_OPPORTUNITY_LIMIT = 500;
const bulkIds = z.array(uuid).min(1).max(BULK_OPPORTUNITY_LIMIT);
export const bulkOpportunitySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assign"), ids: bulkIds, ownerUserId: uuid.nullable() }),
  z.object({ action: z.literal("stage"), ids: bulkIds, stageId: uuid }),
  z.object({ action: z.literal("status"), ids: bulkIds, status: z.enum(OPPORTUNITY_STATUS_KEYS), reason: z.string().trim().max(500).optional().nullable() }),
  z.object({
    action: z.literal("addTags"),
    ids: bulkIds,
    tagIds: z.array(uuid).max(50).default([]),
    tagNames: z.array(z.string().trim().min(1).max(40)).max(50).default([]),
  }),
  z.object({ action: z.literal("removeTags"), ids: bulkIds, tagIds: z.array(uuid).min(1).max(50) }),
  z.object({ action: z.literal("archive"), ids: bulkIds }),
]);
