import { z } from "zod";

export const createAttendanceCorrectionSchema = z
  .object({
    employeeId: z.string().uuid("Employee is required"),
    attendanceDate: z.string().min(1, "Date is required"),
    requestedPunchIn: z.string().optional().or(z.literal("")),
    requestedPunchOut: z.string().optional().or(z.literal("")),
    reason: z.string().min(1, "A reason is required to request a correction.").max(1000),
  })
  .refine((input) => input.requestedPunchIn || input.requestedPunchOut, {
    message: "Provide a corrected punch-in and/or punch-out time.",
    path: ["requestedPunchIn"],
  });
export type CreateAttendanceCorrectionInput = z.infer<typeof createAttendanceCorrectionSchema>;

export const rejectAttendanceCorrectionSchema = z.object({
  reason: z.string().min(1, "A reason is required to reject a correction request.").max(1000),
});
export type RejectAttendanceCorrectionInput = z.infer<typeof rejectAttendanceCorrectionSchema>;
