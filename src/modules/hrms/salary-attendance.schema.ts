import { z } from "zod";

/** Salary Management slice 2 (2026-10-28): Manage Attendance. */

export const SALARY_ADJUSTMENT_MODES = ["FIXED_HOURS", "OFFICE_TIME", "FULL_DAY"] as const;

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");

export const bulkAdjustSchema = z
  .object({
    dates: z.array(dateKey).min(1, "Pick at least one day").max(31, "At most 31 days at a time"),
    mode: z.enum(SALARY_ADJUSTMENT_MODES),
    hours: z.preprocess(
      (v) => (v === "" || v === null ? undefined : v),
      z.coerce.number().gt(0, "Hours must be more than 0").max(24, "Hours can't be more than 24").optional()
    ),
    reason: z.string().trim().min(3, "Give a reason (at least 3 characters)").max(500),
  })
  .superRefine((input, ctx) => {
    if (input.mode === "FIXED_HOURS" && input.hours === undefined) ctx.addIssue({ code: "custom", path: ["hours"], message: "Enter the hours to count" });
    if (new Set(input.dates.map((d) => d.slice(0, 7))).size > 1) ctx.addIssue({ code: "custom", path: ["dates"], message: "All days must be in the same month" });
  });
export type BulkAdjustInput = z.infer<typeof bulkAdjustSchema>;

export const removeAdjustmentSchema = z.object({
  reason: z.string().trim().max(500).optional().or(z.literal("")),
});

export const leavePaymentSwitchSchema = z.object({
  to: z.enum(["PAID", "NOT_PAID"]),
  reason: z.string().trim().min(3, "Give a reason (at least 3 characters)").max(500),
});
export type LeavePaymentSwitchInput = z.infer<typeof leavePaymentSwitchSchema>;
