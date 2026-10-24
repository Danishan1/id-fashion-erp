import { z } from "zod";

export const createLeaveTypeSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  annualDays: z.coerce.number().min(0).default(0),
  // Attendance module port: quota credited at the start of every allocation period.
  allocationType: z.enum(["MONTHLY", "QUARTERLY", "HALF_YEARLY", "YEARLY"]).default("MONTHLY"),
  quotaPerPeriod: z.coerce.number().min(0).max(366).default(0),
  isActive: z.boolean().default(true),
});
export type CreateLeaveTypeInput = z.infer<typeof createLeaveTypeSchema>;
export const updateLeaveTypeSchema = createLeaveTypeSchema;
export type UpdateLeaveTypeInput = z.infer<typeof updateLeaveTypeSchema>;

export const LEAVE_DURATIONS = ["FULL", "F_HALF", "S_HALF", "QR1", "QR2", "QR3", "QR4"] as const;

/** Day-wise leave (old createLeave): one row per date with its own duration. */
export const createLeaveRequestSchema = z.object({
  /** Omit to apply for yourself. */
  employeeId: z.string().uuid().optional().or(z.literal("")),
  leaveTypeId: z.string().uuid("Leave type is required"),
  days: z
    .array(z.object({ date: z.string().min(10, "Date is required"), duration: z.enum(LEAVE_DURATIONS).default("FULL") }))
    .min(1, "Choose at least one date.")
    .max(62, "A single request can cover at most 62 days."),
  includeSandwich: z.boolean().default(false),
  reason: z.string().max(1000).optional().or(z.literal("")),
});
export type CreateLeaveRequestInput = z.infer<typeof createLeaveRequestSchema>;

export const rejectLeaveRequestSchema = z.object({
  reason: z.string().min(1, "A reason is required to reject a leave request.").max(1000),
});
export type RejectLeaveRequestInput = z.infer<typeof rejectLeaveRequestSchema>;

export const runLeaveCarryForwardSchema = z.object({
  fromYear: z.coerce.number().int().min(2000).max(2100),
});
export type RunLeaveCarryForwardInput = z.infer<typeof runLeaveCarryForwardSchema>;
