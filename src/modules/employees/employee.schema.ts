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
  address: z.string().max(500).optional().or(z.literal("")),
  city: z.string().max(100).optional().or(z.literal("")),
  pinCode: z.string().max(20).optional().or(z.literal("")),
  country: z.string().max(100).optional().or(z.literal("")),
  joinDate: z.string().optional().or(z.literal("")),
  // Deliberately `.optional()`, not `.default(true)` — a `.default()` value
  // still gets injected by Zod even under `employeeUpdateSchema`'s
  // `.partial()`, so any PATCH that simply omits this field (as the pay-config
  // and self-entry panels below both do) would silently reactivate an
  // already-deactivated employee on every unrelated edit. `create*`/`update*`
  // below apply the true default explicitly instead — same fix already
  // applied to Color/Size/UnitOfMeasure/hr-config's 4 entities for this exact
  // bug class (CLAUDE.md, 2026-08-25/27).
  isActive: z.boolean().optional(),
  // Pay-config data only (2026-09-02) — storage for Admin's Worker Settings
  // panel, deliberately NOT a payroll calculation/payslip mechanism (see
  // CLAUDE.md's worker self-entry feature notes). Both amounts are optional
  // regardless of payType — a company may set only TA/DA with no base pay
  // configured yet.
  payType: z.enum(["FIXED_SALARY", "PIECE_RATE"]).optional().or(z.literal("")),
  fixedMonthlySalary: z.coerce.number().min(0).optional(),
  pieceRatePerUnit: z.coerce.number().min(0).optional(),
  travelAllowance: z.coerce.number().min(0).optional(),
  dearnessAllowance: z.coerce.number().min(0).optional(),
  // Admin's per-employee toggle: does this worker log their own progress
  // (subject to Supervisor approval), or does a Supervisor log it for them
  // as before. Same `.optional()`-not-`.default()` reasoning as isActive
  // above — the Pay Config modal's own PATCH never sends this field, and
  // must never silently reset it.
  selfEntryEnabled: z.boolean().optional(),
  // Work Skills (2026-09-29): the production stages this employee can do.
  // Optional — office staff have none. Omitted on PATCH = left untouched;
  // an empty array clears every skill.
  workSkillStageIds: z.array(z.string().uuid()).max(100).optional(),
});

export type EmployeeInput = z.infer<typeof employeeSchema>;

/** Partial variant for PATCH — only fields actually present in the request body are validated/updated. */
export const employeeUpdateSchema = employeeSchema.partial();
export type EmployeeUpdateInput = z.infer<typeof employeeUpdateSchema>;
