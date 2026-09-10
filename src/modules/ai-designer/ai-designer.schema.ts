import { z } from "zod";
import { TARGET_CUSTOMER_VALUES } from "@/core/ai-designer/catalogs/customer-catalog";

/** Creates a blank draft project — Step 1's fabric choice is recorded by a separate call (selectExistingFabricSchema / the fabric-image upload route), not at creation time. */
export const createProjectSchema = z.object({
  projectName: z.string().min(1, "Project name is required").max(200),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

/** Step 1, "pick an existing fabric" branch — auto-fills Name/Code/Supplier from the real Fabric Master (Product, itemType RAW_MATERIAL), leaves every other fabric* field blank/editable. */
export const selectExistingFabricSchema = z.object({
  fabricProductId: z.string().uuid("A fabric must be selected"),
});

export type SelectExistingFabricInput = z.infer<typeof selectExistingFabricSchema>;

/**
 * Step 2 — Analyze Fabric with AI. Manual correction of one field at a time,
 * same "no confidence-score machinery, plain string fields" shape as the
 * underlying fabricAnalysisResponseSchema this mirrors.
 */
export const FABRIC_FIELD_KEYS = [
  "fabricName",
  "fabricComposition",
  "fabricGsm",
  "fabricWidth",
  "fabricWeave",
  "fabricStretch",
  "fabricOpacity",
  "fabricTexture",
  "fabricPatternType",
  "fabricPrintType",
  "fabricSuitableSeason",
  "fabricRecommendedGarments",
  "fabricColor",
] as const;
export type FabricFieldKey = (typeof FABRIC_FIELD_KEYS)[number];

export const updateFabricFieldSchema = z.object({
  field: z.enum(FABRIC_FIELD_KEYS),
  value: z.string().max(500),
});

export type UpdateFabricFieldInput = z.infer<typeof updateFabricFieldSchema>;

/**
 * Steps 3-8 — Target Customer / Age Group / Product Category / Design /
 * Model / Environment. One incremental PATCH endpoint accepting whichever
 * fields the current step collected — every field optional so a step can be
 * saved without re-submitting earlier steps' own values (the service layer
 * merges into the existing row, never overwrites with null on omission).
 */
export const saveWizardSelectionsSchema = z.object({
  targetCustomer: z.enum(TARGET_CUSTOMER_VALUES).optional(),
  ageGroup: z.string().max(100).optional(),
  productCategory: z.string().max(100).optional(),
  designSelections: z.record(z.string(), z.string()).optional(),
  modelGender: z.string().max(50).optional(),
  modelBodyType: z.string().max(50).optional(),
  modelPose: z.string().max(50).optional(),
  environmentKey: z.string().max(50).optional().or(z.literal("")),
  environmentLabel: z.string().max(300).optional(),
  isCustomEnvironment: z.boolean().optional(),
});

export type SaveWizardSelectionsInput = z.infer<typeof saveWizardSelectionsSchema>;

export const IMAGE_COUNT_VALUES = [1, 3, 4] as const;

export const generateDesignSchema = z.object({
  imageCount: z.union([z.literal(1), z.literal(3), z.literal(4)]).default(1),
});

export type GenerateDesignInput = z.infer<typeof generateDesignSchema>;

export const editDesignSchema = z.object({
  featureLabel: z.string().min(1, "Select which aspect to change").max(100),
  currentValue: z.string().max(300).optional().or(z.literal("")),
  newValue: z.string().min(1, "Describe the new requirement").max(500),
  additionalInstructions: z.string().max(1000).optional().or(z.literal("")),
});

export type EditDesignInput = z.infer<typeof editDesignSchema>;

export const decideImageSchema = z.object({
  decision: z.enum(["SELECT", "REJECT"]),
  confirmed: z.boolean().optional(),
});

export type DecideImageInput = z.infer<typeof decideImageSchema>;

export const EXPORT_FORMATS = ["png", "jpg", "pdf"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
