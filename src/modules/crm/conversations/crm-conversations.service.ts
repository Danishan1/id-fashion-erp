import type { Prisma } from "@prisma/client";
import { getAttachmentForDownload } from "@/core/attachments/AttachmentService";
import type { ChannelType } from "@/core/communication/CommunicationProvider";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { createNotification } from "@/core/notifications/NotificationService";
import { PermissionService } from "@/core/rbac/PermissionService";
import { assertAssignable, canSeeRecord, createActivity } from "../activities/crm-activities.service";
import { loadCompanyForActor } from "../companies/crm-companies.service";
import { canContact } from "../contacts/contactability";
import { CONTACTABILITY_CHANNELS, CONTACTABILITY_STATUSES } from "../contacts/contact-registry";
import { CrmContactRepository } from "../contacts/crm-contact.repository";
import { createContact, loadContactForActor } from "../contacts/crm-contacts.service";
import type { CrmActor } from "../core/crm-actor";
import { businessDayRange } from "../core/crm-dates";
import { runCrmMutation, type CrmMutationContext } from "../core/crm-mutation";
import { buildSearchText } from "../core/crm-normalize";
import { getCrmRecordScope, type CrmRecordScope } from "../core/crm-visibility";
import { loadOpportunityForActor } from "../opportunities/crm-opportunities.service";
import { conversationScopeWhere } from "./conversation-access";
import {
  CHANNEL_TYPE_LABELS,
  CONTACTABILITY_CHANNEL_FOR,
  CONVERSATION_STATUSES,
  CONVERSATION_STATUS_KEYS,
  canChangeConversationStatus,
  MATCH_STATUSES,
  MESSAGE_PAGE_SIZE,
  MESSAGE_STATUSES,
  type ConversationEventPayload,
  type ConversationStatus,
  type MatchStatus,
} from "./conversation-registry";
import {
  assignConversationSchema,
  conversationStatusSchema,
  conversationTaskSchema,
  createContactFromConversationSchema,
  DEFAULT_INBOX_STATUSES,
  linkConversationSchema,
  markReadSchema,
  messagePageSchema,
  updateConversationSchema,
  type ConversationFilter,
  type ConversationSortField,
} from "./conversation.schema";
import { channelCapabilities } from "./crm-channels.service";
import { CONVERSATION_INCLUDE, CrmConversationRepository, type ConversationRow, type MessageRow, type ThreadCursor } from "./crm-conversation.repository";

/**
 * Unified conversations (Phase 11) — reads and user actions: the inbox,
 * thread, read state, assignment, status, record links, contact creation
 * from the unmatched queue and tasks. Sending and receiving messages live in
 * conversation-messaging.service.ts; both write through runCrmMutation so
 * every change has its AuditLog row and crm_events event in one transaction.
 */

const TABLE = "crm_conversations";
const notFound = (id: string) => new BusinessRuleError("NOT_FOUND", "Conversation not found.", { id });
export const conversationConflict = (id: string) => new BusinessRuleError("RECORD_VERSION_CONFLICT", "This conversation was changed by someone else after you opened it. Reload to see the latest version, then try again.", { id });

// ── Access ───────────────────────────────────────────────────────

export async function loadConversation(actor: CrmActor, id: string): Promise<{ row: ConversationRow; scope: CrmRecordScope }> {
  const scope = await getCrmRecordScope(actor);
  const row = await prisma.crmConversation.findFirst({ where: { AND: [{ id, companyId: actor.companyId }, conversationScopeWhere(actor, scope)] }, include: CONVERSATION_INCLUDE });
  if (!row) throw notFound(id);
  return { row, scope };
}

// ── Events ───────────────────────────────────────────────────────

type ConversationFacts = Pick<ConversationRow, "id" | "channelId" | "channelType" | "contactId" | "crmCompanyId" | "opportunityId" | "assignedToUserId" | "status">;

export function conversationPayload(c: ConversationFacts, extra: { messageId?: string | null; direction?: "INBOUND" | "OUTBOUND" | null; status?: string; occurredAt?: Date; [k: string]: unknown } = {}): ConversationEventPayload {
  const { messageId = null, direction = null, status, occurredAt, ...rest } = extra;
  return {
    schemaVersion: 1,
    conversationId: c.id,
    messageId,
    channelId: c.channelId,
    channelType: c.channelType,
    contactId: c.contactId,
    crmCompanyId: c.crmCompanyId,
    opportunityId: c.opportunityId,
    assignedUserId: c.assignedToUserId,
    direction,
    status: status ?? c.status,
    occurredAt: (occurredAt ?? new Date()).toISOString(),
    ...rest,
  };
}

export function emitConversation(ctx: CrmMutationContext, c: ConversationFacts, eventType: Parameters<CrmMutationContext["emit"]>[0]["eventType"], summary: string, extra: Parameters<typeof conversationPayload>[1] = {}) {
  ctx.emit({ entityType: "CONVERSATION", entityId: c.id, eventType, summary, payload: conversationPayload(c, extra) as unknown as Record<string, unknown> });
}

