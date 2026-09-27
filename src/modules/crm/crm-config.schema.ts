import { z } from "zod";

export const CRM_STAGE_KINDS = ["OPEN", "WON", "LOST", "DORMANT"] as const;

const codeSchema = z
  .string()
  .min(1, "Code is required")
  .max(50)
  .regex(/^[A-Za-z0-9_-]+$/, "Code may only contain letters, digits, _ and -")
  .transform((v) => v.toUpperCase());

/** Shared by SimpleLookupManager's inline Add/Edit form, which always posts
 * every field as a string (numbers arrive as "10", the toggle as "true"). */
const baseMasterSchema = z.object({
  code: codeSchema,
  name: z.string().min(1, "Name is required").max(100),
  sortOrder: z.coerce.number().int().min(0).max(100000).default(0),
  // Optional with no default: the ordinary Edit form never sends isActive, so
  // a default here would silently reactivate a deactivated row on every edit
  // (the exact bug already fixed once for Color/Size/HR config masters).
  isActive: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => v === true || v === "true")
    .optional(),
});

export const pipelineStageSchema = baseMasterSchema.extend({
  kind: z.enum(CRM_STAGE_KINDS).default("OPEN"),
});
export type PipelineStageInput = z.infer<typeof pipelineStageSchema>;

export const crmMasterSchema = baseMasterSchema;
export type CrmMasterInput = z.infer<typeof crmMasterSchema>;
