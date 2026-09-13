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
