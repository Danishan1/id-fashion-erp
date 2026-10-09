import { z } from "zod";

export const DUPLICATE_POLICIES = ["SKIP", "UPDATE", "CREATE", "FLAG_FOR_REVIEW"] as const;

export const importOptionsSchema = z
  .object({
    /** Values treated as empty in addition to blank cells. */
    emptyTokens: z.array(z.string().trim().max(30)).max(30).optional(),
    fixNameCase: z.boolean().default(true),
    dateOrder: z.enum(["DMY", "MDY"]).default("DMY"),
    /** Owner for rows without a (known) owner: omitted = the importing user, null = unassigned. */
    defaultOwnerUserId: z.string().uuid().nullable().optional(),
    /** Tags added to every imported lead. */
    tagNames: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  })
  .strict();
export type ImportOptions = z.infer<typeof importOptionsSchema>;

export const importSetupSchema = z
  .object({
    mapping: z.record(z.string(), z.string().max(80)),
    sourceId: z.string().uuid().nullable().optional(),
    duplicatePolicy: z.enum(DUPLICATE_POLICIES),
    options: importOptionsSchema.optional(),
  })
  .strict();
export type ImportSetupInput = z.infer<typeof importSetupSchema>;

export const importRowsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  validation: z.enum(["VALID", "WARNING", "ERROR"]).optional(),
  outcome: z.enum(["PENDING", "IMPORTED", "UPDATED", "SKIPPED", "FLAGGED", "FAILED"]).optional(),
  duplicates: z.enum(["only"]).optional(),
  problems: z.enum(["only"]).optional(),
});
export type ImportRowsQuery = z.infer<typeof importRowsQuerySchema>;

export const reviewDecisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("CREATE"), rowIds: z.array(z.string().uuid()).min(1).max(200) }),
  z.object({ action: z.literal("SKIP"), rowIds: z.array(z.string().uuid()).min(1).max(200) }),
  /** Update the lead the row matched (single match) or the lead chosen on review. */
  z.object({ action: z.literal("UPDATE"), rowIds: z.array(z.string().uuid()).min(1).max(200), leadId: z.string().uuid().optional() }),
]);
export type ReviewDecision = z.infer<typeof reviewDecisionSchema>;

export const importJobListQuerySchema = z.object({
  status: z.enum(["PENDING", "VALIDATING", "READY", "PROCESSING", "COMPLETED", "PARTIALLY_COMPLETED", "FAILED", "CANCELLED"]).optional(),
});
