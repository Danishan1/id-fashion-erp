import type { DueState } from "@/modules/crm/activities/activity-registry";

/** JSON shapes of /api/v1/crm/activities (dates as ISO strings). */

export interface ActivityLinkDto {
  entityType: "LEAD" | "CONTACT" | "COMPANY" | "OPPORTUNITY";
  entityId: string;
  isPrimary: boolean;
  label: string;
  href: string | null;
  archived: boolean;
}

export interface ActivityDto {
  id: string;
  type: string;
  typeLabel: string;
  subject: string;
  description: string | null;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  entityType: string;
  entityId: string;
  assignedToUserId: string | null;
  assignedTo: { id: string; fullName: string; status: string } | null;
  createdBy: { id: string; fullName: string };
  createdByUserId: string;
  dueAt: string | null;
  allDay: boolean;
  endAt: string | null;
  end: string | null;
  due: { date: string; time: string | null } | null;
  dueState: DueState;
  originalDueAt: string | null;
  rescheduleCount: number;
  reminderOffsetMinutes: number | null;
  reminderAt: string | null;
  reminderState: "PENDING" | "SENT" | "CANCELLED" | null;
  reminderSentAt: string | null;
  outcome: string | null;
  direction: "INBOUND" | "OUTBOUND" | null;
  durationMinutes: number | null;
  location: string | null;
  completedAt: string | null;
  completedByName: string | null;
  updatedByName: string | null;
  source: string;
  metadata: Record<string, unknown>;
  version: number;
  createdAt: string;
  updatedAt: string;
  links: ActivityLinkDto[];
  primary: ActivityLinkDto | null;
  permissions: { edit: boolean; complete: boolean; reopen: boolean; delete: boolean };
}

export interface ActivityMetaDto {
  types: { key: string; label: string; plural: string; icon: string; schedulable: boolean; loggable: boolean; outcomeList: string | null; hasEnd: boolean; hasDirection: boolean }[];
  statuses: { key: string; label: string; open: boolean }[];
  priorities: { key: string; label: string; rank: number; tone: string }[];
  reminders: readonly { minutes: number; label: string }[];
  outcomes: Record<string, string[]>;
}

export interface UserOptionDto {
  id: string;
  fullName: string;
}

/** The record an activity is being added from (pre-fills the composer). */
export interface ActivityParentRef {
  entityType: "LEAD" | "CONTACT" | "COMPANY" | "OPPORTUNITY";
  entityId: string;
  label: string;
}

export const ACTIVITIES_API = "/api/v1/crm/activities";