/** Rebuilds the inbox search text (subject, participants, linked record names). */
export async function refreshSearchText(tx: Prisma.TransactionClient, id: string) {
  const c = await tx.crmConversation.findUnique({
    where: { id },
    select: { subject: true, displayName: true, displayIdentifier: true, channelType: true, contact: { select: { fullName: true } }, crmCompany: { select: { name: true } }, opportunity: { select: { name: true, opportunityNumber: true } }, participants: { select: { displayName: true, externalIdentifier: true } } },
  });
  if (!c) return;
  const searchText = buildSearchText([
    c.subject,
    c.displayName,
    c.displayIdentifier,
    CHANNEL_TYPE_LABELS[c.channelType as ChannelType],
    c.contact?.fullName,
    c.crmCompany?.name,
    c.opportunity?.name,
    c.opportunity?.opportunityNumber,
    ...c.participants.flatMap((p) => [p.displayName, p.externalIdentifier]),
  ]).slice(0, 4000);
  await tx.crmConversation.update({ where: { id }, data: { searchText } });
}

export async function notifyConversationAssignee(tx: Prisma.TransactionClient, c: { id: string; companyId: string; displayName: string | null; displayIdentifier: string | null; channelType: string }, userId: string | null, title: string, body?: string) {
  if (!userId) return;
  await createNotification(
    { companyId: c.companyId, userId, title, body: body ?? `${CHANNEL_TYPE_LABELS[c.channelType as ChannelType] ?? c.channelType} · ${c.displayName || c.displayIdentifier || "Unknown sender"}`, relatedModule: "CRM_CONVERSATION", relatedRecordId: c.id },
    tx
  );
}

// ── Contactability (Phase 04 is the authority) ───────────────────

export interface ConversationContactability {
  allowed: boolean;
  /** Phase 04 contactability channel that decided ("ALL" for a contact-wide restriction). */
  decidedBy: string | null;
  status: string;
  message: string | null;
}

/** May we message this conversation's contact on its channel? No linked contact = no restriction on record. */
export async function contactabilityFor(c: { channelType: string; contact: { id: string; fullName: string; mergedIntoId: string | null } | null }): Promise<ConversationContactability> {
  if (!c.contact) return { allowed: true, decidedBy: null, status: "ALLOWED", message: null };
  const contactId = c.contact.mergedIntoId ?? c.contact.id;
  const consents = await CrmContactRepository.consents(contactId);
  const channel = CONTACTABILITY_CHANNEL_FOR[c.channelType as ChannelType] ?? null;
  const decision = channel
    ? canContact(consents, channel)
    : (() => {
        const all = consents.find((x) => x.channel === "ALL");
        return all && all.status !== "ALLOWED" ? { allowed: false, status: all.status, decidedBy: "ALL" as const, reason: all.reason } : { allowed: true, status: "ALLOWED" as const, decidedBy: null, reason: null };
      })();
  if (decision.allowed) return { allowed: true, decidedBy: decision.decidedBy, status: decision.status, message: null };
  const statusWords = CONTACTABILITY_STATUSES[decision.status as keyof typeof CONTACTABILITY_STATUSES]?.toLowerCase() ?? "restricted";
  const message =
    decision.decidedBy === "ALL"
      ? `${c.contact.fullName} is marked "${statusWords}" for all channels. Messages can't be sent.`
      : `${c.contact.fullName} has opted out of ${CONTACTABILITY_CHANNELS[decision.decidedBy as keyof typeof CONTACTABILITY_CHANNELS] ?? "this channel"} messages (${statusWords}). Messages can't be sent on this channel.`;
  return { allowed: false, decidedBy: decision.decidedBy, status: decision.status, message };
}

// ── Presentation ─────────────────────────────────────────────────

export function presentConversation(row: ConversationRow) {
  const title = row.contact?.fullName ?? row.displayName ?? row.displayIdentifier ?? "Unknown sender";
  return {
    id: row.id,
    title,
    channel: { id: row.channel.id, name: row.channel.name, channelType: row.channel.channelType, typeLabel: CHANNEL_TYPE_LABELS[row.channel.channelType as ChannelType] ?? row.channel.channelType, status: row.channel.status },
    subject: row.subject,
    status: row.status as ConversationStatus,
    statusLabel: CONVERSATION_STATUSES[row.status as ConversationStatus]?.label ?? row.status,
    matchStatus: row.matchStatus as MatchStatus,
    matchLabel: MATCH_STATUSES[row.matchStatus as MatchStatus] ?? row.matchStatus,
    contact: row.contact ? { id: row.contact.id, fullName: row.contact.fullName, href: `/crm/contacts/${row.contact.id}`, archived: Boolean(row.contact.archivedAt) } : null,
    company: row.crmCompany ? { id: row.crmCompany.id, name: row.crmCompany.name, href: `/crm/companies/${row.crmCompany.id}`, archived: Boolean(row.crmCompany.archivedAt) } : null,
    opportunity: row.opportunity ? { id: row.opportunity.id, label: `${row.opportunity.opportunityNumber} — ${row.opportunity.name}`, status: row.opportunity.status, href: `/crm/opportunities/${row.opportunity.id}` } : null,
    assignedTo: row.assignedTo,
    displayName: row.displayName,
    displayIdentifier: row.displayIdentifier,
    unreadCount: row.unreadCount,
    messageCount: row.messageCount,
    lastMessageAt: row.lastMessageAt,
    lastMessagePreview: row.lastMessagePreview,
    lastMessageDirection: row.lastMessageDirection,
    lastReadAt: row.lastReadAt,
    createdAt: row.createdAt,
    closedAt: row.closedAt,
    archivedAt: row.archivedAt,
    version: row.version,
  };
}
export type ConversationDto = ReturnType<typeof presentConversation>;

