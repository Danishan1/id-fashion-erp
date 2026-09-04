import { z } from "zod";

export const costMasterSchema = z.object({
  code: z.string().min(1, "Code is required").max(30),
  name: z.string().min(1, "Name is required").max(200),
  type: z.enum(["HOURLY", "MONTHLY", "PER_UNIT", "FIXED", "PERCENTAGE"]).default("HOURLY"),
  rate: z.coerce.number().min(0),
  isActive: z.coerce.boolean().default(true),
});
export type CostMasterInput = z.infer<typeof costMasterSchema>;
