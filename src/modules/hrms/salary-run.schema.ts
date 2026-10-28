import { z } from "zod";

/** Salary Management slice 3 (2026-10-28): Generate Salary. */

const days = (label: string) =>
  z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    z.coerce
      .number()
      .min(0, `${label} can't be negative`)
      .max(31, `${label} can't be more than 31`)
      .refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, `${label} can have at most 2 decimal places`)
      .optional()
  );

export const editSalaryLineSchema = z.object({
  presentDays: days("Present days"),
  paidLeaveDays: days("Paid leave days"),
  extraDays: days("Extra days"),
  // Arrears may be negative (a recovery) — the net never goes below 0.
  arrearsAmount: z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    z.coerce
      .number()
      .min(-9_999_999, "Arrears is too large")
      .max(9_999_999, "Arrears is too large")
      .refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, "Arrears can have at most 2 decimal places")
      .optional()
  ),
  arrearsReason: z.string().trim().max(300).optional(),
  reason: z.string().trim().min(3, "Give a reason for the change (at least 3 characters)").max(500),
});
export type EditSalaryLineInput = z.infer<typeof editSalaryLineSchema>;

export const salaryRunReasonSchema = z.object({
  reason: z.string().trim().min(3, "Give a reason (at least 3 characters)").max(500),
});

export const salaryRunMonthSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Pick a month"),
});
