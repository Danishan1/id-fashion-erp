import { z } from "zod";

export const createCommercialEvaluationSchema = z.object({
  designDirectionIds: z.array(z.string().uuid()).min(2, "Select at least 2 designs to compare.").max(8, "Compare at most 8 designs at a time."),
  /** Free-text runtime input, never persisted on the project — same non-persisted-override convention already used by Development Brief's own factoryCapabilities field (no FactoryCapability master/column exists anywhere in this ERP). */
  factoryCapability: z.string().max(500).optional().or(z.literal("")),
});
export type CreateCommercialEvaluationInput = z.infer<typeof createCommercialEvaluationSchema>;

// Deliberately excludes "NOT_RANKED" — as a user override that would mean
// exactly the same thing as `null` (no override, defer to the AI's own
// rank), so there's no reason to let the client send it as a distinct value.
export const OVERRIDE_RANK_VALUES = ["FIRST_CHOICE", "SECOND_CHOICE", "THIRD_CHOICE"] as const;

export const overrideRankSchema = z.object({
  /** null clears any override, reverting the display back to the AI's own suggested rank. */
  userRank: z.enum(OVERRIDE_RANK_VALUES).nullable(),
});
export type OverrideRankInput = z.infer<typeof overrideRankSchema>;

export const selectDesignForDevelopmentSchema = z.object({
  designDirectionId: z.string().uuid(),
  /** Required — "Final choice must always be user-approved" per the spec, same require-confirmation contract as every other Select action in this codebase. */
  confirmed: z.boolean(),
});
export type SelectDesignForDevelopmentInput = z.infer<typeof selectDesignForDevelopmentSchema>;
