import { z } from "zod";
import { contactAddressSchema } from "../contacts/contact.schema";

/** Client-safe (zod only): used by the API, the forms and saved views. */

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal("")).nullable();
const optionalEmail = z.string().trim().email("Enter a valid email").max(200).optional().or(z.literal("")).nullable();
const optionalPhone = z
  .string()
  .trim()
  .regex(/^[+\d\s().-]{5,30}$/, "Enter a valid phone number")
  .optional()
  .or(z.literal(""))
  .nullable();
const optionalUuid = z.string().uuid().optional().or(z.literal("")).nullable();
const uuid = z.string().uuid();

const companyFields = {
  name: z.string().trim().min(1, "Company name is required").max(200),
  legalName: optionalText(200),
  displayName: optionalText(200),
  companyType: optionalText(100),
  industry: optionalText(100),
  website: optionalText(300),
  email: optionalEmail,
  phone: optionalPhone,
  mobile: optionalPhone,
  city: optionalText(100),
  state: optionalText(100),
  postalCode: optionalText(20),
  country: optionalText(100),
  statusId: optionalUuid,
  sourceId: optionalUuid,
  ownerUserId: optionalUuid,
  customFields: z.record(z.string(), z.unknown()).optional(),
};

export const createCompanySchema = z.object({
  ...companyFields,
  /** Link an existing ERP customer right away (validated like the link action). */
  customerId: optionalUuid,
  tagIds: z.array(uuid).max(50).optional(),
  tagNames: z.array(z.string().trim().min(1).max(40)).max(50).optional(),
  addresses: z.array(contactAddressSchema).max(20).optional(),
  confirmDuplicate: z.boolean().optional(),
});
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;

export const updateCompanySchema = z
  .object(companyFields)
  .partial()
  .extend({ version: z.number().int().min(1), confirmDuplicate: z.boolean().optional() })
  .strict();
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;

export const assignCompanySchema = z.object({ ownerUserId: uuid.nullable(), version: z.number().int().min(1).optional() });
export const changeCompanyStatusSchema = z.object({ statusId: uuid, version: z.number().int().min(1).optional() });
export const linkCustomerSchema = z.object({ customerId: uuid, confirmDuplicate: z.boolean().optional() });
export const companyContactLinkSchema = z.object({ contactId: uuid, makePrimary: z.boolean().optional(), moveFromOtherCompany: z.boolean().optional() });
export const primaryContactSchema = z.object({ contactId: uuid.nullable() });
export const companyLeadLinkSchema = z.object({ leadId: uuid });

export const companyDuplicateCheckSchema = z.object({
  name: optionalText(200),
  legalName: optionalText(200),
  website: optionalText(300),
  email: optionalEmail,
  phone: optionalPhone,
  mobile: optionalPhone,
  customerId: optionalUuid,
  excludeCompanyId: optionalUuid,
});

// ── Filtering (shared by the list API, saved views and future Smart Lists) ──

const idList = z.array(uuid).max(100);
const dateRange = z
  .object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })
  .refine((r) => !r.from || !r.to || r.from <= r.to, "'From' must be on or before 'To'.");

/** Same conventions as the lead and contact filters (AND across filters, OR within a list). */
export const companyFilterSchema = z
  .object({
    search: z.string().trim().max(200).optional(),
    ownerUserIds: idList.optional(),
    unassigned: z.boolean().optional(),
    statusIds: idList.optional(),
    sourceIds: idList.optional(),
    tagIds: idList.optional(),
    industry: z.string().trim().max(100).optional(),
    companyType: z.string().trim().max(100).optional(),
    city: z.string().trim().max(100).optional(),
    state: z.string().trim().max(100).optional(),
    country: z.string().trim().max(100).optional(),
    erpCustomer: z.enum(["linked", "not_linked"]).optional(),
    fromLead: z.enum(["yes", "no"]).optional(),
    duplicateFlagged: z.boolean().optional(),
    createdAt: dateRange.optional(),
    updatedAt: dateRange.optional(),
    lastActivityAt: dateRange.optional(),
    archived: z.enum(["exclude", "only", "include"]).default("exclude"),
  })
  .strict();
export type CompanyFilter = z.infer<typeof companyFilterSchema>;

