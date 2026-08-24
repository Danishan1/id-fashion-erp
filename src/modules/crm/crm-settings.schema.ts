import { z } from "zod";

export const updateCrmSettingsSchema = z
  .object({
    hotThreshold: z.coerce.number().min(0).max(100),
    warmThreshold: z.coerce.number().min(0).max(100),
  })
  .refine((input) => input.warmThreshold < input.hotThreshold, {
    message: "The Warm threshold must be lower than the Hot threshold.",
    path: ["warmThreshold"],
  });

export type UpdateCrmSettingsInput = z.infer<typeof updateCrmSettingsSchema>;
