import { z } from "zod";

export const recordAttendanceSchema = z.object({
  employeeId: z.string().uuid("Employee is required"),
  attendanceDate: z.string().min(1, "Date is required"),
  punchIn: z.string().optional().or(z.literal("")),
  punchOut: z.string().optional().or(z.literal("")),
  remarks: z.string().max(500).optional().or(z.literal("")),
});
export type RecordAttendanceInput = z.infer<typeof recordAttendanceSchema>;
