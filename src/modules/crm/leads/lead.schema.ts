import { z } from "zod";

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
const optionalDateTime = z
  .string()
  .trim()
  .optional()
  .or(z.literal(""))
  .nullable()
  .refine((v) => !v || !Number.isNaN(Date.parse(v)), "Enter a valid date and time");

/** Fields shared by create and update. Blank strings mean "clear this field". */
const leadFields = {
  firstName: z.string().trim().min(1, "First name is required").max(100),
  lastName: optionalText(100),
  companyName: optionalText(200),
  designation: optionalText(100),
  crmCompanyId: optionalUuid,
  crmContactId: optionalUuid,
  email: optionalEmail,
  alternateEmail: optionalEmail,
  phone: optionalPhone,
  mobile: optionalPhone,
  whatsapp: optionalPhone,
  statusId: optionalUuid,
  sourceId: optionalUuid,
  ownerUserId: optionalUuid,
  score: z.coerce.number().int().min(0).max(100).optional().nullable(),
  temperature: z.enum(["COLD", "WARM", "HOT"]).optional().or(z.literal("")).nullable(),
  industry: optionalText(100),
  city: optionalText(100),
  state: optionalText(100),
  country: optionalText(100),
  requirement: optionalText(5000),
  estimatedValue: z.coerce.number().min(0, "Must be zero or more").max(9_999_999_999_999).optional().nullable(),
  currencyCode: z.string().trim().length(3).toUpperCase().optional().or(z.literal("")).nullable(),
  utmSource: optionalText(200),
  utmMedium: optionalText(200),
  utmCampaign: optionalText(200),
  utmTerm: optionalText(200),
  utmContent: optionalText(200),
  campaignSource: optionalText(200),
  referralSource: optionalText(200),
  lastContactedAt: optionalDateTime,
  nextFollowUpAt: optionalDateTime,
  customFields: z.record(z.string(), z.unknown()).optional(),
};

export const createLeadSchema = z.object({
  ...leadFields,
  tagIds: z.array(z.string().uuid()).max(50).optional(),
  tagNames: z.array(z.string().trim().min(1).max(40)).max(50).optional(),
  /** Set after the user has seen and accepted a "possible duplicate" warning. */
  confirmDuplicate: z.boolean().optional(),
});
export type CreateLeadInput = z.infer<typeof createLeadSchema>;

/** Partial update; `version` is the optimistic-locking token from the last read. */
export const updateLeadSchema = z
  .object(leadFields)
  .partial()
  .extend({ version: z.number().int().min(1), confirmDuplicate: z.boolean().optional() })
  .strict();
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;


export const changeLeadStatusSchema = z.object({ statusId: z.string().uuid(), version: z.number().int().min(1).optional() });
export const assignLeadSchema = z.object({ ownerUserId: z.string().uuid().nullable(), version: z.number().int().min(1).optional() });

export const duplicateCheckSchema = z.object({
  email: optionalEmail,
  alternateEmail: optionalEmail,
  phone: optionalPhone,
  mobile: optionalPhone,
  whatsapp: optionalPhone,
  companyName: optionalText(200),
  excludeLeadId: optionalUuid,
});
export type DuplicateCheckInput = z.infer<typeof duplicateCheckSchema>;

// ── Filtering (shared by the list API, saved views and future Smart Lists) ──

const idList = z.array(z.string().uuid()).max(100);
const dateRange = z
  .object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })
  .refine((r) => !r.from || !r.to || r.from <= r.to, "'From' must be on or before 'To'.");
const numberRange = z
  .object({ min: z.number().optional(), max: z.number().optional() })
  .refine((r) => r.min === undefined || r.max === undefined || r.min <= r.max, "'Min' must not exceed 'Max'.");

/**
 * Every lead filter is AND-combined; list filters (statusIds…) are OR within
 * themselves. This object is what a saved view stores, so Smart Lists can wrap
 * it in AND/OR groups later without changing its shape.
 */
