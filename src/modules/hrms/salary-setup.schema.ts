import { z } from "zod";

/** Salary Management slice 1 (2026-10-28): PF/ESIC masters + employee salary setup. */

const decimals = (n: number, places: number) => Math.abs(Math.round(n * 10 ** places) - n * 10 ** places) < 1e-6;

const money = (label: string) =>
  z.coerce
    .number({ message: `${label} is required` })
    .min(0, `${label} can't be negative`)
    .max(9_999_999_999, `${label} is too large`)
    .refine((n) => decimals(n, 2), `${label} can have at most 2 decimal places`);

const percent = (label: string) =>
  z.coerce
    .number({ message: `${label} is required` })
    .min(0, `${label} must be between 0 and 100`)
    .max(100, `${label} must be between 0 and 100`)
    .refine((n) => decimals(n, 2), `${label} can have at most 2 decimal places`);

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));
const optionalUuid = z.string().uuid().optional().or(z.literal(""));

export const STATUTORY_KINDS = ["PF", "ESIC"] as const;
export type StatutoryKind = (typeof STATUTORY_KINDS)[number];

export const statutorySettingSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(100),
  employerRate: percent("Employer %"),
  employeeRate: percent("Employee %"),
  // Wage ceiling; empty = no ceiling.
  maxLimit: z.preprocess((v) => (v === "" || v === null ? undefined : v), money("Max limit").optional()),
  // Optional on update so an ordinary edit never re-activates a deactivated row.
  isActive: z.boolean().optional(),
});
export type StatutorySettingInput = z.infer<typeof statutorySettingSchema>;

export const SALARY_COMPONENT_KINDS = ["ALLOWANCE", "DEDUCTION"] as const;

export const salaryComponentSchema = z.object({
  kind: z.enum(SALARY_COMPONENT_KINDS),
  title: z.string().trim().min(1, "Title is required").max(100),
  amount: money("Amount"),
});

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export const employeeSalarySetupSchema = z
  .object({
    baseMonthlySalary: money("Base monthly salary"),
    pfSettingId: optionalUuid,
    esicSettingId: optionalUuid,
    panNumber: z
      .string()
      .trim()
      .toUpperCase()
      .optional()
      .or(z.literal(""))
      .refine((v) => !v || PAN_RE.test(v), "PAN must look like ABCDE1234F"),
    uanNumber: optionalText(30),
    esicNumber: optionalText(30),
    tdsAmount: money("TDS").default(0),
    surchargeAmount: money("Surcharge").default(0),
    educationCess: money("Education cess").default(0),
    lateFeeInterest: money("Interest on late fees").default(0),
    // Saved on the employee's attendance profile (shared with the overtime screen).
    overtimeRatePerHour: z.preprocess((v) => (v === "" || v === null ? undefined : v), money("Overtime rate").optional()),
    bankName: optionalText(100),
    bankAccountNumber: z
      .string()
      .trim()
      .optional()
      .or(z.literal(""))
      .refine((v) => !v || /^[0-9]{6,20}$/.test(v), "Account number must be 6–20 digits"),
    bankIfsc: z
      .string()
      .trim()
      .toUpperCase()
      .optional()
      .or(z.literal(""))
      .refine((v) => !v || IFSC_RE.test(v), "IFSC must look like SBIN0001234"),
    bankBranch: optionalText(100),
    components: z.array(salaryComponentSchema).max(30, "At most 30 allowance/deduction lines").default([]),
  })
  .superRefine((input, ctx) => {
    const seen = new Set<string>();
    input.components.forEach((c, i) => {
      const key = `${c.kind}:${c.title.toLowerCase()}`;
      if (seen.has(key)) ctx.addIssue({ code: "custom", path: ["components", i, "title"], message: `"${c.title}" is listed twice` });
      seen.add(key);
    });
  });
export type EmployeeSalarySetupInput = z.infer<typeof employeeSalarySetupSchema>;
