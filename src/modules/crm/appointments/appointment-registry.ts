/**
 * Client-safe appointment vocabulary (Phase 10). An appointment is a CRM
 * activity of type APPOINTMENT (crm_activities); its `status` column holds the
 * appointment lifecycle below instead of the task statuses. Every status
 * change goes through crm-appointments.service, which checks it against
 * APPOINTMENT_TRANSITIONS — the one place the lifecycle is defined.
 *
 *   SCHEDULED ──confirm──▶ CONFIRMED ──complete──▶ COMPLETED
 *       │  ╲                   │
 *       │   reschedule ──▶ RESCHEDULED (moved; confirm again)
 *       ├──cancel──▶ CANCELLED
 *       └──no-show─▶ NO_SHOW
 *
 * COMPLETED, CANCELLED and NO_SHOW are final (history is kept; a new
 * appointment is booked instead of reopening one).
 */
export const APPOINTMENT_STATUSES = {
  SCHEDULED: { label: "Scheduled", tone: "indigo", open: true },
  CONFIRMED: { label: "Confirmed", tone: "green", open: true },
  RESCHEDULED: { label: "Rescheduled", tone: "amber", open: true },
  COMPLETED: { label: "Completed", tone: "green", open: false },
  CANCELLED: { label: "Cancelled", tone: "neutral", open: false },
  NO_SHOW: { label: "No show", tone: "red", open: false },
} as const;
export type AppointmentStatus = keyof typeof APPOINTMENT_STATUSES;
export const APPOINTMENT_STATUS_KEYS = Object.keys(APPOINTMENT_STATUSES) as [AppointmentStatus, ...AppointmentStatus[]];
export const OPEN_APPOINTMENT_STATUSES = APPOINTMENT_STATUS_KEYS.filter((s) => APPOINTMENT_STATUSES[s].open);
export const isAppointmentStatus = (s: unknown): s is AppointmentStatus => typeof s === "string" && Object.prototype.hasOwnProperty.call(APPOINTMENT_STATUSES, s);
export const isOpenAppointmentStatus = (s: string) => isAppointmentStatus(s) && APPOINTMENT_STATUSES[s].open;
export const appointmentStatusLabel = (s: string) => (isAppointmentStatus(s) ? APPOINTMENT_STATUSES[s].label : s);

/** Allowed status changes. Rescheduling an open appointment always lands in RESCHEDULED. */
export const APPOINTMENT_TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  SCHEDULED: ["CONFIRMED", "RESCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW"],
  CONFIRMED: ["RESCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW"],
  RESCHEDULED: ["CONFIRMED", "RESCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export function canTransition(from: string, to: AppointmentStatus): boolean {
  return isAppointmentStatus(from) && APPOINTMENT_TRANSITIONS[from].includes(to);
}

/** User actions and the status each one leads to. */
export const APPOINTMENT_ACTIONS = {
  confirm: { label: "Confirm", to: "CONFIRMED" },
  reschedule: { label: "Reschedule", to: "RESCHEDULED" },
  complete: { label: "Complete", to: "COMPLETED" },
  cancel: { label: "Cancel", to: "CANCELLED" },
  no_show: { label: "Mark no-show", to: "NO_SHOW" },
} as const satisfies Record<string, { label: string; to: AppointmentStatus }>;
export type AppointmentAction = keyof typeof APPOINTMENT_ACTIONS;
export const APPOINTMENT_ACTION_KEYS = Object.keys(APPOINTMENT_ACTIONS) as AppointmentAction[];

/** Actions valid for a status (edit and reassign are allowed while the appointment is open). */
export function allowedAppointmentActions(status: string): { actions: AppointmentAction[]; edit: boolean; assign: boolean } {
  const open = isOpenAppointmentStatus(status);
  return { actions: APPOINTMENT_ACTION_KEYS.filter((a) => canTransition(status, APPOINTMENT_ACTIONS[a].to)), edit: open, assign: open };
}

/** Admin-managed suggestion lists (Settings → Form options). */
export const APPOINTMENT_OPTION_LISTS = {
  appointment_type: { label: "Appointment types", help: "Offered on the appointment form and calendar filter — e.g. Product demo, Site visit, Sample review." },
  appointment_cancel_reason: { label: "Appointment cancellation reasons", help: "Offered when an appointment is cancelled — e.g. Customer unavailable, Internal conflict." },
  appointment_no_show_reason: { label: "Appointment no-show reasons", help: "Offered when an appointment is marked no-show — e.g. Customer did not attend." },
} as const;
export type AppointmentOptionListKey = keyof typeof APPOINTMENT_OPTION_LISTS;
export const DEFAULT_APPOINTMENT_OPTION_VALUES: Record<AppointmentOptionListKey, string[]> = {
  appointment_type: ["Product demo", "Sales meeting", "Commercial discussion", "Site / factory visit", "Sample review", "Other"],
  appointment_cancel_reason: ["Customer unavailable", "Customer requested cancellation", "Internal conflict", "Other"],
  appointment_no_show_reason: ["Customer did not attend", "Employee unavailable", "Other"],
};

/** Appointment length limits (minutes). */
export const MIN_APPOINTMENT_MINUTES = 5;
export const MAX_APPOINTMENT_MINUTES = 7 * 24 * 60;
export const DEFAULT_APPOINTMENT_MINUTES = 60;

/**
 * Two time ranges overlap when each starts before the other ends. Touching
 * ranges (10:00–11:00 and 11:00–12:00) do not overlap.
 */
export function rangesOverlap(a: { start: Date | number; end: Date | number }, b: { start: Date | number; end: Date | number }): boolean {
  return +a.start < +b.end && +b.start < +a.end;
}

/** Automation events (crm_events.event_type); payload: AppointmentEventPayload. Never rename — add new ones. */
export const APPOINTMENT_EVENT_TYPES = [
  "appointment.created",
  "appointment.updated",
  "appointment.assigned",
  "appointment.confirmed",
  "appointment.rescheduled",
  "appointment.cancelled",
  "appointment.completed",
  "appointment.no_show",
] as const;
export type AppointmentEventType = (typeof APPOINTMENT_EVENT_TYPES)[number];

/** Payload of every appointment.* event (version 1). The crm_events row id is the event id. */
export interface AppointmentEventPayload {
  schemaVersion: 1;
  appointmentId: string;
  contactId: string | null;
  companyId: string | null;
  opportunityId: string | null;
  leadId: string | null;
  employeeId: string | null;
  status: string;
  previousStatus: string | null;
  startAt: string | null;
  endAt: string | null;
  timezone: string | null;
  location: string | null;
  hasVideoLink: boolean;
  appointmentType: string | null;
  actorId: string | null;
  occurredAt: string;
  [extra: string]: unknown;
}
