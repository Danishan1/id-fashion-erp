import { z } from "zod";

export const employeeSchema = z.object({
  employeeCode: z.string().min(1, "Employee code is required").max(30),
  fullName: z.string().min(1, "Name is required").max(200),
  departmentId: z.string().uuid().optional().or(z.literal("")),
  // Wired for HRMS Attendance's late-flag computation — see
  // CRM_SALES_MARKETING_HRMS_MIGRATION_REPORT.md.
  shiftId: z.string().uuid().optional().or(z.literal("")),
  designationId: z.string().uuid().optional().or(z.literal("")),
  phone: z.string().max(50).optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  joinDate: z.string().optional().or(z.literal("")),
  isActive: z.boolean().default(true),
});

export type EmployeeInput = z.infer<typeof employeeSchema>;

/** Partial variant for PATCH — only fields actually present in the request body are validated/updated. */
export const employeeUpdateSchema = employeeSchema.partial();
export type EmployeeUpdateInput = z.infer<typeof employeeUpdateSchema>;
