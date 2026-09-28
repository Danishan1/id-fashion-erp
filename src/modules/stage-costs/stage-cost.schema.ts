import { z } from "zod";

/** One stage's cost in a save request. `null` removes it (Style) or reverts to the inherited Style cost (Design). */
const stageCostEntry = z.object({
  productionStageId: z.string().uuid("Invalid stage"),
  cost: z
    .union([
      z.coerce.number({ message: "Cost must be a number." }).min(0, "Cost cannot be negative.").max(1_000_000, "Cost is too large."),
      z.null(),
    ])
    .transform((v) => (v === null ? null : Math.round(v * 10000) / 10000)),
});

export const saveStageCostsSchema = z.object({
  costs: z
    .array(stageCostEntry)
    .max(100)
    .refine((rows) => new Set(rows.map((r) => r.productionStageId)).size === rows.length, "Each stage can only appear once."),
});
export type SaveStageCostsInput = z.infer<typeof saveStageCostsSchema>;
