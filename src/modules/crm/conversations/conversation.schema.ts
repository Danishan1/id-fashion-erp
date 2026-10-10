import { z } from "zod";
import { CHANNEL_TYPES, CONVERSATION_STATUS_KEYS, INBOX_FOLDER_KEYS, MAX_BODY_LENGTH, type ConversationStatus, type InboxFolder } from "./conversation-registry";
import { ACTIVITY_PRIORITY_KEYS, REMINDER_MINUTES } from "../activities/activity-registry";

/** Client-safe (zod only): inbox filters, conversation actions and channel settings. */

const uuid = z.string().uuid();
const version = z.number().int().min(1);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a valid time (HH:mm)");
const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal("")).nullable();
/** undefined = leave unchanged, null / "" = clear, uuid = set. */
const relink = z.union([uuid, z.literal(""), z.null()]).transform((v) => (v ? v : null)).optional();
const blankToNull = <T extends z.ZodTypeAny>(t: T) => z.union([t, z.literal("")]).transform((v) => (v === "" ? null : v)).nullable().optional();

// ── Inbox ───────────────────────────────────────────────────────

const csvList = () =>
  z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").map((x) => x.trim()).filter(Boolean) : []));

export const conversationFilterSchema = z
  .object({
    folder: z.enum(INBOX_FOLDER_KEYS).optional().default("all"),
    /** Statuses to show; default open + pending. */
    statuses: csvList().pipe(z.array(z.enum(CONVERSATION_STATUS_KEYS))),
    channelIds: csvList().pipe(z.array(uuid).max(20)),
    channelTypes: csvList().pipe(z.array(z.enum(CHANNEL_TYPES))),
    assignedToUserId: uuid.optional(),
    contactId: uuid.optional(),
    companyId: uuid.optional(),
    opportunityId: uuid.optional(),
    unread: z.enum(["true", "false"]).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .refine((f) => !f.from || !f.to || f.from <= f.to, { message: "The start date must be before the end date", path: ["to"] });
export type ConversationFilter = z.infer<typeof conversationFilterSchema>;

export function parseConversationFilterParams(params: URLSearchParams) {
  const raw: Record<string, string> = {};
  for (const k of ["folder", "statuses", "channelIds", "channelTypes", "assignedToUserId", "contactId", "companyId", "opportunityId", "unread", "from", "to"]) {
    const v = params.get(k);
    if (v) raw[k] = v;
  }
  return conversationFilterSchema.parse(raw);
}

/** Statuses an inbox query shows when none are chosen. Record panels show everything but archived. */
export const DEFAULT_INBOX_STATUSES: ConversationStatus[] = ["OPEN", "PENDING"];
export const CONVERSATION_SORT_FIELDS = ["lastMessageAt", "createdAt"] as const;
export type ConversationSortField = (typeof CONVERSATION_SORT_FIELDS)[number];
export type { InboxFolder };

export const messagePageSchema = z.object({
  /** Cursor from the previous page (`nextCursor`); omit for the latest messages. */
  before: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

// ── Conversation actions ────────────────────────────────────────

export const sendMessageSchema = z
  .object({
    /** Client-generated id: re-submitting the same id never sends twice. */
    clientMessageId: uuid.optional(),
    subject: optionalText(300),
    body: z.string().max(MAX_BODY_LENGTH, `At most ${MAX_BODY_LENGTH} characters`).default(""),
    /** Phase 12: the template (and exact version) the reply was written from. Both or neither. */
    templateId: uuid.optional(),
    templateVersionId: uuid.optional(),
  })
  .strict()
  .refine((v) => Boolean(v.templateId) === Boolean(v.templateVersionId), { message: "templateId and templateVersionId go together.", path: ["templateVersionId"] });
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const markReadSchema = z.object({ upToMessageId: uuid.optional() }).strict();

export const assignConversationSchema = z.object({ version, assignedToUserId: z.union([uuid, z.literal(""), z.null()]).transform((v) => (v ? v : null)) }).strict();

export const conversationStatusSchema = z.object({ version, status: z.enum(CONVERSATION_STATUS_KEYS) }).strict();

export const updateConversationSchema = z.object({ version, subject: optionalText(300) }).strict();

export const linkConversationSchema = z
  .object({ version, contactId: relink, companyId: relink, opportunityId: relink })
  .strict()
  .refine((v) => v.contactId !== undefined || v.companyId !== undefined || v.opportunityId !== undefined, { message: "Choose a contact, company or opportunity", path: ["contactId"] });
export type LinkConversationInput = z.infer<typeof linkConversationSchema>;

/** Create a contact from an unmatched conversation (Phase 04 duplicate rules apply), then link it. */
export const createContactFromConversationSchema = z
  .object({
    version,
    firstName: z.string().trim().min(1, "First name is required").max(100),
    lastName: optionalText(100),
    email: optionalText(254),
    mobile: optionalText(40),
    whatsapp: optionalText(40),
    crmCompanyId: blankToNull(uuid),
    confirmDuplicate: z.boolean().optional(),
  })
  .strict();

export const conversationTaskSchema = z
  .object({
    subject: z.string().trim().min(1, "Subject is required").max(200),
    description: optionalText(5000),
    priority: z.enum(ACTIVITY_PRIORITY_KEYS).optional(),
    assignedToUserId: blankToNull(uuid),
    dueDate: blankToNull(isoDate),
    dueTime: blankToNull(hhmm),
    reminderMinutes: z
      .union([z.number(), z.string().regex(/^\d+$/), z.literal(""), z.null()])
      .transform((v) => (v === "" || v === null ? null : Number(v)))
      .refine((v) => v === null || REMINDER_MINUTES.includes(v), "Choose a reminder from the list")
      .optional(),
    /** The message the task came from (quoted in the task description). */
    messageId: uuid.optional(),
  })
  .strict();

// ── Channels (CRM Settings) ─────────────────────────────────────

export const createChannelSchema = z
  .object({
    channelType: z.enum(CHANNEL_TYPES),
    name: z.string().trim().min(1, "Name is required").max(80),
    provider: z.string().trim().min(1).max(40).default("generic"),
    address: optionalText(200),
    config: z.record(z.string(), z.unknown()).optional(),
    defaultAssigneeUserId: blankToNull(uuid),
  })
  .strict();

export const updateChannelSchema = z
  .object({
    version,
    name: z.string().trim().min(1, "Name is required").max(80).optional(),
    address: optionalText(200),
    config: z.record(z.string(), z.unknown()).optional(),
    defaultAssigneeUserId: blankToNull(uuid),
    status: z.enum(["ACTIVE", "PAUSED"]).optional(),
  })
  .strict();
