import { z } from "zod";
import { TARGET_CUSTOMER_VALUES } from "@/core/ai-designer/catalogs/customer-catalog";

/**
 * Creates a blank draft project — Step 1's fabric choice is recorded by a
 * separate call (selectExistingFabricSchema / the fabric-image upload
 * route), not at creation time. creationMode picks which wizard this project
 * runs: STANDARD (the original fabric-first flow, default) or SKETCH (starts
 * from an uploaded sketch/drawing whose structural design is preserved as
 * the authoritative reference — see stepsForCreationMode() in the service).
 */
export const createProjectSchema = z.object({
  projectName: z.string().min(1, "Project name is required").max(200),
  creationMode: z.enum(["STANDARD", "SKETCH"]).default("STANDARD"),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

/**
 * Sketch Analysis — per-observation edit/lock/reset, same shape as Replicate
 * Design's own updateDnaObservationSchema/setDnaObservationLockSchema
 * (mirrored, not imported, per this module's own file-per-process
 * convention already established throughout this codebase).
 */
export const updateSketchObservationSchema = z.object({
  approvedObservation: z.string().min(1, "This field cannot be empty").max(500),
});
export type UpdateSketchObservationInput = z.infer<typeof updateSketchObservationSchema>;

export const setSketchObservationLockSchema = z.object({
  isLocked: z.boolean(),
});
export type SetSketchObservationLockInput = z.infer<typeof setSketchObservationLockSchema>;

/** Admin-only: switches the Product Design step's attribute pickers between clipart icons and plain text buttons, company-wide. */
export const updateDisplayModeSchema = z.object({
  productDesignDisplayMode: z.enum(["CLIPART", "TEXT"]),
});

export type UpdateDisplayModeInput = z.infer<typeof updateDisplayModeSchema>;

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

/**
 * Edit Design workspace (2026-09-13) — replaces the old immediate-overwrite
 * editDesignSchema/editDesign() entirely. Three edit modes share one input
 * shape: QUICK (today's Feature/Current/New form), TECHNICAL (a free
 * key-value list of structured manufacturing parameters, also persisted
 * verbatim on the resulting version's own technicalChangesJson), and
 * AI_PROMPT (a raw natural-language instruction). Generating a preview never
 * overwrites the current design by itself — see generateEditPreview()/
 * applyEditVariationSchema below for the separate, explicit apply step.
 */
export const EDIT_MODES = ["QUICK", "TECHNICAL", "AI_PROMPT"] as const;
export type EditMode = (typeof EDIT_MODES)[number];

export const generateEditPreviewSchema = z
  .object({
    mode: z.enum(EDIT_MODES),
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
      ctx.addIssue({ code: "custom", message: "Describe the change you want.", path: ["freeformInstructions"] });
    }
  });

export type GenerateEditPreviewInput = z.infer<typeof generateEditPreviewSchema>;

/** Explicit apply step for one previewed image — the actual "commit as the new current design" action; never happens implicitly on generation. */
export const applyEditVariationSchema = z.object({
  confirmed: z.boolean(),
});

export type ApplyEditVariationInput = z.infer<typeof applyEditVariationSchema>;

export const decideImageSchema = z.object({
  decision: z.enum(["SELECT", "REJECT"]),
  confirmed: z.boolean().optional(),
});

export type DecideImageInput = z.infer<typeof decideImageSchema>;

export const EXPORT_FORMATS = ["png", "jpg", "pdf"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/**
 * Multi-Fabric — applies a second fabric photo onto specific area(s) of the
 * currently generated design (Yoke/Sleeves/Borders/Contrast Panels), a real
 * two-image composition distinct from Edit Design's single-image change.
 * `applyAreas` is a plain fixed const list, not a DB enum (see the schema
 * comment on `AiDesignerProject.secondFabricApplyAreas`).
 */
export const SECOND_FABRIC_APPLY_AREAS = ["YOKE", "SLEEVES", "BORDERS", "CONTRAST_PANELS"] as const;
export type SecondFabricApplyArea = (typeof SECOND_FABRIC_APPLY_AREAS)[number];

export const applySecondFabricSchema = z.object({
  applyAreas: z.array(z.enum(SECOND_FABRIC_APPLY_AREAS)).min(1, "Pick at least one area to apply the second fabric to"),
});

export type ApplySecondFabricInput = z.infer<typeof applySecondFabricSchema>;

/**
 * Embellishments — applies a digital applique/embroidery motif onto the
 * currently generated design, via an uploaded motif reference photo and/or
 * free-text instructions. Only "Digital Applique" is confirmed against the
 * competitor reference this feature was built from; the rest of this list is
 * a documented, reasonable judgment call for a plausible fixed embellishment-
 * technique set, easy to extend later — same "plain fixed const list, not a
 * DB enum" shape as SECOND_FABRIC_APPLY_AREAS above.
 */
export const EMBELLISHMENT_TYPES = [
  "DIGITAL_APPLIQUE",
  "EMBROIDERY",
  "SEQUIN_WORK",
  "LACE_TRIM",
  "BEADWORK",
  "PATCHWORK",
] as const;
export type EmbellishmentType = (typeof EMBELLISHMENT_TYPES)[number];

export const applyEmbellishmentsSchema = z.object({
  embellishmentType: z.enum(EMBELLISHMENT_TYPES),
  instructions: z.string().trim().max(1000).optional().or(z.literal("")),
});

export type ApplyEmbellishmentsInput = z.infer<typeof applyEmbellishmentsSchema>;

/** Tech Pack — no user input at all; every field comes from the project's own already-recorded design. */
export const generateTechPackSchema = z.object({});
export type GenerateTechPackInput = z.infer<typeof generateTechPackSchema>;

/**
 * Tech Pack field editing (v3, 2026-09-14) — a structured, explicitly-typed
 * input rather than a free-form path array, matching this codebase's
 * existing `updateFabricFieldSchema`-style "enum of known field keys"
 * convention. `category` picks which part of the Garment Analysis is being
 * edited; `index` is required for the 6 array categories; `field` names the
 * specific key within that category's own item shape (or "values.<SIZE>" for
 * a measurementPoints size cell) and is omitted for the 9 plain-scalar
 * categories, which replace their whole value directly. The service layer
 * (`updateTechPackField`) re-validates `field`/`index` against the real
 * known-key lists exported from `tech-pack/schema.ts` — this Zod schema only
 * bounds the shape/size of the request, not which field names are legal for
 * a given category (that check needs the category itself, done in the
 * service).
 */
export const TECH_PACK_EDITABLE_CATEGORIES = [
  "identification",
  "construction",
  "closure",
  "seamCallouts",
  "visibleColors",
  "suggestedColorways",
  "artworkItems",
  "bomItems",
  "measurementPoints",
  "artworkSummary",
  "patternPrintType",
  "patternPrintNotes",
  "gradeRulesNotes",
  "mainLabelSpec",
  "sizeLabelSpec",
  "careLabelSpec",
  "hangtagSpec",
  "polybagSpec",
  "foldingInstructions",
  "cartonPackingSpec",
  "barcodePlacement",
] as const;
export type TechPackEditableCategory = (typeof TECH_PACK_EDITABLE_CATEGORIES)[number];

export const updateTechPackFieldSchema = z.object({
  category: z.enum(TECH_PACK_EDITABLE_CATEGORIES),
  index: z.number().int().min(0).optional(),
  field: z.string().min(1).max(50).optional(),
  value: z.string().max(2000),
});
export type UpdateTechPackFieldInput = z.infer<typeof updateTechPackFieldSchema>;
