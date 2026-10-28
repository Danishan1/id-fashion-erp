import { z } from "zod";
import { buyerEnquirySchema } from "@/modules/buyer-enquiries/buyer-enquiry.schema";
import {
  ENQUIRY_SOURCE_KEYS,
  MANUAL_ACTIVITY_TYPES,
  MANUAL_STAGE_TARGETS,
  SALES_ENQUIRY_PRIORITY_KEYS,
  SALES_ENQUIRY_SORT_FIELDS,
  SALES_ENQUIRY_STAGE_KEYS,
} from "./sales-enquiry-registry";

const optionalUuid = z.string().uuid().optional().or(z.literal(""));
const optionalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date")
  .optional()
  .or(z.literal(""));
const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

/** Sales-side fields shared by create and edit. Every one is optional (spec §5.4: never force what isn't relevant). */
const salesFields = {
  subject: optionalText(200),
  priority: z.enum(SALES_ENQUIRY_PRIORITY_KEYS).optional(),
  nextFollowUpDate: optionalDate,
  crmCompanyId: optionalUuid,
  crmContactId: optionalUuid,
};

/**
 * Create = the Buyer Enquiry create payload (customer or prospect, source,
 * lines with style/qty/target price/delivery) plus the sales fields. Owner
 * defaults to the creator when left empty.
 */
export const salesEnquiryCreateSchema = buyerEnquirySchema.extend({
  ...salesFields,
  ownerUserId: optionalUuid,
});
export type SalesEnquiryCreateInput = z.infer<typeof salesEnquiryCreateSchema>;

/** Edit of the sales details. Absent keys are left unchanged; "" clears a value. Owner has its own action. */
export const salesEnquiryUpdateSchema = z
  .object({
    ...salesFields,
    // "" / null clear it. The literal must come first — z.coerce.number() turns "" into 0.
    estimatedValue: z.union([z.literal(""), z.null(), z.coerce.number().min(0).max(9999999999999)]).optional(),
    expectedDecisionDate: optionalDate,
    nextAction: optionalText(500),
    qualificationNotes: optionalText(4000),
    remarks: optionalText(2000),
  })
  .strict();
export type SalesEnquiryUpdateInput = z.infer<typeof salesEnquiryUpdateSchema>;

export const salesEnquiryStageChangeSchema = z.object({
  stage: z.enum(MANUAL_STAGE_TARGETS),
  reason: optionalText(1000),
});
export type SalesEnquiryStageChangeInput = z.infer<typeof salesEnquiryStageChangeSchema>;

export const salesEnquiryReopenSchema = z.object({
  reason: z.string().trim().min(3, "Say why this enquiry is being reopened").max(1000),
});

export const salesEnquiryAssignSchema = z.object({
  // null / "" = unassign.
  ownerUserId: z.string().uuid().nullable().or(z.literal("")),
});

export const salesEnquiryActivitySchema = z.object({
  type: z.enum(MANUAL_ACTIVITY_TYPES),
  body: z.string().trim().min(1, "Write something").max(4000),
  // When the interaction happened (defaults to now). Not in the future.
  occurredAt: z.string().datetime({ offset: true }).optional().or(z.literal("")),
});
export type SalesEnquiryActivityInput = z.infer<typeof salesEnquiryActivitySchema>;

export const salesEnquiryOpportunityLinkSchema = z.object({ opportunityId: z.string().uuid() });

/** List filters (query string). Comma lists for stage/priority/source. */
export const salesEnquiryListFilterSchema = z.object({
  stage: z.string().optional(),
  priority: z.string().optional(),
  source: z.string().optional(),
  // "me" | "unassigned" | a user id
  owner: z.string().optional(),
  overdue: z.enum(["1", "true"]).optional(),
  dateFrom: optionalDate,
  dateTo: optionalDate,
  crmCompanyId: optionalUuid,
  customerId: optionalUuid,
  // "open" (default view) | "closed" | "all"
  view: z.enum(["open", "closed", "all"]).optional(),
});
export type SalesEnquiryListFilter = z.infer<typeof salesEnquiryListFilterSchema>;

export const salesEnquirySortSchema = z.object({
  sortBy: z.enum(SALES_ENQUIRY_SORT_FIELDS).default("enquiryDate"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

/** Splits a comma list and keeps only known values (never trusts the raw string). */
export function parseEnumList<T extends string>(raw: string | undefined, allowed: readonly T[]): T[] {
  if (!raw) return [];
  const set = new Set<string>(allowed);
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter((v): v is T => set.has(v));
}

export const STAGE_KEYS = SALES_ENQUIRY_STAGE_KEYS;
export const SOURCE_KEYS = ENQUIRY_SOURCE_KEYS;
