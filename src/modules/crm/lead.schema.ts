import { z } from "zod";
import { optionalPhoneSchema } from "@/lib/validation";

export const CRM_BUSINESS_TYPES = [
  "BRAND",
  "RETAILER",
  "WHOLESALER",
  "IMPORTER",
  "BUYING_HOUSE",
  "BUYING_AGENT",
  "DESIGNER",
  "ECOMMERCE_BRAND",
  "DEPARTMENT_STORE",
  "DISTRIBUTOR",
  "MANUFACTURER",
  "OTHER",
] as const;

export const CRM_LEAD_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

const optionalText = (max: number) => z.string().max(max).optional().or(z.literal(""));
const optionalUuid = z.string().uuid().optional().or(z.literal(""));
/** Accepts a number, a numeric string, or blank (→ undefined). */
const optionalNumber = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? undefined : v),
  z.coerce.number().min(0).optional()
);

export const createLeadSchema = z.object({
  // General
  name: z.string().min(1, "Contact person is required").max(150),
  companyName: optionalText(190),
  designation: optionalText(100),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: optionalPhoneSchema,
  whatsappNumber: optionalPhoneSchema,
  alternativePhone: optionalPhoneSchema,
  website: optionalText(255),
  // Business
  businessType: z.enum(CRM_BUSINESS_TYPES).optional().or(z.literal("")),
  country: optionalText(100),
  state: optionalText(100),
  city: optionalText(100),
  address: optionalText(500),
  // Garment business
  productCategoryId: optionalUuid,
  productInterestTypeIds: z.array(z.string().uuid()).max(50).optional(),
  seasonId: optionalUuid,
  market: optionalText(100),
  expectedQuantity: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : v),
    z.coerce.number().int().min(0).optional()
  ),
  targetPrice: optionalNumber,
  currencyCode: z.string().length(3).optional().or(z.literal("")),
  moqRequirement: optionalText(190),
  requiredDeliveryDate: z.string().optional().or(z.literal("")),
  samplingRequired: z.boolean().optional(),
  techPackAvailable: z.boolean().optional(),
  referenceImageAvailable: z.boolean().optional(),
  // Sales
  sourceId: optionalUuid,
  campaignId: optionalUuid,
  campaignText: optionalText(190),
  priority: z.enum(CRM_LEAD_PRIORITIES).optional(),
  leadScore: z.coerce.number().min(0).max(100).default(0),
  value: z.coerce.number().min(0).default(0),
  expectedCloseDate: z.string().optional().or(z.literal("")),
  assignedToUserId: optionalUuid,
  notes: optionalText(2000),
  // Set only on a deliberate resubmit after the user has seen and
  // acknowledged the duplicate warning — mirrors Material Request's pattern.
  overrideDuplicateCheck: z.boolean().optional(),
});
export type CreateLeadInput = z.infer<typeof createLeadSchema>;

/** Stage is deliberately NOT editable through the ordinary update — every
 * stage move goes through changeLeadStage() so it is always recorded in
 * CrmStageHistory and Won/Lost rules are always enforced. */
export const updateLeadSchema = createLeadSchema;
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;

export const changeLeadStageSchema = z.object({
  stageId: z.string().uuid(),
  comment: optionalText(2000),
  // Required when the target stage's kind is LOST (enforced in the service,
  // since only the service knows the target stage's kind).
  lostReasonId: optionalUuid,
  lostCompetitor: optionalText(190),
  lostComment: optionalText(2000),
  lostCanRevisit: z.boolean().optional(),
  nextFollowupAt: z.string().optional().or(z.literal("")),
});
export type ChangeLeadStageInput = z.infer<typeof changeLeadStageSchema>;
