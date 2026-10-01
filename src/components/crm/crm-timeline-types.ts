import type { CrmActivityTone } from "./CrmActivityItem";

/** Shape returned by GET /api/v1/crm/events (see presentCrmEvent). */
export interface CrmTimelineEventDto {
  id: string;
  entityType: string;
  entityId: string;
  eventType: string;
  summary: string | null;
  payload: unknown;
  correlationId: string | null;
  occurredAt: string;
  actor: { id: string; fullName: string } | null;
  label: string;
  category: string;
  entityLabel: string;
  entityHref: string | null;
}

const CATEGORY_TONES: Record<string, CrmActivityTone> = {
  created: "green",
  updated: "neutral",
  stage: "indigo",
  status: "amber",
  won: "green",
  lost: "red",
  assignment: "indigo",
  tag: "neutral",
  note: "neutral",
  converted: "green",
  archived: "amber",
  restored: "green",
  linked: "indigo",
};


export function crmEventTone(category: string): CrmActivityTone {
  return CATEGORY_TONES[category] ?? "neutral";
}