export function presentMessage(m: MessageRow, opts: { canRetry: boolean }) {
  const meta = (m.metadata && typeof m.metadata === "object" && !Array.isArray(m.metadata) ? m.metadata : {}) as Record<string, unknown>;
  return {
    kind: "message" as const,
    id: m.id,
    direction: m.direction as "INBOUND" | "OUTBOUND",
    messageType: m.messageType,
    subject: m.subject,
    body: m.body,
    status: m.status,
    statusLabel: MESSAGE_STATUSES[m.status as keyof typeof MESSAGE_STATUSES] ?? m.status,
    senderName: m.direction === "OUTBOUND" ? (m.senderUser?.fullName ?? "CRM") : (m.senderName ?? m.senderIdentifier ?? "Customer"),
    senderIdentifier: m.senderIdentifier,
    senderUser: m.senderUser,
    occurredAt: m.occurredAt,
    sentAt: m.sentAt,
    deliveredAt: m.deliveredAt,
    readAt: m.readAt,
    failedAt: m.failedAt,
    seenAt: m.seenAt,
    error: m.status === "FAILED" ? { code: m.errorCode, message: m.errorMessage ?? "The message could not be sent." } : null,
    attachments: m.attachments.map((a) => ({
      id: a.id,
      kind: a.kind,
      fileName: a.fileName,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      stored: Boolean(a.attachmentId),
      downloadUrl: a.attachmentId ? `/api/v1/crm/conversations/attachments/${a.id}/download` : null,
    })),
    location: (meta.location as { latitude: number; longitude: number; name?: string | null } | undefined) ?? null,
    // Phase 12: written from a template (the body above is what was actually sent).
    template: m.templateId ? { id: m.templateId, versionId: m.templateVersionId, name: (meta.template as { name?: string } | undefined)?.name ?? null, versionNumber: (meta.template as { versionNumber?: number } | undefined)?.versionNumber ?? null, edited: Boolean((meta.template as { edited?: boolean } | undefined)?.edited) } : null,
    canRetry: opts.canRetry && m.direction === "OUTBOUND" && m.status === "FAILED",
  };
}
export type MessageDto = ReturnType<typeof presentMessage>;

/** Permission flags for the conversation screen (every action is enforced again by its route). */
async function actionFlags(actor: CrmActor) {
  const [create, edit] = await Promise.all([PermissionService.can(actor.userId, "crm", "create"), PermissionService.can(actor.userId, "crm", "edit")]);
  return { create, edit };
}

export async function getConversation(actor: CrmActor, id: string) {
  const { row, scope } = await loadConversation(actor, id);
  return presentDetail(actor, scope, row);
}

async function presentDetail(actor: CrmActor, scope: CrmRecordScope, row: ConversationRow) {
  const [participants, flags, contactability] = await Promise.all([CrmConversationRepository.participants(row.id), actionFlags(actor), contactabilityFor(row)]);
  const capabilities = channelCapabilities(row.channel);
  const archived = row.status === "ARCHIVED";
  const candidates = row.matchStatus === "MULTIPLE" && row.matchCandidateIds.length
    ? await prisma.crmContact.findMany({ where: { companyId: actor.companyId, id: { in: row.matchCandidateIds }, mergedIntoId: null }, select: { id: true, fullName: true, email: true, mobile: true, phone: true, archivedAt: true, crmCompany: { select: { name: true } } } })
    : [];
  // Opportunities the user can choose from (the contact's or company's open deals).
  const oppWhere: Prisma.CrmOpportunityWhereInput[] = [];
  if (row.contactId) oppWhere.push({ crmContactId: row.contactId });
  if (row.crmCompanyId) oppWhere.push({ crmCompanyId: row.crmCompanyId });
  const opportunityChoices = oppWhere.length
    ? (await prisma.crmOpportunity.findMany({ where: { companyId: actor.companyId, archivedAt: null, status: "OPEN", OR: oppWhere }, select: { id: true, opportunityNumber: true, name: true }, orderBy: { updatedAt: "desc" }, take: 25 })).map((o) => ({ id: o.id, label: `${o.opportunityNumber} — ${o.name}` }))
    : [];
  return {
    ...presentConversation(row),
    channel: { ...presentConversation(row).channel, address: row.channel.address },
    participants: participants.map((p) => ({ id: p.id, type: p.participantType, role: p.role, identifierKind: p.identifierKind, identifier: p.externalIdentifier, displayName: p.displayName ?? p.user?.fullName ?? p.contact?.fullName ?? null, contactId: p.contactId, user: p.user })),
    capabilities,
    contactability,
    matchCandidates: candidates.map((c) => ({ id: c.id, fullName: c.fullName, companyName: c.crmCompany?.name ?? null, email: c.email, phone: c.mobile ?? c.phone, archived: Boolean(c.archivedAt) })),
    opportunityChoices,
    permissions: {
      send: flags.create && !archived && capabilities.canSend && contactability.allowed,
      note: flags.create,
      task: flags.create && !archived,
      assign: flags.edit && !archived,
      link: flags.edit && !archived,
      createContact: flags.create && flags.edit && !archived && !row.contactId,
      status: flags.edit,
      viewAll: scope.mode === "ALL",
    },
  };
}
export type ConversationDetailDto = Awaited<ReturnType<typeof presentDetail>>;

