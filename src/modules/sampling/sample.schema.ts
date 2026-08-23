import { z } from "zod";

// Mirrors the Prisma SampleType enum. Kept as an explicit list (not derived
// from the Prisma runtime enum) to match this schema file's existing style —
// every other enum-backed field here (source, decision, status) is a plain
// z.enum literal list, not a generated-client import.
export const SAMPLE_TYPES = ["FIT", "PROTO", "PP", "TOP", "SHIPMENT", "PHOTOSHOOT", "SMS", "OTHER"] as const;

export const sampleRequestSchema = z.object({
  customerId: z.string().uuid("Customer is required"),
  buyerId: z.string().uuid().optional().or(z.literal("")),
  productId: z.string().uuid().optional().or(z.literal("")),
  styleName: z.string().min(1, "Style name is required").max(200),
  // Required, no default — a deliberate choice every time, not a fallback
  // like source-of-enquiry-style fields. Immutable after creation (no edit
  // schema exists for it, by design — see the schema.prisma comment).
  sampleType: z.enum(SAMPLE_TYPES),
  color: z.string().max(100).optional().or(z.literal("")),
  requestDate: z.string().min(1, "Request date is required"),
  targetSubmissionDate: z.string().optional().or(z.literal("")),
});

export type SampleRequestInput = z.infer<typeof sampleRequestSchema>;

// Worklist filters for GET /api/v1/sampling. `status` is a raw comma-separated
// string here (querystrings don't carry arrays) — the service splits it and
// intersects against the real SampleStatus enum, so an invalid value is
// silently dropped rather than reaching Prisma.
export const sampleRequestListFiltersSchema = z.object({
  customerId: z.string().uuid().optional(),
  buyerId: z.string().uuid().optional(),
  styleSearch: z.string().max(200).optional(),
  status: z.string().optional(),
  sampleType: z.enum(SAMPLE_TYPES).optional(),
  requestedByUserId: z.string().uuid().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  color: z.string().max(100).optional(),
});

export type SampleRequestListFiltersInput = z.infer<typeof sampleRequestListFiltersSchema>;

// A scoped field-level update, deliberately separate from the (intentionally
// immutable) create schema above — a customer may only decide on / change a
// color well after the request is logged.
export const sampleRequestColorSchema = z.object({
  color: z.string().max(100).optional().or(z.literal("")),
});

export type SampleRequestColorInput = z.infer<typeof sampleRequestColorSchema>;

export const sampleVersionSchema = z.object({
  techPackNotes: z.string().max(4000).optional().or(z.literal("")),
  estimatedCostPerUnit: z.coerce.number().min(0).optional(),
});

export type SampleVersionInput = z.infer<typeof sampleVersionSchema>;

export const sampleMaterialSchema = z.object({
  materialId: z.string().uuid("Material is required"),
  plannedQuantity: z.coerce.number().positive("Quantity must be greater than 0"),
  uomId: z.string().uuid().optional().or(z.literal("")),
  colorId: z.string().uuid().optional().or(z.literal("")),
  // Precise Pantone/shade reference, distinct from the generic Color name —
  // optional, since not every material line needs shade-level precision.
  dyeId: z.string().uuid().optional().or(z.literal("")),
  notes: z.string().max(500).optional().or(z.literal("")),
});

export type SampleMaterialInput = z.infer<typeof sampleMaterialSchema>;

// Scoped to one existing material line — recorded once damage/wastage is
// actually discovered, independent of the line's planned quantity.
export const sampleMaterialDamageSchema = z.object({
  damagedQuantity: z.coerce.number().min(0, "Damaged quantity cannot be negative"),
  damageReason: z.string().max(500).optional().or(z.literal("")),
});

export type SampleMaterialDamageInput = z.infer<typeof sampleMaterialDamageSchema>;

