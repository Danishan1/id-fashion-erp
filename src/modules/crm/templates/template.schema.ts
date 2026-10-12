import { z } from "zod";
import { CHANNEL_TYPES } from "@/core/communication/CommunicationProvider";
import { TEMPLATE_MAX_BODY, TEMPLATE_MAX_SUBJECT, TEMPLATE_STATUS_KEYS } from "./template-registry";

const uuid = z.string().uuid();

/** CRM records a template is rendered against (see template-context.ts). */
export const templateContextRefsSchema = z
  .object({
    contactId: uuid.optional(),
    companyId: uuid.optional(),
    opportunityId: uuid.optional(),
    leadId: uuid.optional(),
    appointmentId: uuid.optional(),
    conversationId: uuid.optional(),
    /** The sender. Defaults to the acting user. */
    userId: uuid.optional(),
  })
  .strict();
export type TemplateContextRefs = z.infer<typeof templateContextRefsSchema>;

const version = z.number().int().min(1);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .optional()
    .or(z.literal(""))
    .nullable()
    .transform((v) => (v === undefined ? undefined : v ? v : null));

/** Provider-neutral key/value settings (validated per channel by the template engine). */
const providerMetadata = z
  .record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,40}$/), z.string().trim().max(200))
  .refine((r) => Object.keys(r).length <= 10, "At most 10 provider settings")
  .transform((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== "")));

const name = z.string().trim().min(1, "Name is required").max(120, "At most 120 characters");
const body = z.string().max(TEMPLATE_MAX_BODY, `At most ${TEMPLATE_MAX_BODY.toLocaleString("en-IN")} characters`);
const subject = z
  .string()
  .max(TEMPLATE_MAX_SUBJECT, `At most ${TEMPLATE_MAX_SUBJECT} characters`)
  .optional()
  .nullable()
  .transform((v) => (v === undefined ? undefined : v?.trim() ? v : null));

export const createTemplateSchema = z
  .object({
    name,
    channelType: z.enum(CHANNEL_TYPES),
    categoryId: uuid.optional().or(z.literal("")).nullable().transform((v) => v || null),
    description: optionalText(500),
    subject,
    body,
    providerMetadata: providerMetadata.optional().default({}),
    changeNote: optionalText(200),
  })
  .strict();
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;

/** Details and/or content. Changing subject, body or provider settings saves a new version. */
export const updateTemplateSchema = z
  .object({
    version,
    name: name.optional(),
    categoryId: uuid.optional().or(z.literal("")).nullable().transform((v) => (v === undefined ? undefined : v || null)),
    description: optionalText(500),
    subject,
    body: body.optional(),
    providerMetadata: providerMetadata.optional(),
    changeNote: optionalText(200),
  })
  .strict();
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;

export const duplicateTemplateSchema = z.object({ name: name.optional() }).strict();
export const templateStatusActionSchema = z.object({ version }).strict();
export const restoreVersionSchema = z.object({ version, changeNote: optionalText(200) }).strict();

/** Render against built-in sample data (default) or real CRM records the user can see. */
export const previewContextSchema = z
  .object({
    sample: z.boolean().optional(),
    context: templateContextRefsSchema.optional(),
  })
  .strict();

export const previewStoredSchema = previewContextSchema.extend({ versionId: uuid.optional(), channelId: uuid.optional() }).strict();

/** Unsaved editor content (preview / validate before saving). */
export const draftContentSchema = previewContextSchema
  .extend({
    channelType: z.enum(CHANNEL_TYPES),
    subject,
    body,
    providerMetadata: providerMetadata.optional().default({}),
    categoryId: uuid.optional().or(z.literal("")).nullable().transform((v) => v || null),
    channelId: uuid.optional(),
  })
  .strict();

export const testSendSchema = previewContextSchema
  .extend({
    channelId: uuid,
    /** The one address to send to — typed by the user, never a list. */
    to: z.string().trim().min(3, "Enter where to send the test").max(254),
    versionId: uuid.optional(),
    /** Explicit confirmation from the UI ("Send test"). */
    confirm: z.literal(true, { message: "Confirm the test send." }),
  })
  .strict();

export const TEMPLATE_SORT_FIELDS = ["updatedAt", "createdAt", "name", "channelType", "status"] as const;
export const templateSortSchema = z.object({ sortBy: z.enum(TEMPLATE_SORT_FIELDS).default("updatedAt"), sortOrder: z.enum(["asc", "desc"]).default("desc") });

const csv = <T extends string>(values: readonly [T, ...T[]]) =>
  z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : []))
    .pipe(z.array(z.enum(values)));

export const templateFilterSchema = z.object({
  channels: csv(CHANNEL_TYPES),
  statuses: csv(TEMPLATE_STATUS_KEYS),
  categoryIds: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : []))
    .pipe(z.array(uuid)),
  /** "true": only templates usable for sending now (ACTIVE). */
  usable: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});
export type TemplateFilter = z.infer<typeof templateFilterSchema>;

export function parseTemplateFilterParams(sp: URLSearchParams): TemplateFilter {
  return templateFilterSchema.parse({ channels: sp.get("channels") ?? sp.get("channel") ?? undefined, statuses: sp.get("statuses") ?? undefined, categoryIds: sp.get("categoryIds") ?? undefined, usable: sp.get("usable") ?? undefined });
}
