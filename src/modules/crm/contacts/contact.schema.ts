import { z } from "zod";
import {
  ADDRESS_TYPE_KEYS,
  CONTACT_CHANNEL_TYPE_KEYS,
  CONTACTABILITY_CHANNEL_KEYS,
  CONTACTABILITY_STATUS_KEYS,
  USER_CONTACTABILITY_SOURCES,
} from "./contact-registry";

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

// ── Sub-records ──

export const contactAddressSchema = z.object({
  addressType: z.enum(ADDRESS_TYPE_KEYS).default("OFFICE"),
  label: optionalText(80),
  line1: z.string().trim().min(1, "Address line 1 is required").max(200),
  line2: optionalText(200),
  city: optionalText(100),
  state: optionalText(100),
  postalCode: optionalText(20),
  country: optionalText(100),
  isPrimary: z.boolean().optional(),
});
export type ContactAddressInput = z.infer<typeof contactAddressSchema>;
export const updateContactAddressSchema = contactAddressSchema.partial();

export const contactChannelSchema = z.object({
  channelType: z.enum(CONTACT_CHANNEL_TYPE_KEYS),
  value: z.string().trim().min(1, "Enter a value").max(300),
  label: optionalText(60),
});
export type ContactChannelInput = z.infer<typeof contactChannelSchema>;

export const contactabilityChangeSchema = z.object({
  channel: z.enum(CONTACTABILITY_CHANNEL_KEYS),
  status: z.enum(CONTACTABILITY_STATUS_KEYS),
  reason: optionalText(500),
  source: z.enum(USER_CONTACTABILITY_SOURCES).default("MANUAL"),
});
export type ContactabilityChange = z.infer<typeof contactabilityChangeSchema>;

// ── Contact ──

/** Fields shared by create and update. Blank strings mean "clear this field". */
const contactFields = {
  firstName: z.string().trim().min(1, "First name is required").max(100),
  middleName: optionalText(100),
  lastName: optionalText(100),
  designation: optionalText(100),
  department: optionalText(100),
  relationshipRole: optionalText(100),
  email: optionalEmail,
  alternateEmail: optionalEmail,
  phone: optionalPhone,
  mobile: optionalPhone,
  whatsapp: optionalPhone,
  crmCompanyId: optionalUuid,
  sourceId: optionalUuid,
  ownerUserId: optionalUuid,
  /**
   * Soft link to a specific Buyer under the linked company's ERP Customer
   * (CRM Replacement, 2026-10-09) — optional, never enforced to belong to
   * that same customer at the schema layer (same convention as
   * `CrmCompany.customerId` itself); the service checks it belongs to this
   * company before saving.
   */
  buyerId: optionalUuid,
  customFields: z.record(z.string(), z.unknown()).optional(),
};

export const createContactSchema = z.object({
  ...contactFields,
  /**
   * Pick an ERP Customer as the company: the CRM company that references it
   * is reused, or created (name only — no customer data is copied).
   */
  customerId: optionalUuid,
  tagIds: z.array(uuid).max(50).optional(),
  tagNames: z.array(z.string().trim().min(1).max(40)).max(50).optional(),
  addresses: z.array(contactAddressSchema).max(20).optional(),
  channels: z.array(contactChannelSchema).max(30).optional(),
  /** Set after the user has seen and accepted a "possible duplicate" warning. */
  confirmDuplicate: z.boolean().optional(),
});
export type CreateContactInput = z.infer<typeof createContactSchema>;

export const updateContactSchema = z
  .object(contactFields)
  .partial()
  .extend({ customerId: optionalUuid, version: z.number().int().min(1), confirmDuplicate: z.boolean().optional() })
  .strict();
export type UpdateContactInput = z.infer<typeof updateContactSchema>;

export const assignContactSchema = z.object({ ownerUserId: uuid.nullable(), version: z.number().int().min(1).optional() });

export const contactDuplicateCheckSchema = z.object({
  firstName: optionalText(100),
  middleName: optionalText(100),
  lastName: optionalText(100),
  email: optionalEmail,
  alternateEmail: optionalEmail,
  phone: optionalPhone,
  mobile: optionalPhone,
  whatsapp: optionalPhone,
  crmCompanyId: optionalUuid,
  excludeContactId: optionalUuid,
});

// ── Filtering (shared by the list API, saved views and future Smart Lists) ──

const idList = z.array(uuid).max(100);
const dateRange = z
  .object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })
  .refine((r) => !r.from || !r.to || r.from <= r.to, "'From' must be on or before 'To'.");

/**
 * Same conventions as the lead filter (AND across filters, OR within a
 * list) so Smart Lists (Phase 13) treat both entities the same way.
 */