// ── Inbox ────────────────────────────────────────────────────────

export function buildConversationWhere(actor: CrmActor, scope: CrmRecordScope, f: ConversationFilter, textMatchIds: string[] | null, search: string | undefined): Prisma.CrmConversationWhereInput {
  const and: Prisma.CrmConversationWhereInput[] = [{ companyId: actor.companyId }, conversationScopeWhere(actor, scope)];
  const recordView = Boolean(f.contactId || f.companyId || f.opportunityId);
  const statuses = f.statuses.length ? f.statuses : f.folder === "unmatched" || recordView ? CONVERSATION_STATUS_KEYS.filter((s) => s !== "ARCHIVED") : DEFAULT_INBOX_STATUSES;
  and.push({ status: { in: statuses } });
  if (f.folder === "unread" || f.unread === "true") and.push({ unreadCount: { gt: 0 } });
  if (f.folder === "mine") and.push({ assignedToUserId: actor.userId });
  if (f.folder === "unassigned") and.push({ assignedToUserId: null });
  if (f.folder === "unmatched") and.push({ matchStatus: { not: "MATCHED" } });
  if (f.channelIds.length) and.push({ channelId: { in: f.channelIds } });
  if (f.channelTypes.length) and.push({ channelType: { in: f.channelTypes } });
  if (f.assignedToUserId) and.push({ assignedToUserId: f.assignedToUserId });
  if (f.contactId) and.push({ contactId: f.contactId });
  if (f.companyId) and.push({ crmCompanyId: f.companyId });
  if (f.opportunityId) and.push({ opportunityId: f.opportunityId });
  const range = businessDayRange({ from: f.from, to: f.to });
  if (range) and.push({ lastMessageAt: range });
  if (search) {
    const term = search.trim().toLowerCase();
    and.push({ OR: [{ searchText: { contains: term } }, ...(textMatchIds?.length ? [{ id: { in: textMatchIds } }] : [])] });
  }
  return { AND: and };
}

function orderFor(sortBy: ConversationSortField, sortOrder: "asc" | "desc"): Prisma.CrmConversationOrderByWithRelationInput[] {
  if (sortBy === "createdAt") return [{ createdAt: sortOrder }, { id: "asc" }];
  return [{ lastMessageAt: { sort: sortOrder, nulls: "last" } }, { id: "asc" }];
}

export async function listConversations(actor: CrmActor, f: ConversationFilter, query: { skip: number; take: number; search?: string; sortBy: string; sortOrder: "asc" | "desc" }) {
  const scope = await getCrmRecordScope(actor);
  // Message text search: PostgreSQL full text over message bodies (GIN index), never in the browser.
  const textMatchIds = query.search && query.search.trim().length >= 2 ? await CrmConversationRepository.conversationIdsMatchingText(actor.companyId, query.search) : null;
  const where = buildConversationWhere(actor, scope, f, textMatchIds, query.search);
  const sortBy: ConversationSortField = query.sortBy === "createdAt" ? "createdAt" : "lastMessageAt";
  const [rows, totalCount] = await Promise.all([CrmConversationRepository.findMany(where, orderFor(sortBy, query.sortOrder), query.skip, query.take), CrmConversationRepository.count(where)]);
  return { data: rows.map(presentConversation), totalCount };
}

/** Folder and channel counts for the inbox sidebar (open + pending conversations; COUNT queries, nothing loaded). */
export async function inboxCounts(actor: CrmActor) {
  const scope = await getCrmRecordScope(actor);
  const base: Prisma.CrmConversationWhereInput[] = [{ companyId: actor.companyId }, conversationScopeWhere(actor, scope)];
  const active = { status: { in: DEFAULT_INBOX_STATUSES } };
  const count = (extra: Prisma.CrmConversationWhereInput) => prisma.crmConversation.count({ where: { AND: [...base, extra] } });
  const [all, unread, mine, unassigned, unmatched, byChannel] = await Promise.all([
    count(active),
    count({ ...active, unreadCount: { gt: 0 } }),
    count({ ...active, assignedToUserId: actor.userId }),
    count({ ...active, assignedToUserId: null }),
    count({ status: { not: "ARCHIVED" }, matchStatus: { not: "MATCHED" } }),
    prisma.crmConversation.groupBy({ by: ["channelId"], where: { AND: [...base, active] }, _count: { _all: true }, _sum: { unreadCount: true } }),
  ]);
  return {
    folders: { all, unread, mine, unassigned, unmatched },
    channels: byChannel.map((c) => ({ channelId: c.channelId, open: c._count._all, unreadMessages: c._sum.unreadCount ?? 0 })),
  };
}

