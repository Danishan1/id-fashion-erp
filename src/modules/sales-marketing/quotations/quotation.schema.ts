import { z } from "zod";
import { GST_STATE_CODES } from "@/lib/gst";
import { MAX_QUOTATION_LINES, QUOTATION_SORT_FIELDS } from "./quotation-registry";

const optionalUuid = z.string().uuid().optional().or(z.literal(""));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");
const optionalDate = isoDate.optional().or(z.literal(""));
const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));
const money = z.coerce.number().min(0, "Can't be negative").max(9_999_999_999, "Too large");

export const quotationLineSchema = z.object({
  productId: optionalUuid,
  sampleRequestId: optionalUuid,
  buyerEnquiryLineId: optionalUuid,
  description: z.string().trim().min(1, "Describe the item").max(1000),
  colorSizeRemarks: optionalText(300),
  customerReference: optionalText(200),
  quantity: z.coerce
    .number()
    .positive("Quantity must be more than 0")
    .max(99_999_999)
    .refine((v) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6, "Up to 3 decimals"),
  uomId: optionalUuid,
  unitPrice: money,
  discountPercent: z.coerce.number().min(0, "0–100").max(100, "0–100").default(0),
  taxRateId: optionalUuid,
  requestedDeliveryDate: optionalDate,
  notes: optionalText(1000),
});
export type QuotationLineInput = z.infer<typeof quotationLineSchema>;

const quotationBody = {
  customerId: optionalUuid,
  buyerId: optionalUuid,
  prospectName: optionalText(200),
  crmCompanyId: optionalUuid,
  crmContactId: optionalUuid,
  ownerUserId: optionalUuid,
  title: z.string().trim().min(1, "Give the quotation a title").max(200),
  quotationDate: isoDate,
  validUntil: isoDate,
  placeOfSupplyStateCode: z
    .string()
    .refine((v) => v === "" || Boolean(GST_STATE_CODES[v]), "Unknown GST state code")
    .optional(),
  billingAddress: optionalText(1000),
  shippingAddress: optionalText(1000),
  paymentTermsDays: z.union([z.literal(""), z.null(), z.coerce.number().int().min(0).max(365)]).optional(),
  deliveryTerms: optionalText(1000),
  introduction: optionalText(4000),
  customerNotes: optionalText(4000),
  internalNotes: optionalText(4000),
  termsAndConditions: optionalText(10000),
  freightAmount: money.default(0),
  freightTaxRateId: optionalUuid,
  otherChargesLabel: optionalText(100),
  otherChargesAmount: money.default(0),
  otherChargesTaxRateId: optionalUuid,
  lines: z.array(quotationLineSchema).min(1, "Add at least one line").max(MAX_QUOTATION_LINES),
};

function checkDates<T extends { quotationDate: string; validUntil: string }>(v: T, ctx: z.RefinementCtx) {
  if (v.validUntil < v.quotationDate) ctx.addIssue({ code: "custom", path: ["validUntil"], message: "Valid-until can't be before the quotation date" });
}

export const quotationCreateSchema = z
  .object({ ...quotationBody, buyerEnquiryId: optionalUuid })
  .strict()
  .superRefine(checkDates);
export type QuotationCreateInput = z.infer<typeof quotationCreateSchema>;

/** Draft save: the whole draft is sent again (lines replace the old ones). `version` is the one the editor loaded. */
export const quotationUpdateSchema = z
  .object({ ...quotationBody, version: z.number().int().min(1) })
  .strict()
  .superRefine(checkDates);
export type QuotationUpdateInput = z.infer<typeof quotationUpdateSchema>;

export const quotationCancelSchema = z.object({ reason: z.string().trim().min(3, "Say why it is cancelled").max(1000) });

export const quotationListFilterSchema = z.object({
  status: z.string().optional(),
  owner: z.string().optional(),
  customerId: optionalUuid,
  buyerEnquiryId: optionalUuid,
  view: z.enum(["open", "closed", "all"]).optional(),
});
export type QuotationListFilter = z.infer<typeof quotationListFilterSchema>;

export const quotationSortSchema = z.object({
  sortBy: z.enum(QUOTATION_SORT_FIELDS).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});
