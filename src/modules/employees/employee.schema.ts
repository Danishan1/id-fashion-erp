import { z } from "zod";
import { optionalPhoneSchema } from "@/lib/validation";

export const employeeSchema = z.object({
  employeeCode: z.string().min(1, "Employee code is required").max(30),
  fullName: z.string().min(1, "Name is required").max(200),
  departmentId: z.string().uuid().optional().or(z.literal("")),
  // Wired for HRMS Attendance's late-flag computation — see
  // CRM_SALES_MARKETING_HRMS_MIGRATION_REPORT.md.
  shiftId: z.string().uuid().optional().or(z.literal("")),
  designationId: z.string().uuid().optional().or(z.literal("")),
  // Independent of Department/Designation — employment classification, not
  // organizational placement. See the Item 7 analysis, 2026-09-01.
  employeeCategoryId: z.string().uuid().optional().or(z.literal("")),
  // The reporting-manager hierarchy — existed on the DB model since Phase
  // 3/HRMS migration but was never wired into the create/edit form or a
  // real query until now (HRMS gap-analysis Priority 2 item).
  reportsToId: z.string().uuid().optional().or(z.literal("")),
  phone: optionalPhoneSchema,
  email: z.string().email().optional().or(z.literal("")),
  joinDate: z.string().optional().or(z.literal("")),
  isActive: z.boolean().default(true),
});

export type EmployeeInput = z.infer<typeof employeeSchema>;

/** Partial variant for PATCH — only fields actually present in the request body are validated/updated. */
export const employeeUpdateSchema = employeeSchema.partial();
export type EmployeeUpdateInput = z.infer<typeof employeeUpdateSchema>;
