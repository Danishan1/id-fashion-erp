import { z } from "zod";
import { SAMPLE_TYPES } from "@/modules/sampling/sample.schema";
import { optionalPhoneSchema } from "@/lib/validation";

export const buyerEnquiryLineSchema = z.object({
  // An existing Style, if picked from the catalog — leave empty for a
  // brand-new ask that isn't a real Style yet (mirrors SampleRequest's own
  // nullable productId + free-text styleName precedent).
  productId: z.string().uuid().optional().or(z.literal("")),
  styleNameFreeText: z.string().max(200).optional().or(z.literal("")),
  description: z.string().max(2000).optional().or(z.literal("")),
  colorRemarks: z.string().max(200).optional().or(z.literal("")),
  // A real Size master FK, unlike colorRemarks above — see the schema.prisma
  // comment on BuyerEnquiryLine.sizeId.
  sizeId: z.string().uuid().optional().or(z.literal("")),
  targetQuantity: z.coerce.number().positive().optional(),
  targetUnitPrice: z.coerce.number().min(0).optional(),
  targetDeliveryDate: z.string().optional().or(z.literal("")),
  remarks: z.string().max(2000).optional().or(z.literal("")),
});

export type BuyerEnquiryLineInput = z.infer<typeof buyerEnquiryLineSchema>;

// Either a real customerId, or the prospect fields — validated together in
// the service layer (a prospect-only enquiry is legal to create, just not
// legal to convert from later) rather than here, since Zod can't cleanly
// express "at least a name is required when customerId is absent" alongside
// every other optional field without a much messier refine().
export const buyerEnquirySchema = z.object({
  customerId: z.string().uuid().optional().or(z.literal("")),
  buyerId: z.string().uuid().optional().or(z.literal("")),
  prospectName: z.string().max(200).optional().or(z.literal("")),
  prospectContactPerson: z.string().max(200).optional().or(z.literal("")),
  prospectEmail: z.string().email().optional().or(z.literal("")),
  prospectPhone: optionalPhoneSchema,
  prospectCountry: z.string().max(100).optional().or(z.literal("")),
  enquiryDate: z.string().min(1, "Enquiry date is required"),
  source: z.enum(["EMAIL", "PHONE", "TRADE_SHOW", "REFERRAL", "WEBSITE", "OTHER"]).default("OTHER"),
  remarks: z.string().max(2000).optional().or(z.literal("")),
  lines: z.array(buyerEnquiryLineSchema).min(1, "At least one line is required"),
});

export type BuyerEnquiryInput = z.infer<typeof buyerEnquirySchema>;

// CONVERTED is deliberately excluded — reachable only through the dedicated
// convert action, never this generic endpoint (see the schema comment on
// BuyerEnquiryLineStatus in schema.prisma).
export const buyerEnquiryLineStatusChangeSchema = z.object({
  lineStatus: z.enum(["PENDING_REVIEW", "APPROVED_FOR_SAMPLING", "ON_HOLD", "REJECTED"]),
  rejectionReason: z.string().max(500).optional().or(z.literal("")),
});

export type BuyerEnquiryLineStatusChangeInput = z.infer<typeof buyerEnquiryLineStatusChangeSchema>;

// Pre-fills the created Sample Request from the line's own fields — a
// merchandiser reviews/edits before submitting, exactly like Convert-to-Style
// pre-fills its form rather than silently copying without a review step.
export const convertEnquiryLineSchema = z.object({
  styleName: z.string().min(1, "Style name is required").max(200),
  // Required, same as direct Sample Request creation — sampleType is always
  // a deliberate choice, conversion is not exempt from that.
  sampleType: z.enum(SAMPLE_TYPES),
  color: z.string().max(100).optional().or(z.literal("")),
  // Real Size master FK, pre-filled from the line's own sizeId but still
  // editable at conversion time (2026-09-24) — the created Sample Request's
  // own sizeId is set from this directly, since (unlike color above) it's
  // always a real, unambiguous match against the same company's Size master.
  sizeId: z.string().uuid().optional().or(z.literal("")),
  targetSubmissionDate: z.string().optional().or(z.literal("")),
});

export type ConvertEnquiryLineInput = z.infer<typeof convertEnquiryLineSchema>;

// Promotes a still-prospect enquiry to a real Customer link — the one piece
// the create form's own "Convert to Style / conversion requires a real
// Customer" warning never actually had an action behind (2026-09-04).
export const linkCustomerToEnquirySchema = z.object({
  customerId: z.string().uuid("A real Customer is required"),
  buyerId: z.string().uuid().optional().or(z.literal("")),
});

export type LinkCustomerToEnquiryInput = z.infer<typeof linkCustomerToEnquirySchema>;
