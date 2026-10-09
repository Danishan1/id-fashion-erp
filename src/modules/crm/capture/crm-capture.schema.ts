import { z } from "zod";
import { DUPLICATE_POLICIES } from "../imports/crm-import.schema";

const defaults = {
  defaultSourceId: z.string().uuid().nullable().optional(),
  defaultOwnerUserId: z.string().uuid().nullable().optional(),
  duplicatePolicy: z.enum(DUPLICATE_POLICIES).optional(),
};

export const createApiKeySchema = z
  .object({ name: z.string().trim().min(1, "Name is required").max(80), expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), ...defaults })
  .strict();
export const updateApiKeySchema = z.object({ name: z.string().trim().min(1).max(80).optional(), ...defaults }).strict();

/** Lead field (catalog key or cf:<key>) → dotted path in the webhook JSON, e.g. { "email": "contact.email" }. */
export const fieldMappingSchema = z.record(z.string().max(80), z.string().trim().max(200)).refine((m) => Object.keys(m).length <= 80, "Too many mapped fields.");

export const createWebhookSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(80),
    provider: z.string().trim().default("generic"),
    fieldMapping: fieldMappingSchema.optional(),
    ...defaults,
  })
  .strict();
export const updateWebhookSchema = z
  .object({ name: z.string().trim().min(1).max(80).optional(), fieldMapping: fieldMappingSchema.optional(), isActive: z.boolean().optional(), ...defaults })
  .strict();

/** POST /api/v1/crm/leads/ingest body. Lead fields may be flat or under `lead`. */
export const ingestRequestSchema = z
  .object({
    lead: z.record(z.string(), z.unknown()).optional(),
    customFields: z.record(z.string(), z.unknown()).optional(),
    channel: z.enum(["API", "WEBSITE_FORM"]).optional(),
    externalLeadId: z.string().trim().min(1).max(200).optional(),
    externalEventId: z.string().trim().min(1).max(200).optional(),
    duplicatePolicy: z.enum(DUPLICATE_POLICIES).optional(),
  })
  .passthrough();

export const ingestEventReviewSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("CREATE") }),
  z.object({ action: z.literal("SKIP") }),
  z.object({ action: z.literal("UPDATE"), leadId: z.string().uuid().optional() }),
]);

export const ingestEventListQuerySchema = z.object({
  status: z.enum(["RECEIVED", "PROCESSED", "FLAGGED", "FAILED"]).optional(),
  channel: z.enum(["API", "WEBSITE_FORM", "WEBHOOK", "INTEGRATION"]).optional(),
});
