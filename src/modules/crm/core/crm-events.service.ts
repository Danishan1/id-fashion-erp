import type { Prisma } from "@prisma/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { getRequestContext } from "@/core/logging/requestContext";
import type { ListQuery } from "@/lib/list-query";
import type { CrmActor } from "./crm-actor";
import { businessDayRange } from "./crm-dates";

import { crmEntityHref, crmEntityLabel } from "./crm-entity-types";
import { crmEventCategory, crmEventLabel } from "./crm-event-types";
import { CrmEventRepository, type CrmEventDb, type CrmEventRow } from "./crm-event.repository";
import { crmEventInputSchema, type CrmEventFilters, type CrmEventInput } from "./crm-event.schema";

/**
 * Turns a validated event input into the row to insert. Company and actor
 * always come from the actor (never from input), and the request's
 * correlation id is attached so an event can be traced back to the API call
 * and log lines that produced it.
 */
export function buildCrmEventData(actor: CrmActor, input: CrmEventInput): Prisma.CrmEventUncheckedCreateInput {
  const parsed = crmEventInputSchema.parse(input);
  return {
    companyId: actor.companyId,
    actorUserId: actor.userId,
    entityType: parsed.entityType as Prisma.CrmEventUncheckedCreateInput["entityType"],
    entityId: parsed.entityId,
    eventType: parsed.eventType,
    summary: parsed.summary ?? null,
    payload: (parsed.payload as Prisma.InputJsonValue | undefined) ?? undefined,
    correlationId: getRequestContext()?.requestId ?? null,
  };
}

/** Writes one event. Prefer `runCrmMutation` (crm-mutation.ts) inside services so
 * the event commits with the change it describes; use this directly only
 * when there is no surrounding mutation. */
export async function recordCrmEvent(actor: CrmActor, input: CrmEventInput, db?: CrmEventDb) {
  return CrmEventRepository.create(buildCrmEventData(actor, input), db);
}

/** Timeline row as returned to the UI: raw event + display fields. */
export function presentCrmEvent(row: CrmEventRow) {
  return {
    ...row,
    label: crmEventLabel(row.eventType),
    category: crmEventCategory(row.eventType),
    entityLabel: crmEntityLabel(row.entityType),
    entityHref: crmEntityHref(row.entityType, row.entityId),
  };
}
export type CrmTimelineEvent = ReturnType<typeof presentCrmEvent>;

/**
 * `relatedEntityIds` widens a record timeline to records folded into it
 * (e.g. contacts merged into a contact), so its history stays complete.
 */
export function buildCrmEventWhere(companyId: string, filters: CrmEventFilters, search?: string, relatedEntityIds: string[] = []): Prisma.CrmEventWhereInput {
  const where: Prisma.CrmEventWhereInput = { companyId };
  if (filters.entityType) where.entityType = filters.entityType as Prisma.CrmEventWhereInput["entityType"];
  if (filters.entityId) where.entityId = relatedEntityIds.length ? { in: [filters.entityId, ...relatedEntityIds] } : filters.entityId;
  if (filters.eventType) where.eventType = filters.eventType;
  if (filters.actorUserId) where.actorUserId = filters.actorUserId;
  const occurred = businessDayRange({ from: filters.from, to: filters.to });
  if (occurred) where.occurredAt = occurred;
  if (search) {
    where.OR = [
      { summary: { contains: search, mode: "insensitive" } },
      { eventType: { contains: search, mode: "insensitive" } },
    ];
  }
  return where;
}

/** Newest first by default; `?sortOrder=asc` gives oldest first. */
export async function listCrmEvents(companyId: string, filters: CrmEventFilters, query: ListQuery, relatedEntityIds: string[] = []) {
  const where = buildCrmEventWhere(companyId, filters, query.search, relatedEntityIds);
  const [rows, totalCount] = await Promise.all([
    CrmEventRepository.findMany(where, query.skip, query.take, query.sortOrder),
    CrmEventRepository.count(where),
  ]);
  return { data: rows.map(presentCrmEvent), totalCount };
}

export async function getCrmEventById(companyId: string, id: string) {
  const row = await CrmEventRepository.findById(companyId, id);
  if (!row) throw new BusinessRuleError("NOT_FOUND", "CRM event not found.", { id });
  return presentCrmEvent(row);
}
