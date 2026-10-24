import { z } from "zod";

export const REGULARIZATION_TYPES = ["MISSED_PUNCH", "MISSED_LOGOUT", "CHANGE_LOGIN", "CHANGE_LOGOUT", "LEAVE_NOT_TAKEN", "EMERGENCY_LEAVE"] as const;

const hhmm = z.string().regex(/^\d{2}:\d{2}$/, "Time must be HH:mm");

/**
 * The 6 regularization types (old regularization.js). Which fields each type
 * needs is checked in the service, with type-specific messages.
 */
export const createAttendanceCorrectionSchema = z.object({
  /** Omit to raise it for yourself. */
  employeeId: z.string().uuid().optional().or(z.literal("")),
  type: z.enum(REGULARIZATION_TYPES).default("MISSED_PUNCH"),
  /** Day (MISSED_PUNCH); for session edits it comes from the session. */
  attendanceDate: z.string().optional().or(z.literal("")),
  sessionId: z.string().uuid().optional().or(z.literal("")),
  checkIn: hhmm.optional().or(z.literal("")),
  checkOut: hhmm.optional().or(z.literal("")),
  dateFrom: z.string().optional().or(z.literal("")),
  dateTo: z.string().optional().or(z.literal("")),
  leaveTypeId: z.string().uuid().optional().or(z.literal("")),
  reason: z.string().trim().min(1, "A reason is required.").max(1000),
  remark: z.string().max(1000).optional().or(z.literal("")),
  // Older clients (before the 6 types) sent ISO punch times.
  requestedPunchIn: z.string().optional().or(z.literal("")),
  requestedPunchOut: z.string().optional().or(z.literal("")),
});
export type CreateAttendanceCorrectionInput = z.infer<typeof createAttendanceCorrectionSchema>;

export const rejectAttendanceCorrectionSchema = z.object({
  reason: z.string().min(1, "A reason is required to reject a correction request.").max(1000),
});
export type RejectAttendanceCorrectionInput = z.infer<typeof rejectAttendanceCorrectionSchema>;
