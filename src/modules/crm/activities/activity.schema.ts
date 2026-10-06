import { z } from "zod";
import { ACTIVITY_PARENT_TYPES, ACTIVITY_PRIORITY_KEYS, ACTIVITY_STATUS_KEYS, ACTIVITY_TYPE_KEYS, DUE_FILTERS, REMINDER_MINUTES } from "./activity-registry";

/** Client-safe (zod only): activity API, composer and list filters. */

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a valid time (HH:mm)");
const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal("")).nullable();
const version = z.number().int().min(1);
const blankToNull = <T extends z.ZodTypeAny>(t: T) => z.union([t, z.literal("")]).transform((v) => (v === "" ? null : v)).nullable().optional();

const reminderMinutes = z
  .union([z.number(), z.string().regex(/^\d+$/), z.literal(""), z.null()])
  .transform((v) => (v === "" || v === null ? null : Number(v)))
  .refine((v) => v === null || REMINDER_MINUTES.includes(v), "Choose a reminder from the list")
  .optional();
const duration = z
  .union([z.number(), z.string().regex(/^\d+$/, "Enter minutes"), z.literal(""), z.null()])
  .transform((v) => (v === "" || v === null ? null : Number(v)))
  .pipe(z.number().int().min(0).max(24 * 60, "At most 24 hours").nullable())
  .optional();

export const relatedRecordSchema = z.object({ entityType: z.enum(ACTIVITY_PARENT_TYPES), entityId: uuid });

const commonFields = {
  subject: z.string().trim().min(1, "Subject is required").max(200),
  description: optionalText(5000),
  priority: z.enum(ACTIVITY_PRIORITY_KEYS).optional(),
  outcome: optionalText(120),
  direction: blankToNull(z.enum(["INBOUND", "OUTBOUND"])),
  durationMinutes: duration,
  location: optionalText(300),
};

/**
 * Create. `mode: "schedule"` plans it (due date, assignee, reminder);
 * `mode: "log"` records something that already happened (saved completed,
 * at occurredDate/occurredTime — default now). Default mode follows the type.
 */
export const createActivitySchema = z
  .object({
    ...commonFields,
    type: z.enum(ACTIVITY_TYPE_KEYS),
    mode: z.enum(["schedule", "log"]).optional(),
    entityType: z.enum(ACTIVITY_PARENT_TYPES),
    entityId: uuid,
    /** Extra records to show it on (the record's company / contact are added automatically). */
    links: z.array(relatedRecordSchema).max(10).optional(),
    status: z.enum(["PENDING", "IN_PROGRESS"]).optional(),
    assignedToUserId: blankToNull(uuid),
    dueDate: blankToNull(isoDate),
    dueTime: blankToNull(hhmm),
    endTime: blankToNull(hhmm),
    reminderMinutes,
    occurredDate: blankToNull(isoDate),
    occurredTime: blankToNull(hhmm),
    /** Integrations (future email / WhatsApp / telephony) — idempotent per source + externalRef. */
    source: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,39}$/, "Use an UPPER_CASE source key").optional(),
    externalRef: z.string().trim().min(1).max(200).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((v) => !v.dueTime || v.dueDate, { message: "Choose a due date for the time", path: ["dueDate"] })
  .refine((v) => !v.endTime || v.dueTime, { message: "Set a start time first", path: ["endTime"] })
  .refine((v) => !v.endTime || !v.dueTime || v.endTime >= v.dueTime, { message: "End must be after the start", path: ["endTime"] })
  .refine((v) => v.reminderMinutes === null || v.reminderMinutes === undefined || v.dueDate, { message: "A reminder needs a due date", path: ["reminderMinutes"] })
  .refine((v) => !v.externalRef || v.source, { message: "externalRef needs a source", path: ["source"] });
export type CreateActivityInput = z.infer<typeof createActivitySchema>;

/** Edit. Due date / assignee changes are recorded as a reschedule / assignment. Completion has its own action. */
export const updateActivitySchema = z
  .object({
    ...commonFields,
    subject: commonFields.subject.optional(),
    version,
    status: z.enum(["PENDING", "IN_PROGRESS"]).optional(),
    assignedToUserId: blankToNull(uuid),
    dueDate: blankToNull(isoDate),
    dueTime: blankToNull(hhmm),
    endTime: blankToNull(hhmm),
    reminderMinutes,
  })
  .strict()
  .refine((v) => !v.endTime || !v.dueTime || v.endTime >= v.dueTime, { message: "End must be after the start", path: ["endTime"] });
