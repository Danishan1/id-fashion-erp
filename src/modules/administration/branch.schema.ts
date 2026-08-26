import { z } from "zod";

export const BRANCH_TYPES = ["FACTORY", "OFFICE", "WAREHOUSE"] as const;

export const branchSchema = z.object({
  code: z.string().min(1, "Code is required").max(20),
  name: z.string().min(1, "Name is required").max(200),
  type: z.enum(BRANCH_TYPES),
  addressLine: z.string().max(500).optional().or(z.literal("")),
});
export type BranchInput = z.infer<typeof branchSchema>;

export const branchStatusSchema = z.object({
  isActive: z.boolean(),
});
export type BranchStatusInput = z.infer<typeof branchStatusSchema>;