export const leadFilterSchema = z
  .object({
    search: z.string().trim().max(200).optional(),
    statusIds: idList.optional(),
    statusKinds: z.array(z.enum(["OPEN", "CONVERTED", "LOST"])).optional(),
    sourceIds: idList.optional(),
    captureChannels: z.array(z.enum(["MANUAL", "CSV", "XLSX", "WEBSITE_FORM", "API", "WEBHOOK", "INTEGRATION"])).optional(),
    importJobId: z.string().uuid().optional(),
    ownerUserIds: idList.optional(),
    unassigned: z.boolean().optional(),
    temperatures: z.array(z.enum(["COLD", "WARM", "HOT"])).optional(),
    tagIds: idList.optional(),
    crmCompanyId: z.string().uuid().optional(),
    crmContactId: z.string().uuid().optional(),
    companyName: z.string().trim().max(200).optional(),
    industry: z.string().trim().max(100).optional(),
    location: z.string().trim().max(100).optional(),
    campaignSource: z.string().trim().max(200).optional(),
    referralSource: z.string().trim().max(200).optional(),
    score: numberRange.optional(),
    estimatedValue: numberRange.optional(),
    createdAt: dateRange.optional(),
    updatedAt: dateRange.optional(),
    lastContactedAt: dateRange.optional(),
    nextFollowUpAt: dateRange.optional(),
    archived: z.enum(["exclude", "only", "include"]).default("exclude"),
  })
  .strict();
export type LeadFilter = z.infer<typeof leadFilterSchema>;

export const LEAD_SORT_FIELDS = [
  "createdAt",
  "updatedAt",
  "fullName",
  "leadNumber",
  "score",
  "estimatedValue",
  "lastContactedAt",
  "nextFollowUpAt",
] as const;
export type LeadSortField = (typeof LEAD_SORT_FIELDS)[number];

/**
 * Reads the list API's flat query string into a LeadFilter:
 * comma-separated id lists (`statusIds=a,b`), `<field>From`/`<field>To` for
 * dates, `<field>Min`/`<field>Max` for numbers. Unknown params are ignored.
 */
export function parseLeadFilterParams(sp: URLSearchParams): LeadFilter {
  const get = (k: string) => sp.get(k)?.trim() || undefined;
  const list = (k: string) => get(k)?.split(",").map((s) => s.trim()).filter(Boolean);
  const num = (k: string) => {
    const v = get(k);
    return v === undefined ? undefined : Number(v);
  };
  const range = (k: string) => (get(`${k}From`) || get(`${k}To`) ? { from: get(`${k}From`), to: get(`${k}To`) } : undefined);
  const nrange = (k: string) => (get(`${k}Min`) || get(`${k}Max`) ? { min: num(`${k}Min`), max: num(`${k}Max`) } : undefined);
  return leadFilterSchema.parse({
    search: get("search"),
    statusIds: list("statusIds"),
    statusKinds: list("statusKinds"),
    sourceIds: list("sourceIds"),
    captureChannels: list("captureChannels"),
    importJobId: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(get("importJobId") ?? "") ? get("importJobId") : undefined,

    ownerUserIds: list("ownerUserIds"),
    unassigned: get("unassigned") === "true" ? true : undefined,
    temperatures: list("temperatures"),
    tagIds: list("tagIds"),
    crmCompanyId: get("crmCompanyId"),
    crmContactId: get("crmContactId"),
    companyName: get("companyName"),
    industry: get("industry"),
    location: get("location"),
    campaignSource: get("campaignSource"),
    referralSource: get("referralSource"),
    score: nrange("score"),
    estimatedValue: nrange("estimatedValue"),
    createdAt: range("createdAt"),
    updatedAt: range("updatedAt"),
    lastContactedAt: range("lastContactedAt"),
    nextFollowUpAt: range("nextFollowUpAt"),
    archived: get("archived"),
  });
}

