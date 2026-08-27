import { z } from "zod";

export const designationSchema = z.object({
  code: z.string().min(1, "Code is required").max(30),
  name: z.string().min(1, "Name is required").max(200),
  // Optional — a designation may belong to one department, or none (usable
  // across every department, e.g. "General Manager").
  departmentId: z.string().uuid().optional().or(z.literal("")),
  isActive: z.coerce.boolean().optional(),
});
export type DesignationInput = z.infer<typeof designationSchema>;

export const employeeCategorySchema = z.object({
  code: z.string().min(1, "Code is required").max(30),
  name: z.string().min(1, "Name is required").max(200),
  isActive: z.coerce.boolean().optional(),
});
export type EmployeeCategoryInput = z.infer<typeof employeeCategorySchema>;

export const shiftMasterSchema = z.object({
  code: z.string().min(1, "Code is required").max(30),
  name: z.string().min(1, "Name is required").max(200),
  startTime: z.string().min(1, "Start time is required").max(10),
  endTime: z.string().min(1, "End time is required").max(10),
  // Minutes past startTime before a punch-in counts as late.
  graceMinutes: z.coerce.number().int().min(0).max(120).default(0),
  isActive: z.coerce.boolean().optional(),
});
export type ShiftMasterInput = z.infer<typeof shiftMasterSchema>;

export const holidayMasterSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  date: z.coerce.date(),
  isActive: z.coerce.boolean().optional(),
});
export type HolidayMasterInput = z.infer<typeof holidayMasterSchema>;
