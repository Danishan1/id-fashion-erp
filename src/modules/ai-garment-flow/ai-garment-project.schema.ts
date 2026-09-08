import { z } from "zod";
import { SAMPLE_TYPES } from "@/modules/sampling/sample.schema";

export const AI_GARMENT_SOURCE_TYPES = ["REFERENCE", "FABRIC"] as const;

// The two workflows share a first step (Project Information) and their last
// four steps (Commercial Evaluation onward), but genuinely diverge in the
// middle (Reference's own multi-step "generate a variation of an existing
// design" vs. Fabric's own "figure out what to make from this swatch" path)
// — one flat step-key enum, service-layer validated against whichever list
// matches the project's own sourceType, rather than two disjoint Zod enums.
export const AI_GARMENT_STEP_KEYS = [
  "PROJECT_INFO",
  "UPLOAD_REFERENCE",
  "REFERENCE_ANALYSIS",
  "DEVELOPMENT_BRIEF",
  "GENERATE_VARIATIONS",
  "UPLOAD_FABRIC",
  "FABRIC_INFORMATION",
  "FABRIC_ANALYSIS",
  "PRODUCT_SUITABILITY",
  "PRODUCT_DIRECTIONS",
  "GENERATE_DESIGNS",
  "COMMERCIAL_EVALUATION",
  "SELECT_DESIGN",
  "APPLY_FABRIC",
  "TECHNICAL_DEVELOPMENT",
  "BOM",
  "COSTING",
  "SAMPLING_REVIEW",
  "PRODUCTION",
] as const;
export type AiGarmentStepKey = (typeof AI_GARMENT_STEP_KEYS)[number];

interface StepDef {
  key: AiGarmentStepKey;
  label: string;
}

export const AI_GARMENT_REFERENCE_STEPS: StepDef[] = [
  { key: "PROJECT_INFO", label: "Project Information" },
  { key: "UPLOAD_REFERENCE", label: "Upload Reference" },
  { key: "REFERENCE_ANALYSIS", label: "Reference Analysis" },
  { key: "DEVELOPMENT_BRIEF", label: "Development Brief" },
  { key: "GENERATE_VARIATIONS", label: "Generate Variations" },
  { key: "COMMERCIAL_EVALUATION", label: "Commercial Evaluation" },
  { key: "SELECT_DESIGN", label: "Select Design" },
  { key: "APPLY_FABRIC", label: "Apply Fabric" },
  { key: "TECHNICAL_DEVELOPMENT", label: "Technical Development" },
  { key: "BOM", label: "BOM" },
  { key: "COSTING", label: "Costing" },
  { key: "SAMPLING_REVIEW", label: "Sampling & Buyer Review" },
  { key: "PRODUCTION", label: "Production Handoff" },
];

export const AI_GARMENT_FABRIC_STEPS: StepDef[] = [
  { key: "PROJECT_INFO", label: "Project Information" },
  { key: "UPLOAD_FABRIC", label: "Upload Fabric" },
  { key: "FABRIC_INFORMATION", label: "Fabric Information" },
  { key: "FABRIC_ANALYSIS", label: "Fabric Analysis" },
  { key: "PRODUCT_SUITABILITY", label: "Product Suitability" },
  { key: "PRODUCT_DIRECTIONS", label: "Product Directions" },
  { key: "GENERATE_DESIGNS", label: "Generate Designs" },
  { key: "COMMERCIAL_EVALUATION", label: "Commercial Evaluation" },
  { key: "SELECT_DESIGN", label: "Select Design" },
  { key: "TECHNICAL_DEVELOPMENT", label: "Technical Development" },
  { key: "BOM", label: "BOM" },
  { key: "COSTING", label: "Costing" },
  { key: "SAMPLING_REVIEW", label: "Sampling & Buyer Review" },
  { key: "PRODUCTION", label: "Production Handoff" },
];

export function stepsForSourceType(sourceType: "REFERENCE" | "FABRIC"): StepDef[] {
  return sourceType === "REFERENCE" ? AI_GARMENT_REFERENCE_STEPS : AI_GARMENT_FABRIC_STEPS;
}