// ── Thread ───────────────────────────────────────────────────────

/** Conversation history shown inline between messages. */
const THREAD_EVENT_TYPES = ["conversation.assigned", "conversation.status_changed", "conversation.closed", "conversation.reopened", "conversation.archived", "conversation.contact_linked", "conversation.company_linked", "conversation.opportunity_linked"];

const encodeCursor = (c: ThreadCursor) => Buffer.from(`${c.at.toISOString()}|${c.id}`).toString("base64url");
function decodeCursor(raw: string | undefined): ThreadCursor | null {
  if (!raw) return null;
  const [at, id] = Buffer.from(raw, "base64url").toString("utf8").split("|");
  const date = new Date(at ?? "");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id) || Number.isNaN(date.getTime())) throw new BusinessRuleError("VALIDATION_ERROR", "Invalid page cursor.");
  return { at: date, id };
}

/**
 * One page of the thread, newest first from the cursor, returned oldest →
 * newest for display: customer messages, internal notes (crm_notes) and
 * conversation events merged by time. Keyset pagination on (time, id).
 */
export async function listThread(actor: CrmActor, id: string, raw: unknown) {
  const { row } = await loadConversation(actor, id);
  const page = messagePageSchema.parse(raw);
  const limit = page.limit ?? MESSAGE_PAGE_SIZE;
  const cursor = decodeCursor(page.before);
  const [messages, notes, events, flags] = await Promise.all([
    CrmConversationRepository.messagesBefore(row.id, cursor, limit + 1),
    CrmConversationRepository.notesBefore(actor.companyId, row.id, cursor, limit + 1),
    CrmConversationRepository.systemEventsBefore(actor.companyId, row.id, THREAD_EVENT_TYPES, cursor, limit + 1),
    actionFlags(actor),
  ]);
  const scope = await getCrmRecordScope(actor);
  const canSend = flags.create && channelCapabilities(row.channel).canSend && row.status !== "ARCHIVED";
  type Item = { at: Date; id: string; item: unknown };
  const items: Item[] = [
    ...messages.map((m) => ({ at: m.occurredAt, id: m.id, item: presentMessage(m, { canRetry: canSend }) })),
    ...notes.map((n) => ({
      at: n.createdAt,
      id: n.id,
      item: { kind: "note" as const, id: n.id, body: n.body, author: n.createdBy, createdAt: n.createdAt, editedAt: n.editedAt, canEdit: n.createdByUserId === actor.userId, canDelete: n.createdByUserId === actor.userId || scope.mode === "ALL" },
    })),
    ...events.map((e) => ({ at: e.occurredAt, id: e.id, item: { kind: "event" as const, id: e.id, eventType: e.eventType, summary: e.summary, actor: e.actor, occurredAt: e.occurredAt } })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const pageItems = items.slice(0, limit);
  const hasMore = items.length > limit;
  const last = pageItems[pageItems.length - 1];
  return { items: pageItems.reverse().map((i) => i.item), nextCursor: hasMore && last ? encodeCursor({ at: last.at, id: last.id }) : null };
}

/**
 * Marks inbound messages seen up to the newest one the user has on screen
 * (or all). Team-level unread state: one reader clears it for everyone.
 * The row lock keeps the count exact against a message arriving meanwhile.
 */
export async function markConversationRead(actor: CrmActor, id: string, raw: unknown) {
  const { row } = await loadConversation(actor, id);
  const input = markReadSchema.parse(raw ?? {});
  let cutoff = new Date();
  if (input.upToMessageId) {
    const m = await prisma.crmMessage.findFirst({ where: { id: input.upToMessageId, conversationId: row.id }, select: { occurredAt: true } });
    if (!m) throw new BusinessRuleError("NOT_FOUND", "Message not found.", { id: input.upToMessageId });
    cutoff = m.occurredAt;
  }
  if (!row.unreadCount) return { unreadCount: 0 };
  const now = new Date();
  const unreadCount = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM crm_conversations WHERE id = ${row.id}::uuid FOR UPDATE`;
    await tx.crmMessage.updateMany({ where: { conversationId: row.id, direction: "INBOUND", seenAt: null, occurredAt: { lte: cutoff } }, data: { seenAt: now, seenByUserId: actor.userId } });
    const remaining = await CrmConversationRepository.countUnseenInbound(row.id, tx);
    await tx.crmConversation.update({ where: { id: row.id }, data: { unreadCount: remaining, lastReadAt: now, lastReadByUserId: actor.userId } });
    return remaining;
  });
  return { unreadCount };
}

// ── Actions ──────────────────────────────────────────────────────

/** After an action the actor may no longer be in scope (e.g. reassigned it away) — read without scope. */
async function reloadForActor(actor: CrmActor, id: string) {
  const scope = await getCrmRecordScope(actor);
  const row = await CrmConversationRepository.findOne(actor.companyId, id);
  if (!row) throw notFound(id);
  return presentDetail(actor, scope, row);
}

async function versioned(ctx: CrmMutationContext, row: ConversationRow, version: number, data: Prisma.CrmConversationUncheckedUpdateManyInput) {
  const { count } = await CrmConversationRepository.updateVersioned(row.id, version, data, ctx.tx);
  if (!count) throw conversationConflict(row.id);
  return (await CrmConversationRepository.findOne(row.companyId, row.id, ctx.tx))!;
}

export async function updateConversation(actor: CrmActor, id: string, raw: unknown) {
  const input = updateConversationSchema.parse(raw);
  const { row } = await loadConversation(actor, id);
  if (row.companyId !== actor.companyId) throw notFound(id);
  const subject = input.subject?.trim() || null;
  if (input.subject === undefined || subject === row.subject) return reloadForActor(actor, id);
  await runCrmMutation(actor, async (ctx) => {
    const after = await versioned(ctx, row, input.version, { subject });
    await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: { subject: row.subject }, newValues: { subject } });
    emitConversation(ctx, after, "conversation.updated", subject ? `Subject: ${subject}` : "Subject removed", { field: "subject", from: row.subject, to: subject });
    await refreshSearchText(ctx.tx, id);
  });
  return reloadForActor(actor, id);
}

/** Assign / reassign / unassign to an ERP user who can use the CRM. */
export async function assignConversation(actor: CrmActor, id: string, raw: unknown) {
  const input = assignConversationSchema.parse(raw);
  const { row } = await loadConversation(actor, id);
  if (row.status === "ARCHIVED") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Restore this conversation before assigning it.");
  if (input.assignedToUserId === row.assignedToUserId) return reloadForActor(actor, id);
  const to = input.assignedToUserId ? await assertAssignable(actor.companyId, input.assignedToUserId) : null;
  await runCrmMutation(actor, async (ctx) => {
    const after = await versioned(ctx, row, input.version, { assignedToUserId: to?.id ?? null });
    await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: { assignedToUserId: row.assignedToUserId }, newValues: { assignedToUserId: to?.id ?? null } });
    const summary = to ? (row.assignedTo ? `Reassigned from ${row.assignedTo.fullName} to ${to.fullName}` : `Assigned to ${to.fullName}`) : `Unassigned (was ${row.assignedTo?.fullName ?? "unassigned"})`;
    emitConversation(ctx, after, "conversation.assigned", summary, { fromUserId: row.assignedToUserId, toUserId: to?.id ?? null });
    if (to && to.id !== actor.userId) await notifyConversationAssignee(ctx.tx, row, to.id, "Conversation assigned to you");
  });
  return reloadForActor(actor, id);
}

/** Open ↔ pending, close, reopen, archive, restore. History is never deleted. */
export async function changeConversationStatus(actor: CrmActor, id: string, raw: unknown) {
  const input = conversationStatusSchema.parse(raw);
  const { row } = await loadConversation(actor, id);
  if (row.status === input.status) return reloadForActor(actor, id);
  if (!canChangeConversationStatus(row.status, input.status)) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `A ${CONVERSATION_STATUSES[row.status as ConversationStatus]?.label.toLowerCase() ?? row.status} conversation can't be marked ${CONVERSATION_STATUSES[input.status].label.toLowerCase()}.`, { from: row.status, to: input.status });
  }
  const now = new Date();
  const data: Prisma.CrmConversationUncheckedUpdateManyInput = { status: input.status };
  if (input.status === "CLOSED") Object.assign(data, { closedAt: now, closedByUserId: actor.userId });
  if (input.status === "ARCHIVED") Object.assign(data, { archivedAt: now });
  if (input.status === "OPEN" || input.status === "PENDING") Object.assign(data, { closedAt: null, closedByUserId: null, archivedAt: null });
  await runCrmMutation(actor, async (ctx) => {
    const after = await versioned(ctx, row, input.version, data);
    await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: { status: row.status }, newValues: { status: input.status } });
    const label = (s: string) => CONVERSATION_STATUSES[s as ConversationStatus]?.label ?? s;
    const eventType = input.status === "CLOSED" ? "conversation.closed" : input.status === "ARCHIVED" ? "conversation.archived" : row.status === "CLOSED" || row.status === "ARCHIVED" ? "conversation.reopened" : "conversation.status_changed";
    emitConversation(ctx, after, eventType, `${label(row.status)} → ${label(input.status)}`, { from: row.status, to: input.status });
  });
  return reloadForActor(actor, id);
}

