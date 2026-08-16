import { z } from "zod";

export const departmentSchema = z.object({
  code: z.string().min(1, "Code is required").max(30),
  name: z.string().min(1, "Name is required").max(200),
});

export type DepartmentInput = z.infer<typeof departmentSchema>;
