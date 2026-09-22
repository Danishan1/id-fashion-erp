import { z } from "zod";

export const createReplicateProjectSchema = z.object({
  projectName: z.string().min(1, "Project name is required").max(200),
});
export type CreateReplicateProjectInput = z.infer<typeof createReplicateProjectSchema>;

/** Front/back/side/detail set a single-slot column on the project; ADDITIONAL just adds a plain repeatable Attachment tagged "REFERENCE_ADDITIONAL". */
export const REFERENCE_IMAGE_SLOTS = ["FRONT", "BACK", "SIDE", "DETAIL", "ADDITIONAL"] as const;
export type ReferenceImageSlot = (typeof REFERENCE_IMAGE_SLOTS)[number];

export const selectReplicateFabricSchema = z.object({
  fabricProductId: z.string().uuid("A fabric must be selected"),
});
export type SelectReplicateFabricInput = z.infer<typeof selectReplicateFabricSchema>;

export const updateDnaObservationSchema = z.object({
  approvedObservation: z.string().min(1, "This field cannot be empty").max(500),
});
export type UpdateDnaObservationInput = z.infer<typeof updateDnaObservationSchema>;

export const setDnaObservationLockSchema = z.object({
  isLocked: z.boolean(),
});
export type SetDnaObservationLockInput = z.infer<typeof setDnaObservationLockSchema>;

export const MATERIAL_ROLE_VALUES = [
  "MAIN_FABRIC",
  "CONTRAST_FABRIC",
  "LINING",
  "INTERLINING",
  "BUTTON",
  "ZIPPER",
  "THREAD",
  "LABEL",
  "TRIM_OTHER",
  "OTHER",
] as const;
export type MaterialRole = (typeof MATERIAL_ROLE_VALUES)[number];

export const addMaterialLineSchema = z.object({
  productId: z.string().uuid("A material must be selected"),
  role: z.enum(MATERIAL_ROLE_VALUES).default("OTHER"),
  quantity: z.number().positive().optional(),
  uomId: z.string().uuid().optional(),
  notes: z.string().max(500).optional(),
});
export type AddMaterialLineInput = z.infer<typeof addMaterialLineSchema>;

/** Compatibility check and DNA analysis both take no user input — every field comes from the project's own already-recorded state. */
export const runDnaAnalysisSchema = z.object({});
export type RunDnaAnalysisInput = z.infer<typeof runDnaAnalysisSchema>;

export const runCompatibilityCheckSchema = z.object({});
export type RunCompatibilityCheckInput = z.infer<typeof runCompatibilityCheckSchema>;

export const IMAGE_COUNT_VALUES = [1, 3, 4] as const;
export const generateReplicateDesignSchema = z.object({
  imageCount: z.union([z.literal(1), z.literal(3), z.literal(4)]).default(1),
  /**
   * Required only once the compatibility check has flagged anything other
   * than COMPATIBLE — the feature's own spec never hard-blocks generation,
   * it just requires an explicit "Continue Anyway" acknowledgement first.
   */
  acknowledgeCompatibilityWarning: z.boolean().optional(),
});
export type GenerateReplicateDesignInput = z.infer<typeof generateReplicateDesignSchema>;

export const decideReplicateImageSchema = z.object({
  decision: z.enum(["SELECT", "REJECT"]),
  confirmed: z.boolean().optional(),
});
export type DecideReplicateImageInput = z.infer<typeof decideReplicateImageSchema>;

// ---------------------------------------------------------------------------
// Edit Design workspace — mirrors AI Designer's own edit schema exactly
// (three edit modes, the same field shapes); applyReplicateEditVariationSchema
// below is the separate, explicit apply step.
// ---------------------------------------------------------------------------

export const REPLICATE_EDIT_MODES = ["QUICK", "TECHNICAL", "AI_PROMPT"] as const;
export type ReplicateEditMode = (typeof REPLICATE_EDIT_MODES)[number];

export const generateReplicateEditPreviewSchema = z
  .object({
    mode: z.enum(REPLICATE_EDIT_MODES),
    featureLabel: z.string().min(1, "Name what you're changing").max(100),
    currentValue: z.string().max(300).optional().or(z.literal("")),
    newValue: z.string().max(500).optional().or(z.literal("")),
    technicalFields: z.record(z.string().min(1).max(100), z.string().max(300)).optional(),
    freeformInstructions: z.string().max(2000).optional().or(z.literal("")),
    imageCount: z.number().int().min(1).max(4).default(1),
  })
  .superRefine((data, ctx) => {
    if (data.mode === "QUICK" && !data.newValue) {
      ctx.addIssue({ code: "custom", message: "Describe the new requirement.", path: ["newValue"] });
    }
    if (data.mode === "TECHNICAL" && (!data.technicalFields || Object.keys(data.technicalFields).length === 0)) {
      ctx.addIssue({ code: "custom", message: "Add at least one technical field.", path: ["technicalFields"] });
    }
    if (data.mode === "AI_PROMPT" && !data.freeformInstructions) {
      ctx.addIssue({ code: "custom", message: "Describe the design change you want.", path: ["freeformInstructions"] });
    }
  });
export type GenerateReplicateEditPreviewInput = z.infer<typeof generateReplicateEditPreviewSchema>;

/** Explicit apply step for one previewed image — the actual "commit as the new current design" action; never happens implicitly on generation. */
export const applyReplicateEditVariationSchema = z.object({
  confirmed: z.boolean(),
});
export type ApplyReplicateEditVariationInput = z.infer<typeof applyReplicateEditVariationSchema>;

/**
 * Branding — optional brand name + logo overlay, the exact same shape as AI
 * Designer's own equivalent (duplicated, not imported, per this module's
 * established isolation rule). brandName is a plain string, not required —
 * an empty string clears it back to the resolved company-name default (see
 * getReplicateBrandDefaults() in the service).
 */
export const updateReplicateBrandNameSchema = z.object({
  brandName: z.string().max(200).optional().or(z.literal("")),
});
export type UpdateReplicateBrandNameInput = z.infer<typeof updateReplicateBrandNameSchema>;

export const updateReplicateLogoPositionSchema = z.object({
  logoXPercent: z.number().min(0).max(100),
  logoYPercent: z.number().min(0).max(100),
  logoWidthPercent: z.number().min(5).max(60),
});
export type UpdateReplicateLogoPositionInput = z.infer<typeof updateReplicateLogoPositionSchema>;