/**
 * Link / relink / unlink the contact, company and opportunity. Uses the
 * existing CRM records only (never creates one) and only ones the user can
 * see. Linking a contact fills its company when none is set; an opportunity
 * fills its company / contact when empty. Each change is its own timeline
 * event (from → to), so earlier associations stay in the history.
 */
export async function linkConversation(actor: CrmActor, id: string, raw: unknown) {
  const input = linkConversationSchema.parse(raw);
  const { row } = await loadConversation(actor, id);
  if (row.status === "ARCHIVED") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Restore this conversation before changing its links.");
  const next = { contactId: row.contactId, crmCompanyId: row.crmCompanyId, opportunityId: row.opportunityId };
  const labels: Record<"contact" | "company" | "opportunity", string | null> = { contact: row.contact?.fullName ?? null, company: row.crmCompany?.name ?? null, opportunity: row.opportunity ? `${row.opportunity.opportunityNumber} — ${row.opportunity.name}` : null };
  const fieldError = (field: string, message: string) => new BusinessRuleError("VALIDATION_ERROR", message, { fieldErrors: { [field]: message } });

  let opp: Awaited<ReturnType<typeof loadOpportunityForActor>> | null = null;
  if (input.opportunityId !== undefined) {
    if (input.opportunityId) {
      opp = await loadOpportunityForActor(actor, input.opportunityId);
      if (opp.archivedAt) throw fieldError("opportunityId", `"${opp.name}" is archived. Restore it before linking.`);
      next.opportunityId = opp.id;
      labels.opportunity = `${opp.opportunityNumber} — ${opp.name}`;
    } else next.opportunityId = null;
  }
  if (input.contactId !== undefined) {
    if (input.contactId) {
      const contact = await loadContactForActor(actor, input.contactId);
      if (contact.archivedAt) throw fieldError("contactId", `"${contact.fullName}" is archived. Restore the contact before linking.`);
      next.contactId = contact.id;
      labels.contact = contact.fullName;
      if (input.companyId === undefined && !next.crmCompanyId && contact.crmCompanyId) next.crmCompanyId = contact.crmCompanyId;
    } else next.contactId = null;
  }
  if (input.companyId !== undefined) {
    if (input.companyId) {
      const company = await loadCompanyForActor(actor, input.companyId);
      if (company.archivedAt) throw fieldError("companyId", `"${company.name}" is archived. Restore it before linking.`);
      next.crmCompanyId = company.id;
      labels.company = company.name;
    } else next.crmCompanyId = null;
  }
  if (opp) {
    if (input.companyId === undefined && !next.crmCompanyId && opp.crmCompanyId) next.crmCompanyId = opp.crmCompanyId;
    if (input.contactId === undefined && !next.contactId && opp.crmContactId && (await canSeeRecord(actor, { entityType: "CONTACT", entityId: opp.crmContactId }))) next.contactId = opp.crmContactId;
  }
  // An opportunity of another company would mislead everyone reading the thread.
  if (next.opportunityId && next.crmCompanyId) {
    const o = opp ?? (await prisma.crmOpportunity.findFirst({ where: { id: next.opportunityId, companyId: actor.companyId }, select: { crmCompanyId: true, name: true } }));
    if (o?.crmCompanyId && o.crmCompanyId !== next.crmCompanyId) throw fieldError("opportunityId", "That opportunity belongs to another company. Choose one of this company's opportunities.");
  }
  const changed = (["contactId", "crmCompanyId", "opportunityId"] as const).filter((k) => next[k] !== row[k]);
  if (!changed.length) return reloadForActor(actor, id);
  const matchStatus: MatchStatus = next.contactId || next.crmCompanyId ? "MATCHED" : "UNMATCHED";

  await runCrmMutation(actor, async (ctx) => {
    const after = await versioned(ctx, row, input.version, { ...next, matchStatus, matchCandidateIds: matchStatus === "MATCHED" ? [] : row.matchCandidateIds });
    if (changed.includes("contactId")) {
      // The customer identity now belongs to this contact (later messages from it match automatically).
      await ctx.tx.crmConversationParticipant.updateMany({ where: { conversationId: id, role: "CUSTOMER" }, data: { contactId: next.contactId, participantType: next.contactId ? "CONTACT" : "EXTERNAL" } });
    }
    await ctx.audit({ tableName: TABLE, recordId: id, action: "UPDATE", oldValues: { contactId: row.contactId, crmCompanyId: row.crmCompanyId, opportunityId: row.opportunityId, matchStatus: row.matchStatus }, newValues: { ...next, matchStatus } });
    const prev = { contact: row.contact?.fullName ?? null, company: row.crmCompany?.name ?? null, opportunity: row.opportunity ? `${row.opportunity.opportunityNumber} — ${row.opportunity.name}` : null };
    const say = (what: string, from: string | null, to: string | null) => (to ? (from ? `${what}: ${from} → ${to}` : `${what}: ${to}`) : `${what} removed (was ${from})`);
    if (changed.includes("contactId")) {
      const toLabel = next.contactId ? (labels.contact ?? (await prisma.crmContact.findUnique({ where: { id: next.contactId }, select: { fullName: true } }))?.fullName ?? null) : null;
      emitConversation(ctx, after, "conversation.contact_linked", say("Contact", prev.contact, toLabel), { fromContactId: row.contactId, toContactId: next.contactId, automatic: false });
    }
    if (changed.includes("crmCompanyId")) {
      const toLabel = next.crmCompanyId ? (labels.company ?? (await prisma.crmCompany.findUnique({ where: { id: next.crmCompanyId }, select: { name: true } }))?.name ?? null) : null;
      emitConversation(ctx, after, "conversation.company_linked", say("Company", prev.company, toLabel), { fromCompanyId: row.crmCompanyId, toCompanyId: next.crmCompanyId, automatic: false });
    }
    if (changed.includes("opportunityId")) emitConversation(ctx, after, "conversation.opportunity_linked", say("Opportunity", prev.opportunity, labels.opportunity), { fromOpportunityId: row.opportunityId, toOpportunityId: next.opportunityId, automatic: false });
    await refreshSearchText(ctx.tx, id);
  });
  return reloadForActor(actor, id);
}