export const aiGarmentProjectSchema = z.object({
  projectName: z.string().min(1, "Project name is required").max(200),
  sourceType: z.enum(AI_GARMENT_SOURCE_TYPES),
  customerId: z.string().uuid().optional().or(z.literal("")),
  buyerId: z.string().uuid().optional().or(z.literal("")),
  brandId: z.string().uuid().optional().or(z.literal("")),
  seasonId: z.string().uuid().optional().or(z.literal("")),
  categoryId: z.string().uuid().optional().or(z.literal("")),
  // Free text — no "Market" master exists in this ERP today (see the schema
  // comment on AiGarmentProject.targetMarket).
  targetMarket: z.string().max(100).optional().or(z.literal("")),
  targetCustomerProfile: z.string().max(1000).optional().or(z.literal("")),
  targetSellingPrice: z.coerce.number().min(0).optional(),
  currencyCode: z.string().length(3).optional().or(z.literal("")),
  orderQuantityEstimate: z.coerce.number().positive().optional(),
  notes: z.string().max(2000).optional().or(z.literal("")),
});
export type AiGarmentProjectInput = z.infer<typeof aiGarmentProjectSchema>;

export const aiGarmentProjectUpdateSchema = aiGarmentProjectSchema.omit({ sourceType: true }).partial();
export type AiGarmentProjectUpdateInput = z.infer<typeof aiGarmentProjectUpdateSchema>;

export const saveWorkflowStepSchema = z.object({
  stepKey: z.enum(AI_GARMENT_STEP_KEYS),
});
export type SaveWorkflowStepInput = z.infer<typeof saveWorkflowStepSchema>;

export const fabricDetailSchema = z.object({
  gsmId: z.string().uuid().optional().or(z.literal("")),
  dyeId: z.string().uuid().optional().or(z.literal("")),
  weaveTypeId: z.string().uuid().optional().or(z.literal("")),
  widthId: z.string().uuid().optional().or(z.literal("")),
  compositionId: z.string().uuid().optional().or(z.literal("")),
  colorId: z.string().uuid().optional().or(z.literal("")),
  supplierId: z.string().uuid().optional().or(z.literal("")),
  notes: z.string().max(1000).optional().or(z.literal("")),
});
export type FabricDetailInput = z.infer<typeof fabricDetailSchema>;

export const createDesignOptionSchema = z.object({
  label: z.string().max(200).optional().or(z.literal("")),
  notes: z.string().max(1000).optional().or(z.literal("")),
});
export type CreateDesignOptionInput = z.infer<typeof createDesignOptionSchema>;

// Pre-fills the created Product from the project's own fields — a
// merchandiser reviews/edits before submitting, exactly like Sampling's own
// Convert-to-Style form.
export const convertProjectToStyleSchema = z.object({
  styleCode: z.string().min(1, "Style code is required").max(30),
  styleName: z.string().min(1, "Style name is required").max(200),
  categoryId: z.string().uuid().optional().or(z.literal("")),
  seasonId: z.string().uuid().optional().or(z.literal("")),
  brandId: z.string().uuid().optional().or(z.literal("")),
  gender: z.string().max(50).optional().or(z.literal("")),
  description: z.string().max(2000).optional().or(z.literal("")),
  hsnSacCode: z.string().max(20).optional().or(z.literal("")),
});
export type ConvertProjectToStyleInput = z.infer<typeof convertProjectToStyleSchema>;

export const createSampleRequestFromProjectSchema = z.object({
  sampleType: z.enum(SAMPLE_TYPES),
  color: z.string().max(100).optional().or(z.literal("")),
  targetSubmissionDate: z.string().optional().or(z.literal("")),
});
export type CreateSampleRequestFromProjectInput = z.infer<typeof createSampleRequestFromProjectSchema>;

// Links an already-created Sales Order back to this project — Sales Order
// creation itself is never reimplemented here (it needs real commercial
// input — unit price, per-variant quantities — that can't be sensibly
// defaulted the way Sample Request creation's optional fields could), so a
// merchandiser creates it through the existing Sales Order form and links
// it back by number.
export const linkSalesOrderToProjectSchema = z.object({
  salesOrderId: z.string().uuid("Sales Order is required"),
});
export type LinkSalesOrderToProjectInput = z.infer<typeof linkSalesOrderToProjectSchema>;
