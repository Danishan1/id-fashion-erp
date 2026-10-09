import { z } from "zod";
import { REMINDER_MINUTES } from "../activities/activity-registry";
import { isValidTimeZone } from "../core/crm-timezone";
import { APPOINTMENT_STATUS_KEYS } from "./appointment-registry";

/** Client-safe (zod only): appointment API, form, calendar filters. */

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a valid time (HH:mm)");
const version = z.number().int().min(1);
const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal("")).nullable();
const blankToNull = <T extends z.ZodTypeAny>(t: T) => z.union([t, z.literal("")]).transform((v) => (v === "" ? null : v)).nullable().optional();

export const timeZoneSchema = z.string().trim().refine(isValidTimeZone, "Choose a valid time zone");

/** http(s) meeting links only (no javascript:, data:, …). */
export const videoLinkSchema = z
  .string()
  .trim()
  .max(500, "Use at most 500 characters")
  .refine((v) => {
    try {
      const u = new URL(v);
      return (u.protocol === "https:" || u.protocol === "http:") && Boolean(u.hostname);
    } catch {
      return false;
    }
  }, "Enter a full meeting link starting with https://");

const reminderMinutes = z
  .union([z.number(), z.string().regex(/^\d+$/), z.literal(""), z.null()])
  .transform((v) => (v === "" || v === null ? null : Number(v)))
  .refine((v) => v === null || REMINDER_MINUTES.includes(v), "Choose a reminder from the list")
  .optional();

/** Start and end as wall-clock date + time in `timezone`. endDate defaults to startDate. */
const whenFields = {
  startDate: isoDate,
  startTime: hhmm,
  endDate: blankToNull(isoDate),
  endTime: hhmm,
  timezone: timeZoneSchema,
};

const relationFields = {
  contactId: blankToNull(uuid),
  companyId: blankToNull(uuid),
  opportunityId: blankToNull(uuid),
  /** Phase 09 compatibility: an appointment on a lead (no other relation). */
  leadId: blankToNull(uuid),
};

const detailFields = {
  title: z.string().trim().min(1, "Title is required").max(200),
  description: optionalText(5000),
  appointmentType: optionalText(80),
  location: optionalText(300),
  videoLink: blankToNull(videoLinkSchema),
  reminderMinutes,
};

export const createAppointmentSchema = z.object({
  ...detailFields,
  ...whenFields,
  ...relationFields,
  /** Defaults to the creator. */
  assignedToUserId: uuid.optional(),
  /** Book even though the employee already has an appointment then. */
  allowConflict: z.boolean().optional(),
});
export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;

/** Edit details / relations / times / employee while the appointment is open. A time change is recorded as a reschedule. */
export const updateAppointmentSchema = z
  .object({
    version,
    title: detailFields.title.optional(),
    description: detailFields.description,
    appointmentType: detailFields.appointmentType,
    location: detailFields.location,
    videoLink: detailFields.videoLink,
    reminderMinutes,
    startDate: isoDate.optional(),
    startTime: hhmm.optional(),
    endDate: blankToNull(isoDate),
    endTime: hhmm.optional(),
    timezone: timeZoneSchema.optional(),
    ...relationFields,
    assignedToUserId: uuid.optional(),
    allowConflict: z.boolean().optional(),
    reason: optionalText(300),
  })
  .strict()
  .refine((v) => [v.startDate, v.startTime, v.endTime].every((x) => x === undefined) || [v.startDate, v.startTime, v.endTime].every((x) => x !== undefined), {
    message: "Send the start date, start time and end time together",
    path: ["startDate"],
  });
export type UpdateAppointmentInput = z.infer<typeof updateAppointmentSchema>;

export const rescheduleAppointmentSchema = z.object({
  version: version.optional(),
  ...whenFields,
  /** Keeps the appointment's zone when omitted. */
  timezone: timeZoneSchema.optional(),
  reminderMinutes,
  reason: optionalText(300),
  allowConflict: z.boolean().optional(),
});
export type RescheduleAppointmentInput = z.infer<typeof rescheduleAppointmentSchema>;

export const appointmentActionSchema = z.object({ version: version.optional(), reason: optionalText(300) });
export const completeAppointmentSchema = z.object({
  version: version.optional(),
  outcome: optionalText(120),
  /** What happened / next step. */
  note: optionalText(2000),
});
export const assignAppointmentSchema = z.object({ version: version.optional(), assignedToUserId: uuid, allowConflict: z.boolean().optional() });

/** GET /appointments/availability */
export const availabilityQuerySchema = z
  .object({
    assignedToUserId: uuid,
    /** Either instants … */
    startAt: z.string().datetime({ offset: true }).optional(),
    endAt: z.string().datetime({ offset: true }).optional(),
    /** … or wall-clock times in a zone. */
    startDate: isoDate.optional(),
    startTime: hhmm.optional(),
    endDate: isoDate.optional(),
    endTime: hhmm.optional(),
    timezone: timeZoneSchema.optional(),
    excludeId: uuid.optional(),
  })
  .refine((v) => (v.startAt && v.endAt) || (v.startDate && v.startTime && v.endTime && v.timezone), { message: "Give startAt + endAt, or startDate + startTime + endTime + timezone", path: ["startAt"] });

// ── Calendar / list filters ──────────────────────────────────────

const csv = <T extends z.ZodType<unknown, string>>(item: T) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined))
    .pipe(z.array(item).max(100).optional());

export const APPOINTMENT_SORT_FIELDS = ["startAt", "createdAt", "updatedAt", "title"] as const;
export type AppointmentSortField = (typeof APPOINTMENT_SORT_FIELDS)[number];

/** Max range the calendar may request at once (a month view plus padding weeks). */
export const MAX_CALENDAR_RANGE_DAYS = 62;

export const appointmentFilterSchema = z
  .object({
    /** Calendar window: appointments overlapping [from, to). */
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    assignedToUserIds: csv(uuid),
    /** My calendar. */
    mine: z.enum(["true"]).optional(),
    statuses: csv(z.enum(APPOINTMENT_STATUS_KEYS)),
    appointmentTypes: z
      .string()
      .optional()
      .transform((v) => (v ? v.split("|").map((s) => s.trim()).filter(Boolean) : undefined)),
    contactId: uuid.optional(),
    companyId: uuid.optional(),
    opportunityId: uuid.optional(),
    leadId: uuid.optional(),
    /** upcoming = starts from now; past = started before now. */
    when: z.enum(["upcoming", "past"]).optional(),
  })
  .refine((f) => !f.from || !f.to || new Date(f.from) < new Date(f.to), { message: "'from' must be before 'to'", path: ["from"] })
  .refine((f) => !f.from || !f.to || new Date(f.to).getTime() - new Date(f.from).getTime() <= MAX_CALENDAR_RANGE_DAYS * 86_400_000, { message: `Ask for at most ${MAX_CALENDAR_RANGE_DAYS} days at a time`, path: ["to"] });
export type AppointmentFilter = z.infer<typeof appointmentFilterSchema>;

const FILTER_KEYS = ["from", "to", "assignedToUserIds", "mine", "statuses", "appointmentTypes", "contactId", "companyId", "opportunityId", "leadId", "when"] as const;
export function parseAppointmentFilterParams(sp: URLSearchParams): AppointmentFilter {
  const raw: Record<string, string> = {};
  for (const k of FILTER_KEYS) {
    const v = sp.get(k)?.trim();
    if (v) raw[k] = v;
  }
  return appointmentFilterSchema.parse(raw);
}

export const appointmentSortSchema = z.object({
  sortBy: z.enum(APPOINTMENT_SORT_FIELDS).default("startAt"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});