/**
 * Unmatched queue → "Create contact". Goes through the Phase 04 contact
 * service, so its duplicate rules apply (a possible duplicate comes back as
 * CRM_POSSIBLE_DUPLICATE / CRM_DUPLICATE_RECORD with the matches, and the
 * user links the existing contact instead). Then links it.
 */
export async function createContactFromConversation(actor: CrmActor, id: string, raw: unknown) {
  const input = createContactFromConversationSchema.parse(raw);
  const { row } = await loadConversation(actor, id);
  if (row.contactId) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This conversation is already linked to a contact.");
  if (row.status === "ARCHIVED") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Restore this conversation before creating a contact from it.");
  if (row.version !== input.version) throw conversationConflict(id);
  const contact = await createContact(actor, {
    firstName: input.firstName,
    lastName: input.lastName ?? undefined,
    email: input.email ?? undefined,
    mobile: input.mobile ?? undefined,
    whatsapp: input.whatsapp ?? undefined,
    crmCompanyId: input.crmCompanyId ?? undefined,
    confirmDuplicate: input.confirmDuplicate,
  });
  return linkConversation(actor, id, { version: input.version, contactId: contact.id });
}

/**
 * Task from a conversation (or one of its messages) through the Phase 09
 * activity service: created on the opportunity, else the contact, else the
 * company (whichever the user can see), linked to the conversation too; an
 * unmatched conversation gets the task directly.
 */
