import type { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import type { CrmActor } from "../core/crm-actor";
import { defaultCrmDb, type CrmDb } from "../core/crm-db";
import { getCrmRecordScope } from "../core/crm-visibility";
import { conversationScopeWhere } from "./conversation-access";

/** Data access for channels, conversations, participants and messages (Phase 11). */

export const CHANNEL_SELECT = {
  id: true,
  companyId: true,
  channelType: true,
  name: true,
  provider: true,
  status: true,
  address: true,
  config: true,
  defaultAssigneeUserId: true,
  lastInboundAt: true,
  createdByUserId: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  defaultAssignee: { select: { id: true, fullName: true } },
  createdBy: { select: { id: true, fullName: true } },
} satisfies Prisma.CrmChannelSelect;
export type ChannelRow = Prisma.CrmChannelGetPayload<{ select: typeof CHANNEL_SELECT }>;

export const CONVERSATION_INCLUDE = {
  channel: { select: { id: true, name: true, channelType: true, provider: true, status: true, config: true, address: true } },
  contact: { select: { id: true, fullName: true, ownerUserId: true, createdByUserId: true, archivedAt: true, mergedIntoId: true, crmCompanyId: true, email: true, mobile: true, whatsapp: true, phone: true } },
  crmCompany: { select: { id: true, name: true, archivedAt: true, mergedIntoId: true } },
  opportunity: { select: { id: true, opportunityNumber: true, name: true, status: true, archivedAt: true, crmContactId: true, crmCompanyId: true } },
  assignedTo: { select: { id: true, fullName: true } },
} satisfies Prisma.CrmConversationInclude;
export type ConversationRow = Prisma.CrmConversationGetPayload<{ include: typeof CONVERSATION_INCLUDE }>;

export const MESSAGE_INCLUDE = {
  senderUser: { select: { id: true, fullName: true } },
  attachments: { select: { id: true, kind: true, fileName: true, mimeType: true, sizeBytes: true, attachmentId: true, providerMediaRef: true }, orderBy: { createdAt: "asc" } },
} satisfies Prisma.CrmMessageInclude;
export type MessageRow = Prisma.CrmMessageGetPayload<{ include: typeof MESSAGE_INCLUDE }>;

/** Keyset cursor for thread pages: newest first, strictly older than (time, id). */
export interface ThreadCursor {
  at: Date;
  id: string;
}
const olderThan = <F extends string>(field: F, c: ThreadCursor | null) => (c ? { OR: [{ [field]: { lt: c.at } }, { [field]: c.at, id: { lt: c.id } }] } : {});

export const CrmConversationRepository = {
  // ── Channels ────────────────────────────────────────────────
  listChannels(companyId: string) {
    return prisma.crmChannel.findMany({ where: { companyId }, select: CHANNEL_SELECT, orderBy: [{ status: "asc" }, { name: "asc" }] });
  },
  findChannel(companyId: string, id: string, db: CrmDb = defaultCrmDb) {
    return db.crmChannel.findFirst({ where: { id, companyId }, select: CHANNEL_SELECT });
  },
  /** Webhook delivery: by id only (the company comes from the channel), with the encrypted secret. */
  findChannelForDelivery(id: string) {
    return prisma.crmChannel.findUnique({ where: { id }, select: { ...CHANNEL_SELECT, secretEncrypted: true } });
  },
  channelSecret(companyId: string, id: string, db: CrmDb = defaultCrmDb) {
    return db.crmChannel.findFirst({ where: { id, companyId }, select: { secretEncrypted: true } });
  },
  channelNameTaken(companyId: string, name: string, exceptId?: string) {
    return prisma.crmChannel.findFirst({ where: { companyId, name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
  },
  createChannel(data: Prisma.CrmChannelUncheckedCreateInput, db: CrmDb = defaultCrmDb) {
    return db.crmChannel.create({ data, select: CHANNEL_SELECT });
  },
  updateChannelVersioned(id: string, version: number, data: Prisma.CrmChannelUncheckedUpdateManyInput, db: CrmDb = defaultCrmDb) {
    return db.crmChannel.updateMany({ where: { id, version }, data: { ...data, version: { increment: 1 } } });
  },

  // ── Conversations ───────────────────────────────────────────
  findOne(companyId: string, id: string, db: CrmDb = defaultCrmDb) {
    return db.crmConversation.findFirst({ where: { id, companyId }, include: CONVERSATION_INCLUDE });
  },
  findMany(where: Prisma.CrmConversationWhereInput, orderBy: Prisma.CrmConversationOrderByWithRelationInput[], skip: number, take: number) {
    return prisma.crmConversation.findMany({ where, orderBy, skip, take, include: CONVERSATION_INCLUDE });
  },
  count(where: Prisma.CrmConversationWhereInput) {
    return prisma.crmConversation.count({ where });
  },
  updateVersioned(id: string, version: number, data: Prisma.CrmConversationUncheckedUpdateManyInput, db: CrmDb = defaultCrmDb) {
    return db.crmConversation.updateMany({ where: { id, version }, data: { ...data, version: { increment: 1 } } });
  },
  /** System updates (inbound messages, delivery receipts): no version check, version still bumps so open screens notice. */
  update(id: string, data: Prisma.CrmConversationUncheckedUpdateInput, db: CrmDb = defaultCrmDb) {
    return db.crmConversation.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  },
  create(data: Prisma.CrmConversationUncheckedCreateInput, db: CrmDb = defaultCrmDb) {
    return db.crmConversation.create({ data });
  },
  findByThreadRef(channelId: string, threadRef: string, db: CrmDb = defaultCrmDb) {
    return db.crmConversation.findFirst({ where: { channelId, externalThreadRef: threadRef, status: { not: "ARCHIVED" } }, orderBy: { createdAt: "desc" } });
  },
  /** Latest non-archived conversation on this channel with this customer identity. */
  findLatestForIdentity(channelId: string, identifierKind: string, identifierKey: string, db: CrmDb = defaultCrmDb) {
    return db.crmConversation.findFirst({
      where: { channelId, status: { not: "ARCHIVED" }, participants: { some: { role: "CUSTOMER", identifierKind, identifierKey } } },
      orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    });
  },

  // ── Participants ────────────────────────────────────────────
  participants(conversationId: string, db: CrmDb = defaultCrmDb) {
    return db.crmConversationParticipant.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" }, include: { user: { select: { id: true, fullName: true } }, contact: { select: { id: true, fullName: true } } } });
  },
  /** Adds an identity / user once (partial unique indexes make concurrent inserts safe). */
  async ensureParticipant(data: Prisma.CrmConversationParticipantUncheckedCreateInput, db: CrmDb = defaultCrmDb) {
    const existing = await db.crmConversationParticipant.findFirst({
      where: data.userId ? { conversationId: data.conversationId, userId: data.userId } : { conversationId: data.conversationId, identifierKind: data.identifierKind ?? null, identifierKey: data.identifierKey ?? null },
    });
    if (existing) return existing;
    return db.crmConversationParticipant.create({ data });
  },
  /** Contacts already known for a provider identity (learned when a user linked an earlier conversation). */
  contactsForIdentity(companyId: string, channelId: string, identifierKind: string, identifierKey: string) {
    return prisma.crmConversationParticipant
      .findMany({ where: { companyId, channelId, identifierKind, identifierKey, contactId: { not: null } }, select: { contactId: true }, distinct: ["contactId"], take: 10 })
      .then((rows) => rows.map((r) => r.contactId as string));
  },

  // ── Messages ────────────────────────────────────────────────
  findMessage(companyId: string, id: string, db: CrmDb = defaultCrmDb) {
    return db.crmMessage.findFirst({ where: { id, companyId }, include: MESSAGE_INCLUDE });
  },
  findMessageByProviderId(channelId: string, providerMessageId: string, db: CrmDb = defaultCrmDb) {
    return db.crmMessage.findFirst({ where: { channelId, providerMessageId }, include: MESSAGE_INCLUDE });
  },
  messagesBefore(conversationId: string, cursor: ThreadCursor | null, take: number) {
    return prisma.crmMessage.findMany({ where: { conversationId, ...olderThan("occurredAt", cursor) }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take, include: MESSAGE_INCLUDE });
  },
  notesBefore(companyId: string, conversationId: string, cursor: ThreadCursor | null, take: number) {
    return prisma.crmNote.findMany({
      where: { companyId, entityType: "CONVERSATION", entityId: conversationId, deletedAt: null, ...olderThan("createdAt", cursor) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
      include: { createdBy: { select: { id: true, fullName: true } } },
    });
  },
  /** Conversation history shown inline in the thread (assignment, status, links) — not messages or notes. */
  systemEventsBefore(companyId: string, conversationId: string, eventTypes: string[], cursor: ThreadCursor | null, take: number) {
    return prisma.crmEvent.findMany({
      where: { companyId, entityType: "CONVERSATION", entityId: conversationId, eventType: { in: eventTypes }, ...olderThan("occurredAt", cursor) },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take,
      include: { actor: { select: { id: true, fullName: true } } },
    });
  },
  latestInbound(conversationId: string, db: CrmDb = defaultCrmDb) {
    return db.crmMessage.findFirst({ where: { conversationId, direction: "INBOUND" }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], select: { id: true, providerMessageId: true, metadata: true, occurredAt: true } });
  },
  countUnseenInbound(conversationId: string, db: CrmDb = defaultCrmDb) {
    return db.crmMessage.count({ where: { conversationId, direction: "INBOUND", seenAt: null } });
  },
  /** Ids of conversations whose body matches a full-text query (PostgreSQL, GIN index on to_tsvector('simple', body)). */
  async conversationIdsMatchingText(companyId: string, query: string, take = 500): Promise<string[]> {
    const terms = query
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length > 0)
      .slice(0, 8);
    if (!terms.length) return [];
    // Prefix match on every word: "quot rev" finds "revised quotation".
    const tsquery = terms.map((t) => `${t}:*`).join(" & ");
    const rows = await prisma.$queryRaw<{ conversation_id: string }[]>`
      SELECT DISTINCT conversation_id FROM crm_messages
      WHERE company_id = ${companyId}::uuid AND to_tsvector('simple', body) @@ to_tsquery('simple', ${tsquery})
      LIMIT ${take}`;
    return rows.map((r) => r.conversation_id);
  },
  /** Stuck outbound messages (process died between the provider call and saving its answer). */
  staleQueued(before: Date, take = 100) {
    return prisma.crmMessage.findMany({ where: { status: "QUEUED", lastAttemptAt: { lt: before } }, select: { id: true, companyId: true }, take });
  },
};

/**
 * Conversations linked to a contact / company / opportunity that the viewer
 * can open — their events appear on that record's timeline (newest 500).
 */
export async function linkedConversationIds(actor: CrmActor, entityType: "CONTACT" | "COMPANY" | "OPPORTUNITY", entityIds: string[]): Promise<string[]> {
  if (!entityIds.length) return [];
  const field = entityType === "CONTACT" ? "contactId" : entityType === "COMPANY" ? "crmCompanyId" : "opportunityId";
  const scope = await getCrmRecordScope(actor);
  const rows = await prisma.crmConversation.findMany({
    where: { AND: [{ companyId: actor.companyId, [field]: { in: entityIds } }, conversationScopeWhere(actor, scope)] },
    select: { id: true },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  return rows.map((r) => r.id);
}