export const contactFilterSchema = z
  .object({
    search: z.string().trim().max(200).optional(),
    ownerUserIds: idList.optional(),
    unassigned: z.boolean().optional(),
    sourceIds: idList.optional(),
    tagIds: idList.optional(),
    crmCompanyId: uuid.optional(),
    companyName: z.string().trim().max(200).optional(),
    designation: z.string().trim().max(100).optional(),
    department: z.string().trim().max(100).optional(),
    location: z.string().trim().max(100).optional(),
    /** Contactability: contacts NOT contactable on this channel (ALL = contact-wide DND). */
    dndChannels: z.array(z.enum(CONTACTABILITY_CHANNEL_KEYS)).optional(),
    hasEmail: z.enum(["yes", "no"]).optional(),
    hasPhone: z.enum(["yes", "no"]).optional(),
    erpCustomer: z.enum(["linked", "not_linked"]).optional(),
    fromLead: z.enum(["yes", "no"]).optional(),
    duplicateFlagged: z.boolean().optional(),
    createdAt: dateRange.optional(),
    updatedAt: dateRange.optional(),
    lastActivityAt: dateRange.optional(),
    archived: z.enum(["exclude", "only", "include"]).default("exclude"),
  })
  .strict();
export type ContactFilter = z.infer<typeof contactFilterSchema>;

export const CONTACT_SORT_FIELDS = ["createdAt", "updatedAt", "fullName", "lastActivityAt", "companyName"] as const;
export type ContactSortField = (typeof CONTACT_SORT_FIELDS)[number];
export const contactSortSchema = z.object({
  sortBy: z.enum(CONTACT_SORT_FIELDS).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

const LIST_KEYS = ["ownerUserIds", "sourceIds", "tagIds", "dndChannels"] as const;
const TEXT_KEYS = ["crmCompanyId", "companyName", "designation", "department", "location", "hasEmail", "hasPhone", "erpCustomer", "fromLead"] as const;
const DATE_KEYS = ["createdAt", "updatedAt", "lastActivityAt"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Flat query string → ContactFilter (comma lists, `<field>From`/`<field>To`). Unknown params are ignored. */
export function parseContactFilterParams(sp: URLSearchParams): ContactFilter {
  const get = (k: string) => sp.get(k)?.trim() || undefined;
  const list = (k: string) => get(k)?.split(",").map((s) => s.trim()).filter(Boolean);
  const range = (k: string) => (get(`${k}From`) || get(`${k}To`) ? { from: get(`${k}From`), to: get(`${k}To`) } : undefined);
  const raw: Record<string, unknown> = { search: get("search"), archived: get("archived") };
  for (const k of LIST_KEYS) raw[k] = list(k);
  for (const k of TEXT_KEYS) raw[k] = get(k);
  if (raw.crmCompanyId && !UUID_RE.test(String(raw.crmCompanyId))) raw.crmCompanyId = undefined;
  for (const k of DATE_KEYS) raw[k] = range(k);
  if (get("unassigned") === "true") raw.unassigned = true;
  if (get("duplicateFlagged") === "true") raw.duplicateFlagged = true;
  return contactFilterSchema.parse(raw);
}

/** Inverse of parseContactFilterParams — a stored filter (saved view) back to query params. */
export function contactFilterToParams(filter: Partial<ContactFilter>): Record<string, string> {
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

export const BULK_CONTACT_LIMIT = 500;
const bulkIds = z.array(uuid).min(1).max(BULK_CONTACT_LIMIT);
export const bulkContactSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assign"), ids: bulkIds, ownerUserId: uuid.nullable() }),
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

/** Scalar fields the user chooses between when merging (anything else follows the rules in contact-merge.service). */
export const MERGE_FIELDS = [
  "firstName",
  "middleName",
  "lastName",
  "designation",
  "department",
  "relationshipRole",
  "email",
  "alternateEmail",
  "phone",
  "mobile",
  "whatsapp",
  "crmCompanyId",
  "sourceId",
  "ownerUserId",
] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];

export const mergeContactsSchema = z
  .object({
    survivorId: uuid,
    mergedId: uuid,
    /** Field → which contact's value to keep. Fields left out keep the survivor's value (or the other one's when the survivor's is empty). */
    fieldChoices: z.partialRecord(z.enum(MERGE_FIELDS), z.enum(["survivor", "merged"])).default({}),
    /** Custom-field key → which contact's value to keep (same default rule). */
    customFieldChoices: z.record(z.string().max(60), z.enum(["survivor", "merged"])).default({}),
    survivorVersion: z.number().int().min(1),
    mergedVersion: z.number().int().min(1),
  })
  .refine((v) => v.survivorId !== v.mergedId, { message: "A contact can't be merged with itself.", path: ["mergedId"] });
export type MergeContactsInput = z.infer<typeof mergeContactsSchema>;
