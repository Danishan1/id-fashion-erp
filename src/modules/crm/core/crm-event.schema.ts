import { z } from "zod";
import { CRM_ENTITY_TYPES } from "./crm-entity-types";
import { isCrmEventType } from "./crm-event-types";

const entityTypeSchema = z.enum(CRM_ENTITY_TYPES as [string, ...string[]]);
const eventTypeSchema = z.string().refine(isCrmEventType, { message: "Unknown CRM event type." });

/** What a service passes when recording an event. Company, actor and
 * correlation id are filled in from the actor/request, never from input. */
export const crmEventInputSchema = z.object({
  entityType: entityTypeSchema,
  entityId: z.string().uuid(),
  eventType: eventTypeSchema,
  summary: z.string().trim().max(500).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});
export type CrmEventInput = z.infer<typeof crmEventInputSchema>;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
  .optional();

/** Query-string filters accepted by GET /api/v1/crm/events. */
export const crmEventFilterSchema = z
  .object({
    entityType: entityTypeSchema.optional(),
    entityId: z.string().uuid().optional(),
    eventType: eventTypeSchema.optional(),
    actorUserId: z.string().uuid().optional(),
    from: isoDate,
    to: isoDate,
  })
  .refine((f) => !f.entityId || f.entityType, { message: "entityType is required with entityId.", path: ["entityType"] })
  .refine((f) => !f.from || !f.to || f.from <= f.to, { message: "'From' must be on or before 'To'.", path: ["from"] });
export type CrmEventFilters = z.infer<typeof crmEventFilterSchema>;

/** Reads the filter keys out of URLSearchParams, ignoring blanks. */
export function parseCrmEventFilters(searchParams: URLSearchParams): CrmEventFilters {
  const pick = (key: string) => searchParams.get(key)?.trim() || undefined;
  return crmEventFilterSchema.parse({
    entityType: pick("entityType"),
    entityId: pick("entityId"),
    eventType: pick("eventType"),
    actorUserId: pick("actorUserId"),
    from: pick("from"),
    to: pick("to"),
  });
}
