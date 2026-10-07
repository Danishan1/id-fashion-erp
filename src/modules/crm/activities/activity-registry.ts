/**
 * Client-safe vocabulary for CRM activities (Phase 09). Types, statuses,
 * priorities, reminder offsets and directions are defined once here and
 * stored as plain text, so a new activity type (e.g. "Demo", "Site visit")
 * is one entry — no migration and no UI change. Outcomes are admin-managed
 * option lists (Settings → Form options).
 *
 * `schedulable` types can be planned ahead (due date, assignee, reminder,
 * status); `loggable` types can be recorded as something that already
 * happened (saved as COMPLETED at the time it happened). Notes are not
 * stored here — they stay in the existing CRM notes (crm_notes).
 */

import { APPOINTMENT_OPTION_LISTS, APPOINTMENT_STATUSES, DEFAULT_APPOINTMENT_OPTION_VALUES } from "../appointments/appointment-registry";

export const ACTIVITY_TYPES = {
  TASK: { label: "Task", plural: "Tasks", icon: "☑", schedulable: true, loggable: false, outcomeList: null, hasEnd: false, hasDirection: false, logEvent: null },
  CALL: { label: "Call", plural: "Calls", icon: "☎", schedulable: true, loggable: true, outcomeList: "activity_call_outcome", hasEnd: false, hasDirection: true, logEvent: "activity.call_logged" },
  MEETING: { label: "Meeting", plural: "Meetings", icon: "👥", schedulable: true, loggable: true, outcomeList: "activity_meeting_outcome", hasEnd: true, hasDirection: false, logEvent: "activity.meeting_logged" },
  APPOINTMENT: { label: "Appointment", plural: "Appointments", icon: "📅", schedulable: true, loggable: false, outcomeList: "activity_meeting_outcome", hasEnd: true, hasDirection: false, logEvent: null },
  EMAIL: { label: "Email", plural: "Emails", icon: "✉", schedulable: false, loggable: true, outcomeList: null, hasEnd: false, hasDirection: true, logEvent: "activity.message_logged" },
  SMS: { label: "SMS", plural: "SMS", icon: "💬", schedulable: false, loggable: true, outcomeList: null, hasEnd: false, hasDirection: true, logEvent: "activity.message_logged" },
  WHATSAPP: { label: "WhatsApp", plural: "WhatsApp messages", icon: "🟢", schedulable: false, loggable: true, outcomeList: null, hasEnd: false, hasDirection: true, logEvent: "activity.message_logged" },
  OTHER: { label: "Other", plural: "Other activities", icon: "•", schedulable: true, loggable: true, outcomeList: null, hasEnd: false, hasDirection: false, logEvent: "activity.logged" },
} as const;
export type ActivityType = keyof typeof ACTIVITY_TYPES;
export const ACTIVITY_TYPE_KEYS = Object.keys(ACTIVITY_TYPES) as [ActivityType, ...ActivityType[]];
export const SCHEDULABLE_TYPES = ACTIVITY_TYPE_KEYS.filter((t) => ACTIVITY_TYPES[t].schedulable);
export const LOGGABLE_TYPES = ACTIVITY_TYPE_KEYS.filter((t) => ACTIVITY_TYPES[t].loggable);
export const isActivityType = (v: unknown): v is ActivityType => typeof v === "string" && Object.prototype.hasOwnProperty.call(ACTIVITY_TYPES, v);
export const activityTypeLabel = (t: string) => (isActivityType(t) ? ACTIVITY_TYPES[t].label : t);

/**
 * Task-style statuses, plus the appointment lifecycle (Phase 10: SCHEDULED,
 * CONFIRMED, RESCHEDULED, NO_SHOW — used only by APPOINTMENT activities and
 * changed only through the appointment service).
 */
export const ACTIVITY_STATUSES = {
  PENDING: { label: "Pending", open: true },
  IN_PROGRESS: { label: "In progress", open: true },
  COMPLETED: { label: "Completed", open: false },
  CANCELLED: { label: "Cancelled", open: false },
  SCHEDULED: { label: APPOINTMENT_STATUSES.SCHEDULED.label, open: true },
  CONFIRMED: { label: APPOINTMENT_STATUSES.CONFIRMED.label, open: true },
  RESCHEDULED: { label: APPOINTMENT_STATUSES.RESCHEDULED.label, open: true },
  NO_SHOW: { label: APPOINTMENT_STATUSES.NO_SHOW.label, open: false },
} as const;
export type ActivityStatus = keyof typeof ACTIVITY_STATUSES;
export const ACTIVITY_STATUS_KEYS = Object.keys(ACTIVITY_STATUSES) as [ActivityStatus, ...ActivityStatus[]];
export const OPEN_STATUSES = ACTIVITY_STATUS_KEYS.filter((s) => ACTIVITY_STATUSES[s].open);
export const CLOSED_STATUSES = ACTIVITY_STATUS_KEYS.filter((s) => !ACTIVITY_STATUSES[s].open);
export const isOpenStatus = (s: string) => Object.prototype.hasOwnProperty.call(ACTIVITY_STATUSES, s) && ACTIVITY_STATUSES[s as ActivityStatus].open;