// Scoped to one existing material line, same shape as the damage schema above
// — rate/GST are set/cleared only through this sub-route, never through the
// create/merge payload (sampleMaterialSchema), so a merge can never leave an
// ambiguous "which rate wins" question. `rate: null` explicitly un-prices a
// line (reverts it to "not yet costed", not "priced at zero").
export const sampleMaterialCostingSchema = z.object({
  rate: z.coerce.number().min(0, "Rate cannot be negative").nullable(),
  gstPercentage: z.coerce.number().min(0, "GST% cannot be negative").max(100, "GST% cannot exceed 100").nullable().optional(),
});

export type SampleMaterialCostingInput = z.infer<typeof sampleMaterialCostingSchema>;

export const SAMPLE_OTHER_CHARGE_COST_HEADS = ["PROCESS", "FABRICATION", "OTHER"] as const;

// A flat lump-sum labor/process/overhead cost line — deliberately simpler
// than SampleMaterial (no material FK, no quantity/rate breakdown), since
// these charges are entered as already-final amounts, not tracked consumption.
export const sampleOtherChargeSchema = z.object({
  costHead: z.enum(SAMPLE_OTHER_CHARGE_COST_HEADS),
  description: z.string().min(1, "Description is required").max(200),
  amount: z.coerce.number().min(0, "Amount cannot be negative"),
  notes: z.string().max(500).optional().or(z.literal("")),
});

export type SampleOtherChargeInput = z.infer<typeof sampleOtherChargeSchema>;

// Version-level costing inputs only — costSubtotal/finalTotal are always
// server-computed (recalculateSampleVersionCosting) and are deliberately NOT
// part of this schema, so there is no field name a client could even attempt
// to set them through. estimatedCostPerUnit is included but only honored by
// the service while the version is still in "manual" mode (no priced
// material/charge exists yet) — see sample.service.ts.
export const sampleCostingSchema = z.object({
  marginPercent: z.coerce.number().min(0, "Margin % cannot be negative").optional(),
  commissionPercent: z.coerce.number().min(0, "Commission % cannot be negative").optional(),
  freightAmount: z.coerce.number().min(0, "Freight cannot be negative").optional(),
  estimatedCostPerUnit: z.coerce.number().min(0, "Cost cannot be negative").optional(),
});

export type SampleCostingInput = z.infer<typeof sampleCostingSchema>;

export const sampleApprovalSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED", "REVISION_REQUESTED"]),
  customerContactName: z.string().max(200).optional().or(z.literal("")),
  decisionNotes: z.string().max(2000).optional().or(z.literal("")),
});

export type SampleApprovalInput = z.infer<typeof sampleApprovalSchema>;

export const sampleCommentSchema = z.object({
  sampleVersionId: z.string().uuid().optional().or(z.literal("")),
  body: z.string().min(1, "Comment cannot be empty").max(2000),
});

export type SampleCommentInput = z.infer<typeof sampleCommentSchema>;

export const sampleStatusChangeSchema = z.object({
  // TECH_PACK_READY is intentionally excluded — it's only reachable by actually
  // creating version 1 via POST .../versions, never as a bare status flip.
  status: z.enum(["ON_HOLD", "CANCELLED", "IN_DEVELOPMENT", "INTERNAL_QC", "SUBMITTED_TO_CUSTOMER"]),
});

export type SampleStatusChangeInput = z.infer<typeof sampleStatusChangeSchema>;

export const convertSampleToStyleSchema = z.object({
  styleCode: z.string().min(1, "Style code is required").max(30),
  styleName: z.string().min(1, "Style name is required").max(200),
  categoryId: z.string().uuid().optional().or(z.literal("")),
  seasonId: z.string().uuid().optional().or(z.literal("")),
  gender: z.string().max(50).optional().or(z.literal("")),
  description: z.string().max(2000).optional().or(z.literal("")),
  hsnSacCode: z.string().max(20).optional().or(z.literal("")),
});

export type ConvertSampleToStyleInput = z.infer<typeof convertSampleToStyleSchema>;
