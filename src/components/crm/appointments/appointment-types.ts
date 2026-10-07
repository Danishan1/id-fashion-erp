import type { AppointmentAction, AppointmentStatus } from "@/modules/crm/appointments/appointment-registry";
import type { ActivityDto, ActivityLinkDto } from "../activities/activity-types";

/** JSON shapes of /api/v1/crm/appointments (dates as ISO strings). */
export const APPOINTMENTS_API = "/api/v1/crm/appointments";

export interface ZonedPartsDto {
  date: string;
  time: string;
  weekday: number;
}

export interface AppointmentDto extends Omit<ActivityDto, "status" | "end"> {
  status: AppointmentStatus;
  title: string;
  statusLabel: string;
  timezone: string;
  startAt: string | null;
  endAt: string | null;
  start: ZonedPartsDto | null;
  end: ZonedPartsDto | null;
  durationMinutes: number | null;
  videoLink: string | null;
  appointmentType: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  noShowAt: string | null;
  noShowReason: string | null;
  confirmedByName: string | null;
  cancelledByName: string | null;
  noShowByName: string | null;
  relations: { contact: ActivityLinkDto | null; company: ActivityLinkDto | null; opportunity: ActivityLinkDto | null; lead: ActivityLinkDto | null };
  allowed: { actions: AppointmentAction[]; edit: boolean; assign: boolean };
}

export interface AppointmentMetaDto {
  statuses: { key: AppointmentStatus; label: string; tone: string; open: boolean; transitions: AppointmentStatus[] }[];
  actions: { key: AppointmentAction; label: string; to: AppointmentStatus }[];
  reminders: readonly { minutes: number; label: string }[];
  appointmentTypes: string[];
  cancelReasons: string[];
  noShowReasons: string[];
  outcomes: string[];
  defaultTimeZone: string;
  defaultDurationMinutes: number;
  canViewAll: boolean;
}

export interface ConflictDto {
  id: string | null;
  title: string;
  type: string;
  startAt: string | null;
  endAt: string | null;
  status: string;
  timezone: string | null;
}

/** Prefill when creating from a record page. */
export interface AppointmentPrefill {
  contact?: { id: string; label: string } | null;
  company?: { id: string; label: string } | null;
  opportunity?: { id: string; label: string } | null;
  startDate?: string;
  startTime?: string;
  assignedToUserId?: string;
}
