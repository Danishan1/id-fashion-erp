import { z } from "zod";
import { WEEKDAYS } from "./attendance-calculator";

export const weekdaySchema = z.enum(WEEKDAYS);

export const updateAttendanceSettingsSchema = z.object({
  defaultWeekends: z.array(weekdaySchema).max(6, "At least one working day is needed."),
  gpsAccuracyMeters: z.coerce.number().int().min(5).max(1000),
  maxSessionHours: z.coerce.number().int().min(1).max(24),
  statusToleranceMinutes: z.coerce.number().int().min(0).max(120),
  faceMatchThreshold: z.coerce.number().min(0.2).max(0.8),
  faceMatchFrames: z.coerce.number().int().min(1).max(10),
  requireFace: z.boolean(),
});
export type UpdateAttendanceSettingsInput = z.infer<typeof updateAttendanceSettingsSchema>;

export const attendanceLocationSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  code: z.string().trim().max(40).optional().or(z.literal("")),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  radiusMeters: z.coerce.number().int().min(10, "Radius must be at least 10 m").max(100_000).default(100),
  address: z.string().trim().max(500).optional().or(z.literal("")),
  branchId: z.string().uuid().optional().or(z.literal("")),
  isActive: z.boolean().optional(),
});
export type AttendanceLocationInput = z.infer<typeof attendanceLocationSchema>;

export const employeeAttendanceProfileSchema = z.object({
  useCompanyWeekends: z.boolean(),
  weekends: z.array(weekdaySchema).max(6).default([]),
  overtimeRatePerHour: z.coerce.number().min(0).max(1_000_000).nullable().optional(),
});
export type EmployeeAttendanceProfileInput = z.infer<typeof employeeAttendanceProfileSchema>;

export const applyWeekendsSchema = z.object({ weekends: z.array(weekdaySchema).max(6) });