export const ACTIVITY_PRIORITIES = {
  LOW: { label: "Low", rank: 1, tone: "neutral" },
  NORMAL: { label: "Normal", rank: 2, tone: "indigo" },
  HIGH: { label: "High", rank: 3, tone: "amber" },
  URGENT: { label: "Urgent", rank: 4, tone: "red" },
} as const;
export type ActivityPriority = keyof typeof ACTIVITY_PRIORITIES;
export const ACTIVITY_PRIORITY_KEYS = Object.keys(ACTIVITY_PRIORITIES) as [ActivityPriority, ...ActivityPriority[]];

/** Reminder choices: minutes before the due time (0 = at due time). */
export const REMINDER_OPTIONS = [
  { minutes: 0, label: "At due time" },
  { minutes: 5, label: "5 minutes before" },
  { minutes: 15, label: "15 minutes before" },
  { minutes: 30, label: "30 minutes before" },
  { minutes: 60, label: "1 hour before" },
  { minutes: 1440, label: "1 day before" },
] as const;
export const REMINDER_MINUTES = REMINDER_OPTIONS.map((o) => o.minutes) as number[];
export const reminderLabel = (m: number | null | undefined) => (m === null || m === undefined ? "No reminder" : (REMINDER_OPTIONS.find((o) => o.minutes === m)?.label ?? `${m} minutes before`));
/** All-day items remind relative to this business-time hour on the due date. */
export const ALL_DAY_REMINDER_HOUR = 9;

export const ACTIVITY_DIRECTIONS = { OUTBOUND: "Outgoing", INBOUND: "Incoming" } as const;
export type ActivityDirection = keyof typeof ACTIVITY_DIRECTIONS;

/** Derived (never stored) due state, in the business time zone. */
export const DUE_STATES = {
  OVERDUE: { label: "Overdue", tone: "red" },
  DUE_TODAY: { label: "Due today", tone: "amber" },
  DUE_TOMORROW: { label: "Due tomorrow", tone: "indigo" },
  UPCOMING: { label: "Upcoming", tone: "neutral" },
  NO_DUE_DATE: { label: "No due date", tone: "neutral" },
  COMPLETED: { label: "Completed", tone: "green" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  NO_SHOW: { label: "No show", tone: "red" },
} as const;
export type DueState = keyof typeof DUE_STATES;

/** Quick filters shared by the activity list and My Tasks. */
export const DUE_FILTERS = ["overdue", "today", "tomorrow", "upcoming", "no_due_date", "completed"] as const;
export type DueFilter = (typeof DUE_FILTERS)[number];

/** Admin-managed outcome suggestions (crm_option_values). */
export const ACTIVITY_OPTION_LISTS = {
  activity_call_outcome: { label: "Call outcomes", help: "Offered when a call is logged or completed — e.g. Connected, No answer, Callback requested." },
  activity_meeting_outcome: { label: "Meeting outcomes", help: "Offered when a meeting or appointment is logged or completed — e.g. Positive, Sample requested, Follow-up needed." },
  ...APPOINTMENT_OPTION_LISTS,
} as const;
export type ActivityOptionListKey = keyof typeof ACTIVITY_OPTION_LISTS;
export const DEFAULT_ACTIVITY_OPTION_VALUES: Record<ActivityOptionListKey, string[]> = {
  activity_call_outcome: ["Connected", "No answer", "Busy", "Callback requested", "Interested", "Not interested", "Wrong number", "Other"],
  activity_meeting_outcome: ["Positive", "Sample requested", "Quotation requested", "Follow-up needed", "Not interested", "Rescheduled by customer", "Other"],
  ...DEFAULT_APPOINTMENT_OPTION_VALUES,
};

/** Where an activity can be created / shown (CRM record types). */
export const ACTIVITY_PARENT_TYPES = ["LEAD", "CONTACT", "COMPANY", "OPPORTUNITY"] as const;
export type ActivityParentType = (typeof ACTIVITY_PARENT_TYPES)[number];