export const COMPANY_SORT_FIELDS = ["createdAt", "updatedAt", "name", "lastActivityAt", "city", "industry"] as const;
export type CompanySortField = (typeof COMPANY_SORT_FIELDS)[number];
export const companySortSchema = z.object({
  sortBy: z.enum(COMPANY_SORT_FIELDS).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

const LIST_KEYS = ["ownerUserIds", "statusIds", "sourceIds", "tagIds"] as const;
const TEXT_KEYS = ["industry", "companyType", "city", "state", "country", "erpCustomer", "fromLead"] as const;
const DATE_KEYS = ["createdAt", "updatedAt", "lastActivityAt"] as const;

/** Flat query string → CompanyFilter (comma lists, `<field>From`/`<field>To`). Unknown params are ignored. */
export function parseCompanyFilterParams(sp: URLSearchParams): CompanyFilter {
  const get = (k: string) => sp.get(k)?.trim() || undefined;
  const list = (k: string) => get(k)?.split(",").map((s) => s.trim()).filter(Boolean);
  const range = (k: string) => (get(`${k}From`) || get(`${k}To`) ? { from: get(`${k}From`), to: get(`${k}To`) } : undefined);
  const raw: Record<string, unknown> = { search: get("search"), archived: get("archived") };
  for (const k of LIST_KEYS) raw[k] = list(k);
  for (const k of TEXT_KEYS) raw[k] = get(k);
  for (const k of DATE_KEYS) raw[k] = range(k);
  if (get("unassigned") === "true") raw.unassigned = true;
  if (get("duplicateFlagged") === "true") raw.duplicateFlagged = true;
  return companyFilterSchema.parse(raw);
}

/** Inverse of parseCompanyFilterParams — a stored filter (saved view) back to query params. */
export function companyFilterToParams(filter: Partial<CompanyFilter>): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (k: string, v: unknown) => {
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) return;
    out[k] = Array.isArray(v) ? v.join(",") : String(v);
  };
  for (const k of LIST_KEYS) put(k, filter[k]);
  for (const k of TEXT_KEYS) put(k, filter[k]);
  if (filter.unassigned) out.unassigned = "true";
  if (filter.duplicateFlagged) out.duplicateFlagged = "true";
  if (filter.archived && filter.archived !== "exclude") out.archived = filter.archived;
  for (const k of DATE_KEYS) {
    put(`${k}From`, filter[k]?.from);
    put(`${k}To`, filter[k]?.to);
  }
  return out;
}

// ── Bulk ──

export const BULK_COMPANY_LIMIT = 500;
const bulkIds = z.array(uuid).min(1).max(BULK_COMPANY_LIMIT);
export const bulkCompanySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assign"), ids: bulkIds, ownerUserId: uuid.nullable() }),
  z.object({ action: z.literal("status"), ids: bulkIds, statusId: uuid }),
  z.object({
    action: z.literal("addTags"),
    ids: bulkIds,
    tagIds: z.array(uuid).max(50).default([]),
    tagNames: z.array(z.string().trim().min(1).max(40)).max(50).default([]),
  }),
  z.object({ action: z.literal("removeTags"), ids: bulkIds, tagIds: z.array(uuid).min(1).max(50) }),
  z.object({ action: z.literal("archive"), ids: bulkIds }),
]);

// ── Merge ──

export const COMPANY_MERGE_FIELDS = [
  "name",
  "legalName",
  "displayName",
  "companyType",
  "industry",
  "website",
  "email",
  "phone",
  "mobile",
  "city",
  "state",
  "postalCode",
  "country",
  "statusId",
  "sourceId",
  "ownerUserId",
  "primaryContactId",
] as const;
export type CompanyMergeField = (typeof COMPANY_MERGE_FIELDS)[number];

export const mergeCompaniesSchema = z
  .object({
    survivorId: uuid,
    mergedId: uuid,
    /**
     * Field → which company's value to keep. Every field where both companies
     * hold different non-empty values must be chosen explicitly — the merge
     * never silently picks one (see conflictingFields).
     */
    fieldChoices: z.partialRecord(z.enum(COMPANY_MERGE_FIELDS), z.enum(["survivor", "merged"])).default({}),
    customFieldChoices: z.record(z.string().max(60), z.enum(["survivor", "merged"])).default({}),
    survivorVersion: z.number().int().min(1),
    mergedVersion: z.number().int().min(1),
  })
  .refine((v) => v.survivorId !== v.mergedId, { message: "A company can't be merged with itself.", path: ["mergedId"] });
export type MergeCompaniesInput = z.infer<typeof mergeCompaniesSchema>;
