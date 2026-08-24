import { z } from "zod";

export const createLeaveTypeSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  annualDays: z.coerce.number().min(0).default(0),
  isActive: z.boolean().default(true),
});
export type CreateLeaveTypeInput = z.infer<typeof createLeaveTypeSchema>;
export const updateLeaveTypeSchema = createLeaveTypeSchema;
export type UpdateLeaveTypeInput = z.infer<typeof updateLeaveTypeSchema>;

export const createLeaveRequestSchema = z
  .object({
    employeeId: z.string().uuid("Employee is required"),
    leaveTypeId: z.string().uuid("Leave type is required"),
    startDate: z.string().min(1, "Start date is required"),
    endDate: z.string().min(1, "End date is required"),
    reason: z.string().max(1000).optional().or(z.literal("")),
  })
  .refine((input) => new Date(input.endDate) >= new Date(input.startDate), {
    message: "End date must be on or after the start date.",
    path: ["endDate"],
  });
export type CreateLeaveRequestInput = z.infer<typeof createLeaveRequestSchema>;

export const rejectLeaveRequestSchema = z.object({
  reason: z.string().min(1, "A reason is required to reject a leave request.").max(1000),
});
export type RejectLeaveRequestInput = z.infer<typeof rejectLeaveRequestSchema>;
