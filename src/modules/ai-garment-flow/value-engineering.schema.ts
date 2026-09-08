import { z } from "zod";

export const generateValueEngineeringSchema = z.object({
  additionalGuidance: z.string().max(1000).optional(),
});
export type GenerateValueEngineeringInput = z.infer<typeof generateValueEngineeringSchema>;