export const leadSortSchema = z.object({
  sortBy: z.enum(LEAD_SORT_FIELDS).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

// ── Bulk ──

export const BULK_LEAD_LIMIT = 500;
export const bulkLeadSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assign"), ids: z.array(z.string().uuid()).min(1).max(BULK_LEAD_LIMIT), ownerUserId: z.string().uuid().nullable() }),
  z.object({ action: z.literal("status"), ids: z.array(z.string().uuid()).min(1).max(BULK_LEAD_LIMIT), statusId: z.string().uuid() }),
  z.object({
    action: z.literal("addTags"),
    ids: z.array(z.string().uuid()).min(1).max(BULK_LEAD_LIMIT),
    tagIds: z.array(z.string().uuid()).max(50).default([]),
    tagNames: z.array(z.string().trim().min(1).max(40)).max(50).default([]),
  }),
  z.object({ action: z.literal("removeTags"), ids: z.array(z.string().uuid()).min(1).max(BULK_LEAD_LIMIT), tagIds: z.array(z.string().uuid()).min(1).max(50) }),
  z.object({ action: z.literal("archive"), ids: z.array(z.string().uuid()).min(1).max(BULK_LEAD_LIMIT) }),
]);
export type BulkLeadInput = z.infer<typeof bulkLeadSchema>;

// ── Conversion / opportunity ──

export const createOpportunityFromLeadSchema = z.object({
  name: z.string().trim().min(1, "Opportunity name is required").max(200),
  amount: z.coerce.number().min(0).max(9_999_999_999_999).optional().nullable(),
  currencyCode: z.string().trim().length(3).toUpperCase().optional().or(z.literal("")).nullable(),
  expectedCloseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date").optional().or(z.literal("")).nullable(),
  description: optionalText(5000),
});
export type CreateOpportunityFromLeadInput = z.infer<typeof createOpportunityFromLeadSchema>;

export const convertLeadSchema = z
  .object({
    company: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("none") }),
      z.object({ mode: z.literal("link"), id: z.string().uuid() }),
      z.object({ mode: z.literal("create"), name: z.string().trim().min(1, "Company name is required").max(200), allowDuplicate: z.boolean().optional() }),
    ]),
    contact: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("none") }),
      z.object({ mode: z.literal("link"), id: z.string().uuid() }),
      z.object({ mode: z.literal("create"), allowDuplicate: z.boolean().optional() }),
    ]),
    opportunity: createOpportunityFromLeadSchema.extend({ create: z.literal(true) }).or(z.object({ create: z.literal(false) })),
    version: z.number().int().min(1).optional(),
  })
  .refine((v) => v.company.mode !== "none" || v.contact.mode !== "none", {
    message: "Choose at least a contact or a company to convert into.",
    path: ["contact"],
  });
export type ConvertLeadInput = z.infer<typeof convertLeadSchema>;

/** Inverse of parseLeadFilterParams — turns a stored filter (saved view) back into flat query params. */
export function leadFilterToParams(filter: Partial<LeadFilter>): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (k: string, v: unknown) => {
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) return;
    out[k] = Array.isArray(v) ? v.join(",") : String(v);
  };
  for (const k of ["statusIds", "statusKinds", "sourceIds", "captureChannels", "ownerUserIds", "temperatures", "tagIds"] as const) put(k, filter[k]);
  for (const k of ["crmCompanyId", "crmContactId", "importJobId", "companyName", "industry", "location", "campaignSource", "referralSource"] as const) put(k, filter[k]);

  if (filter.unassigned) out.unassigned = "true";
  if (filter.archived && filter.archived !== "exclude") out.archived = filter.archived;
  for (const k of ["score", "estimatedValue"] as const) {
    put(`${k}Min`, filter[k]?.min);
    put(`${k}Max`, filter[k]?.max);
  }
  for (const k of ["createdAt", "updatedAt", "lastContactedAt", "nextFollowUpAt"] as const) {
    put(`${k}From`, filter[k]?.from);
    put(`${k}To`, filter[k]?.to);
  }
  return out;
}