export async function createTaskFromConversation(actor: CrmActor, id: string, raw: unknown) {
  const input = conversationTaskSchema.parse(raw);
  const { row } = await loadConversation(actor, id);
  let quote: string | null = null;
  if (input.messageId) {
    const m = await prisma.crmMessage.findFirst({ where: { id: input.messageId, conversationId: row.id }, select: { body: true, direction: true, senderName: true } });
    if (!m) throw new BusinessRuleError("NOT_FOUND", "Message not found.", { id: input.messageId });
    const text = m.body.trim();
    if (text) quote = `${m.direction === "INBOUND" ? (m.senderName ?? "Customer") : "We"} wrote: "${text.length > 500 ? `${text.slice(0, 497)}…` : text}"`;
  }
  const candidates = [
    row.opportunityId && { entityType: "OPPORTUNITY" as const, entityId: row.opportunityId },
    row.contactId && { entityType: "CONTACT" as const, entityId: row.contactId },
    row.crmCompanyId && { entityType: "COMPANY" as const, entityId: row.crmCompanyId },
  ].filter(Boolean) as { entityType: "OPPORTUNITY" | "CONTACT" | "COMPANY"; entityId: string }[];
  let primary: { entityType: "OPPORTUNITY" | "CONTACT" | "COMPANY" | "CONVERSATION"; entityId: string } = { entityType: "CONVERSATION", entityId: row.id };
  for (const c of candidates) {
    if (await canSeeRecord(actor, c)) {
      primary = c;
      break;
    }
  }
  const description = [input.description?.trim(), quote].filter(Boolean).join("\n\n") || null;
  return createActivity(actor, {
    type: "TASK",
    mode: "schedule",
    subject: input.subject,
    description,
    priority: input.priority,
    entityType: primary.entityType,
    entityId: primary.entityId,
    links: primary.entityType === "CONVERSATION" ? [] : [{ entityType: "CONVERSATION", entityId: row.id }],
    ...(input.assignedToUserId !== undefined ? { assignedToUserId: input.assignedToUserId } : {}),
    dueDate: input.dueDate ?? null,
    dueTime: input.dueTime ?? null,
    reminderMinutes: input.reminderMinutes,
    metadata: { conversationId: row.id, ...(input.messageId ? { messageId: input.messageId } : {}) },
  });
}

/** A message attachment, only through a conversation the user can open. */
export async function downloadMessageAttachment(actor: CrmActor, id: string) {
  const att = await prisma.crmMessageAttachment.findFirst({ where: { id, companyId: actor.companyId }, select: { attachmentId: true, fileName: true, mimeType: true, message: { select: { conversationId: true } } } });
  if (!att || !att.attachmentId) throw new BusinessRuleError("NOT_FOUND", "Attachment not found.", { id });
  await loadConversation(actor, att.message.conversationId);
  const { attachment, buffer } = await getAttachmentForDownload(actor.companyId, att.attachmentId);
  return { fileName: att.fileName || attachment.fileName, mimeType: att.mimeType || attachment.mimeType, buffer };
}