export type UpdateActivityInput = z.infer<typeof updateActivitySchema>;

export const completeActivitySchema = z.object({
  version: version.optional(),
  outcome: optionalText(120),
  note: optionalText(2000),
  completedDate: blankToNull(isoDate),
  completedTime: blankToNull(hhmm),
});
export const rescheduleActivitySchema = z.object({
  version: version.optional(),
  dueDate: isoDate,
  dueTime: blankToNull(hhmm),
  endTime: blankToNull(hhmm),
  reminderMinutes,
  reason: optionalText(300),
});
export const assignActivitySchema = z.object({ version: version.optional(), assignedToUserId: uuid.nullable() });
export const simpleActionSchema = z.object({ version: version.optional(), reason: optionalText(300) });

const bulkIds = z.array(uuid).min(1).max(200);
export const bulkActivitySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assign"), ids: bulkIds, assignedToUserId: uuid.nullable() }),
  z.object({ action: z.literal("complete"), ids: bulkIds, outcome: optionalText(120) }),
  z.object({ action: z.literal("reschedule"), ids: bulkIds, dueDate: isoDate, dueTime: blankToNull(hhmm) }),
  z.object({ action: z.literal("priority"), ids: bulkIds, priority: z.enum(ACTIVITY_PRIORITY_KEYS) }),
  z.object({ action: z.literal("cancel"), ids: bulkIds, reason: optionalText(300) }),
]);

// ── List filters ─────────────────────────────────────────────────

const csv = <T extends z.ZodType<unknown, string>>(item: T) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined))
    .pipe(z.array(item).max(100).optional());

export const ACTIVITY_SORT_FIELDS = ["dueAt", "createdAt", "completedAt", "updatedAt", "subject"] as const;
export type ActivitySortField = (typeof ACTIVITY_SORT_FIELDS)[number];

export const activityFilterSchema = z
  .object({
    types: csv(z.enum(ACTIVITY_TYPE_KEYS)),
    statuses: csv(z.enum(ACTIVITY_STATUS_KEYS)),
    priorities: csv(z.enum(ACTIVITY_PRIORITY_KEYS)),
    assignedToUserIds: csv(uuid),
    createdByUserIds: csv(uuid),
    unassigned: z.enum(["true"]).optional(),
    /** "mine" = assigned to me; "created" = created by me. */
    mine: z.enum(["assigned", "created"]).optional(),
    due: z.enum(DUE_FILTERS).optional(),
    dueFrom: isoDate.optional(),
    dueTo: isoDate.optional(),
    /** Activities shown on one record (via links). */
    entityType: z.enum(ACTIVITY_PARENT_TYPES).optional(),
    entityId: uuid.optional(),
    /** Only activities created on records of this type. */
    relatedType: z.enum(ACTIVITY_PARENT_TYPES).optional(),
    /** open = pending / in progress; closed = completed / cancelled. */
    state: z.enum(["open", "closed"]).optional(),
  })
  .refine((f) => !f.entityId || f.entityType, { message: "entityType is required with entityId", path: ["entityType"] })
  .refine((f) => !f.dueFrom || !f.dueTo || f.dueFrom <= f.dueTo, { message: "'From' must be on or before 'To'", path: ["dueFrom"] });
export type ActivityFilter = z.infer<typeof activityFilterSchema>;

const FILTER_KEYS = ["types", "statuses", "priorities", "assignedToUserIds", "createdByUserIds", "unassigned", "mine", "due", "dueFrom", "dueTo", "entityType", "entityId", "relatedType", "state"] as const;
export function parseActivityFilterParams(sp: URLSearchParams): ActivityFilter {
  const raw: Record<string, string> = {};
  for (const k of FILTER_KEYS) {
    const v = sp.get(k)?.trim();
    if (v) raw[k] = v;
  }
  return activityFilterSchema.parse(raw);
}

export const activitySortSchema = z.object({
  sortBy: z.enum(ACTIVITY_SORT_FIELDS).default("dueAt"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});
