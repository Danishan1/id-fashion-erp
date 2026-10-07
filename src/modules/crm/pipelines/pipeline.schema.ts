import { z } from "zod";

/** Client-safe (zod only): pipeline / stage configuration and opportunity moves. */

const uuid = z.string().uuid();
const version = z.number().int().min(1);
const name = z.string().trim().min(1, "Name is required").max(80, "Use at most 80 characters");
const description = z.string().trim().max(500, "Use at most 500 characters").optional().or(z.literal("")).nullable();
const probability = z
  .union([z.number(), z.string().trim().regex(/^-?\d+$/, "Enter a whole number from 0 to 100"), z.literal("")])
  .transform((v) => (v === "" ? null : Number(v)))
  .pipe(z.number().int("Enter a whole number").min(0, "Probability must be 0–100").max(100, "Probability must be 0–100").nullable());
const requiredFields = z.array(z.string().trim().min(1).max(80)).max(30);

export const TRANSITION_MODES = { ANY: "Any stage (unless a rule blocks it)", ONLY_LISTED: "Only stages listed below" } as const;
export type TransitionMode = keyof typeof TRANSITION_MODES;
const transitionMode = z.enum(["ANY", "ONLY_LISTED"]);

// ── Pipelines ────────────────────────────────────────────────────

export const createPipelineSchema = z.object({
  name,
  description,
  isDefault: z.boolean().optional(),
  /** Stages to create with the pipeline; at least one. The first is the default unless one is marked. */
  stages: z
    .array(z.object({ name, probability: probability.optional(), description, isDefault: z.boolean().optional() }))
    .min(1, "Add at least one stage")
    .max(30)
    .optional(),
});
export type CreatePipelineInput = z.infer<typeof createPipelineSchema>;

export const updatePipelineSchema = z.object({ version, name: name.optional(), description }).strict();

export const archivePipelineSchema = z.object({
  version,
  /** Required when the pipeline still has opportunities: where they move. */
  targetPipelineId: uuid.optional(),
  /** Stage of the target pipeline; defaults to its default stage. */
  targetStageId: uuid.optional(),
  /** Optional per-stage mapping (source stage id → target stage id); unmapped stages use targetStageId. */
  stageMap: z.record(z.string().uuid(), z.string().uuid()).optional(),
  confirm: z.literal(true, { error: "Confirm the move" }).optional(),
});
export type ArchivePipelineInput = z.infer<typeof archivePipelineSchema>;

export const versionOnlySchema = z.object({ version });

// ── Stages ───────────────────────────────────────────────────────

export const createStageSchema = z.object({
  name,
  description,
  probability: probability.optional(),
  isDefault: z.boolean().optional(),
  requiredFields: requiredFields.optional(),
  transitionMode: transitionMode.optional(),
});

export const updateStageSchema = z
  .object({
    version,
    name: name.optional(),
    description,
    probability: probability.optional(),
    requiredFields: requiredFields.optional(),
    transitionMode: transitionMode.optional(),
  })
  .strict();

/** Every non-archived stage of the pipeline exactly once, in the new order. */
export const reorderStagesSchema = z.object({ ids: z.array(uuid).min(1).max(100) });

export const archiveStageSchema = z.object({
  version,
  /** Required when opportunities are in the stage: another active stage of the same pipeline. */
  reassignToStageId: uuid.optional(),
  confirm: z.literal(true, { error: "Confirm the move" }).optional(),
});

export const updateRequiredFieldsSchema = z.object({ version, requiredFields });

export const transitionRuleSchema = z.object({
  toStageId: uuid,
  allowed: z.boolean(),
  requiredFields: requiredFields.optional(),
  message: z.string().trim().max(200).optional().or(z.literal("")).nullable(),
});
export const updateTransitionRulesSchema = z.object({
  version,
  transitionMode,
  /** Replaces every rule leaving this stage. */
  rules: z.array(transitionRuleSchema).max(100),
});
export type TransitionRuleInput = z.infer<typeof transitionRuleSchema>;

// ── Opportunity moves ────────────────────────────────────────────

const probabilityInput = probability.optional().nullable();

export const validateTransitionSchema = z.object({ stageId: uuid, pipelineId: uuid.optional() });

export const transferPipelineSchema = z.object({
  pipelineId: uuid,
  /** Defaults to the destination pipeline's default stage. */
  stageId: uuid.optional(),
  probability: probabilityInput,
  version: version.optional(),
  reason: z.string().trim().max(500).optional().or(z.literal("")).nullable(),
});

/** Board paging options; the opportunity filters themselves are parsed with parseOpportunityFilterParams. */
export const boardQuerySchema = z.object({
  perStage: z.coerce.number().int().min(0).max(100).default(20),
  /** Legacy shortcut: OPEN (default, when no `statuses` filter) or ALL. */
  status: z.enum(["OPEN", "ALL"]).default("OPEN"),
  ownerUserId: uuid.optional(),
  /** Load one column only (next page: with `offset`). */
  stageId: uuid.optional(),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
