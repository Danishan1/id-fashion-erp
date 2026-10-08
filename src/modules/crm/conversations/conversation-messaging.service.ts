import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  ProviderPayloadError,
  type AttachmentKind,
  type ChannelProvider,
  type IdentifierKind,
  type NormalizedAttachment,
  type NormalizedIdentity,
  type NormalizedInboundMessage,
  type NormalizedStatusUpdate,
  type OutboundAttachment,
  type ProviderChannel,
  type SendResult,
} from "@/core/communication/CommunicationProvider";
import { attachmentKindOf } from "@/core/communication/providers/generic-webhook.provider";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { deleteStoredFile, FileTooLargeError, readStoredFile, saveFile, UnsupportedFileTypeError } from "@/core/file-storage/FileStorage";
import { logger } from "@/core/logging/logger";
import { touchLinkedRecords } from "../activities/crm-activities.service";
import type { CrmActor } from "../core/crm-actor";
import { crmSystemActor, runCrmMutation, type CrmMutationContext, type CrmSystemActor } from "../core/crm-mutation";
import { matchContact, soleOpenOpportunity } from "./conversation-matching";
import { CHANNEL_TYPE_LABELS, canApplyDeliveryStatus, identifierKey, messagePreview, STALE_SEND_MINUTES, type ChannelType } from "./conversation-registry";
import { sendMessageSchema } from "./conversation.schema";
import { channelCapabilities, providerChannel, providerOf } from "./crm-channels.service";
import {
  contactabilityFor,
  conversationConflict,
  emitConversation,
  loadConversation,
  notifyConversationAssignee,
  presentMessage,
  refreshSearchText,
} from "./crm-conversations.service";
import { CrmConversationRepository, type ConversationRow, type MessageRow } from "./crm-conversation.repository";

/**
 * Message flow for unified conversations (Phase 11):
 *
 *   INBOUND   provider webhook → ChannelProvider (verify + normalise) →
 *             ingestInboundMessage: idempotency → find / create conversation
 *             (contact matching, unmatched queue) → message → unread count →
 *             timeline + message.received, all in one transaction.
 *   STATUS    applyDeliveryStatus: forward-only delivery updates.
 *   OUTBOUND  sendConversationMessage: permissions → capabilities → DND /
 *             contactability (Phase 04, server-side) → message saved QUEUED →
 *             ChannelProvider.sendMessage (outside the transaction) → SENT /
 *             FAILED saved with message.sent / message.failed.
 *
 * Internal notes are crm_notes rows and never pass through here, so nothing
 * can turn a note into an outbound message.
 */

const MESSAGES = "crm_messages";

// ── Shared ───────────────────────────────────────────────────────

interface StoredFile {
  kind: AttachmentKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number | null;
  storageKey: string | null;
  providerMediaRef: string | null;
}

async function cleanup(files: StoredFile[]) {
  for (const f of files) if (f.storageKey) await deleteStoredFile(f.storageKey).catch(() => undefined);
}

/** Message attachment rows: the bytes go to the ERP file store, the attachments table, then the CRM record. */
async function createAttachmentRows(tx: Prisma.TransactionClient, companyId: string, uploaderUserId: string, conversationId: string, messageId: string, files: StoredFile[], label: string) {
  for (const f of files) {
    let attachmentId: string | null = null;
    if (f.storageKey) {
      const a = await tx.attachment.create({
        data: { companyId, uploadedById: uploaderUserId, relatedModule: "CRM_CONVERSATION", relatedRecordId: conversationId, fileName: f.fileName, storageKey: f.storageKey, fileSizeBytes: f.sizeBytes ?? 0, mimeType: f.mimeType, contextLabel: label },
      });
      attachmentId = a.id;
    }
    await tx.crmMessageAttachment.create({ data: { companyId, messageId, attachmentId, kind: f.kind, fileName: f.fileName.slice(0, 255), mimeType: f.mimeType, sizeBytes: f.sizeBytes, providerMediaRef: f.providerMediaRef } });
  }
}

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/** Linked records get their "last activity" bumped by conversation traffic. */
function linkedRefs(c: { contactId: string | null; crmCompanyId: string | null; opportunityId: string | null }) {
  return [
    c.contactId && { entityType: "CONTACT" as const, entityId: c.contactId },
    c.crmCompanyId && { entityType: "COMPANY" as const, entityId: c.crmCompanyId },
    c.opportunityId && { entityType: "OPPORTUNITY" as const, entityId: c.opportunityId },
  ].filter(Boolean) as { entityType: "CONTACT" | "COMPANY" | "OPPORTUNITY"; entityId: string }[];
}

// ── Inbound ──────────────────────────────────────────────────────

export interface DeliveryChannel {
  id: string;
  companyId: string;
  channelType: string;
  name: string;
  defaultAssigneeUserId: string | null;
  createdByUserId: string;
}

export type InboundOutcome = { outcome: "created" | "duplicate"; messageId: string; conversationId: string; conversationCreated: boolean };

class DuplicateInbound extends Error {
  constructor(readonly existing: { id: string; conversationId: string }) {
    super("duplicate");
  }
}

/** Inline files are stored through the ERP file store (type / size checks); others keep their provider reference. */
async function storeInboundFiles(attachments: NormalizedAttachment[]): Promise<StoredFile[]> {
  const out: StoredFile[] = [];
  for (const a of attachments) {
    if (!a.content) {
      out.push({ kind: a.kind, fileName: a.fileName, mimeType: a.mimeType, sizeBytes: a.sizeBytes ?? null, storageKey: null, providerMediaRef: a.providerMediaRef ?? null });
      continue;
    }
    try {
      const stored = await saveFile(a.content, a.fileName, a.mimeType);
      out.push({ kind: a.kind, fileName: a.fileName, mimeType: a.mimeType, sizeBytes: stored.fileSizeBytes, storageKey: stored.storageKey, providerMediaRef: null });
    } catch (e) {
      if (!(e instanceof UnsupportedFileTypeError || e instanceof FileTooLargeError)) {
        await cleanup(out);
        throw e;
      }
      // Rejected by the file policy: the message is kept, the file is listed as not stored.
      out.push({ kind: a.kind, fileName: a.fileName, mimeType: a.mimeType, sizeBytes: a.content.byteLength, storageKey: null, providerMediaRef: null });
    }
  }
  return out;
}

async function activeAssignee(companyId: string, userId: string | null) {
  if (!userId) return null;
  return prisma.user.findFirst({ where: { id: userId, companyId, status: "ACTIVE" }, select: { id: true, fullName: true } });
}

/**
 * Stores one normalised inbound message. Idempotent on the provider message
 * id (checked under a per-sender advisory lock and enforced by a unique
 * index), so provider retries never duplicate a message or a conversation.
 */
export async function ingestInboundMessage(channel: DeliveryChannel, msg: NormalizedInboundMessage): Promise<InboundOutcome> {
  const existing = await CrmConversationRepository.findMessageByProviderId(channel.id, msg.providerMessageId);
  if (existing) return { outcome: "duplicate", messageId: existing.id, conversationId: existing.conversationId, conversationCreated: false };
  const key = identifierKey(msg.from.kind, msg.from.value);
  if (!key) throw new ProviderPayloadError(`The sender's ${msg.from.kind.toLowerCase()} "${msg.from.value}" is not usable.`);
  const files = await storeInboundFiles(msg.attachments);
  const system = crmSystemActor(channel.companyId);
  const lockKey = `crm-conversation-inbound:${channel.id}:${msg.threadRef ? `t:${msg.threadRef}` : `${msg.from.kind}:${key}`}`;
  try {
    return await runCrmMutation(system, async (ctx) => {
      await ctx.tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
      const dup = await CrmConversationRepository.findMessageByProviderId(channel.id, msg.providerMessageId, ctx.tx);
      if (dup) throw new DuplicateInbound(dup);
      const now = new Date();
      let created = false;
      let conv = msg.threadRef ? await CrmConversationRepository.findByThreadRef(channel.id, msg.threadRef, ctx.tx) : null;
      if (!conv) conv = await CrmConversationRepository.findLatestForIdentity(channel.id, msg.from.kind, key, ctx.tx);
      const typeLabel = CHANNEL_TYPE_LABELS[channel.channelType as ChannelType] ?? channel.channelType;
      const senderLabel = msg.from.displayName || msg.from.value;

      if (!conv) {
        created = true;
        const match = await matchContact(channel.companyId, channel.id, msg.from, msg.alternateIdentities);
        const opportunityId = match.contactId ? await soleOpenOpportunity(channel.companyId, match.contactId) : null;
        const assignee = await activeAssignee(channel.companyId, channel.defaultAssigneeUserId);
        conv = await CrmConversationRepository.create(
          {
            companyId: channel.companyId,
            channelId: channel.id,
            channelType: channel.channelType,
            subject: msg.subject,
            status: "OPEN",
            matchStatus: match.status,
            matchCandidateIds: match.candidateIds,
            contactId: match.contactId,
            crmCompanyId: match.crmCompanyId,
            opportunityId,
            assignedToUserId: assignee?.id ?? null,
            externalThreadRef: msg.threadRef,
            displayName: msg.from.displayName ?? null,
            displayIdentifier: msg.from.value,
          },
          ctx.tx
        );
        await CrmConversationRepository.ensureParticipant(
          {
            companyId: channel.companyId,
            conversationId: conv.id,
            channelId: channel.id,
            participantType: match.contactId ? "CONTACT" : msg.from.kind === "SESSION" ? "ANONYMOUS" : "EXTERNAL",
            role: "CUSTOMER",
            identifierKind: msg.from.kind,
            externalIdentifier: msg.from.value,
            identifierKey: key,
            displayName: msg.from.displayName ?? null,
            contactId: match.contactId,
          },
          ctx.tx
        );
        await ctx.audit({ tableName: "crm_conversations", recordId: conv.id, action: "CREATE", newValues: { channelId: channel.id, matchStatus: match.status, contactId: match.contactId, crmCompanyId: match.crmCompanyId, opportunityId, assignedToUserId: assignee?.id ?? null, source: "INBOUND" } });
        emitConversation(ctx, conv, "conversation.created", `${typeLabel} · ${senderLabel}${match.status === "MATCHED" ? "" : match.status === "MULTIPLE" ? " · several possible contacts" : " · unmatched"}`, { matchStatus: match.status, matchedBy: match.matchedBy, source: "INBOUND" });
        if (match.contactId) emitConversation(ctx, conv, "conversation.contact_linked", `Contact matched by ${match.matchedBy?.toLowerCase().replace("_", " ")}`, { fromContactId: null, toContactId: match.contactId, automatic: true, matchedBy: match.matchedBy });
        if (match.crmCompanyId) emitConversation(ctx, conv, "conversation.company_linked", "Company from the contact", { fromCompanyId: null, toCompanyId: match.crmCompanyId, automatic: true });
        if (opportunityId) emitConversation(ctx, conv, "conversation.opportunity_linked", "The contact's only open opportunity", { fromOpportunityId: null, toOpportunityId: opportunityId, automatic: true });
        if (assignee) {
          emitConversation(ctx, conv, "conversation.assigned", `Assigned to ${assignee.fullName} (channel default)`, { fromUserId: null, toUserId: assignee.id, automatic: true });
          await notifyConversationAssignee(ctx.tx, { ...conv, companyId: channel.companyId }, assignee.id, `New ${typeLabel} conversation`);
        }
      } else {
        const before = await CrmConversationRepository.participants(conv.id, ctx.tx);
        if (!before.some((p) => p.identifierKind === msg.from.kind && p.identifierKey === key)) {
          await CrmConversationRepository.ensureParticipant({ companyId: channel.companyId, conversationId: conv.id, channelId: channel.id, participantType: msg.from.kind === "SESSION" ? "ANONYMOUS" : "EXTERNAL", role: "CUSTOMER", identifierKind: msg.from.kind, externalIdentifier: msg.from.value, identifierKey: key, displayName: msg.from.displayName ?? null }, ctx.tx);
          created = false;
        }
        // A new message reopens a closed or pending conversation so nothing waits unseen.
        if (conv.status === "CLOSED" || conv.status === "PENDING") {
          const from = conv.status;
          conv = await CrmConversationRepository.update(conv.id, { status: "OPEN", closedAt: null, closedByUserId: null }, ctx.tx);
          emitConversation(ctx, conv, from === "CLOSED" ? "conversation.reopened" : "conversation.status_changed", `${from === "CLOSED" ? "Closed" : "Pending"} → Open (new message from the customer)`, { from, to: "OPEN", automatic: true });
          if (from === "CLOSED") await notifyConversationAssignee(ctx.tx, { ...conv, companyId: channel.companyId }, conv.assignedToUserId, "Conversation reopened by a new message");
        }
      }

      const messageId = randomUUID();
      await ctx.tx.crmMessage.create({
        data: {
          id: messageId,
          companyId: channel.companyId,
          conversationId: conv.id,
          channelId: channel.id,
          direction: "INBOUND",
          messageType: msg.messageType,
          subject: msg.subject,
          body: msg.body,
          senderIdentifier: msg.from.value,
          senderName: msg.from.displayName ?? null,
          recipientIdentifier: msg.to?.value ?? null,
          status: "RECEIVED",
          providerMessageId: msg.providerMessageId,
          occurredAt: msg.occurredAt,
          metadata: msg.metadata as Prisma.InputJsonValue,
        },
      });
      if (files.length) await createAttachmentRows(ctx.tx, channel.companyId, channel.createdByUserId, conv.id, messageId, files, "Received message");
      const preview = messagePreview(msg.body, files.length, msg.messageType);
      const newest = !conv.lastMessageAt || msg.occurredAt.getTime() >= conv.lastMessageAt.getTime();
      conv = await CrmConversationRepository.update(
        conv.id,
        {
          messageCount: { increment: 1 },
          unreadCount: { increment: 1 },
          lastInboundAt: !conv.lastInboundAt || msg.occurredAt > conv.lastInboundAt ? msg.occurredAt : conv.lastInboundAt,
          ...(newest ? { lastMessageAt: msg.occurredAt, lastMessagePreview: preview, lastMessageDirection: "INBOUND" } : {}),
          ...(!conv.subject && msg.subject ? { subject: msg.subject } : {}),
          ...(!conv.displayName && msg.from.displayName ? { displayName: msg.from.displayName } : {}),
        },
        ctx.tx
      );
      emitConversation(ctx, conv, "message.received", `${senderLabel}: ${preview}`, { messageId, direction: "INBOUND", status: "RECEIVED", occurredAt: msg.occurredAt, messageType: msg.messageType, attachmentCount: files.length });
      await refreshSearchText(ctx.tx, conv.id);
      await touchLinkedRecords(ctx.tx, channel.companyId, linkedRefs(conv), msg.occurredAt, channel.channelType);
      await ctx.tx.crmChannel.update({ where: { id: channel.id }, data: { lastInboundAt: now } });
      return { outcome: "created" as const, messageId, conversationId: conv.id, conversationCreated: created };
    });
  } catch (e) {
    await cleanup(files);
    if (e instanceof DuplicateInbound) return { outcome: "duplicate", messageId: e.existing.id, conversationId: e.existing.conversationId, conversationCreated: false };
    if (isUniqueViolation(e)) {
      const again = await CrmConversationRepository.findMessageByProviderId(channel.id, msg.providerMessageId);
      if (again) return { outcome: "duplicate", messageId: again.id, conversationId: again.conversationId, conversationCreated: false };
    }
    throw e;
  }
}

/** Delivery receipts (sent / delivered / read / failed). Forward-only and idempotent. */
export async function applyDeliveryStatus(channel: DeliveryChannel, update: NormalizedStatusUpdate): Promise<{ outcome: "applied" | "ignored" | "unknown_message"; messageId: string | null }> {
  const m = await CrmConversationRepository.findMessageByProviderId(channel.id, update.providerMessageId);
  if (!m) return { outcome: "unknown_message", messageId: null };
  if (m.direction !== "OUTBOUND" || !canApplyDeliveryStatus(m.status, update.status)) return { outcome: "ignored", messageId: m.id };
  const applied = await runCrmMutation(crmSystemActor(channel.companyId), async (ctx) => {
    const at = update.occurredAt;
    const data: Prisma.CrmMessageUncheckedUpdateManyInput = { status: update.status };
    if (update.status === "SENT") data.sentAt = m.sentAt ?? at;
    if (update.status === "DELIVERED") Object.assign(data, { deliveredAt: at, sentAt: m.sentAt ?? at, errorCode: null, errorMessage: null, failedAt: null });
    if (update.status === "READ") Object.assign(data, { readAt: at, deliveredAt: m.deliveredAt ?? at, sentAt: m.sentAt ?? at, errorCode: null, errorMessage: null, failedAt: null });
    if (update.status === "FAILED") Object.assign(data, { failedAt: at, errorCode: (update.errorCode ?? "PROVIDER_REPORTED_FAILURE").slice(0, 60), errorMessage: (update.errorMessage ?? "The provider reported that the message could not be delivered.").slice(0, 300) });
    const { count } = await ctx.tx.crmMessage.updateMany({ where: { id: m.id, status: m.status }, data });
    if (!count) return false;
    const conv = (await CrmConversationRepository.findOne(channel.companyId, m.conversationId, ctx.tx))!;
    const eventType = update.status === "SENT" ? "message.sent" : update.status === "DELIVERED" ? "message.delivered" : update.status === "READ" ? "message.read" : "message.failed";
    const summary = update.status === "FAILED" ? `Not delivered: ${data.errorMessage as string}` : update.status === "SENT" ? `Sent: ${messagePreview(m.body, m.attachments.length, m.messageType)}` : update.status === "DELIVERED" ? "Delivered to the customer" : "Read by the customer";
    emitConversation(ctx, conv, eventType, summary, { messageId: m.id, direction: "OUTBOUND", status: update.status, occurredAt: at, source: "PROVIDER" });
    if (update.status === "FAILED") await ctx.audit({ tableName: MESSAGES, recordId: m.id, action: "UPDATE", oldValues: { status: m.status }, newValues: { status: "FAILED", errorCode: data.errorCode, source: "PROVIDER" } });
    return true;
  });
  return { outcome: applied ? "applied" : "ignored", messageId: m.id };
}

/**
 * Webhook entry point (public route): finds the channel, lets its provider
 * authenticate and normalise the delivery, then stores each event. Raw
 * provider payloads never reach the CRM tables.
 */
export async function handleChannelWebhook(input: { providerKey: string; channelId: string; headers: Headers; rawBody: string; now?: Date }) {
  const channel = await CrmConversationRepository.findChannelForDelivery(input.channelId);
  if (!channel || channel.provider !== input.providerKey) throw new BusinessRuleError("NOT_FOUND", "Webhook not found.");
  const provider = providerOf(channel);
  if (channel.status !== "ACTIVE") return { paused: true as const };
  const pc = providerChannel(channel, channel.secretEncrypted);
  const request = { headers: input.headers, rawBody: input.rawBody, now: input.now ?? new Date() };
  const check = provider.verifyWebhook(pc, request);
  if (!check.ok) throw new BusinessRuleError("INVALID_WEBHOOK_SIGNATURE", check.reason);
  let events;
  try {
    events = provider.normalizeInbound(pc, request);
  } catch (e) {
    if (e instanceof ProviderPayloadError) throw new BusinessRuleError("VALIDATION_ERROR", e.message);
    throw e;
  }
  const results: Record<string, unknown>[] = [];
  for (const ev of events) {
    if (ev.type === "message") {
      try {
        const r = await ingestInboundMessage(channel, ev.message);
        results.push({ type: "message", id: ev.message.providerMessageId, ...r });
      } catch (e) {
        if (e instanceof ProviderPayloadError) results.push({ type: "message", id: ev.message.providerMessageId, outcome: "rejected", reason: e.message });
        else throw e;
      }
    } else {
      const r = await applyDeliveryStatus(channel, ev.status);
      results.push({ type: "status", id: ev.status.providerMessageId, status: ev.status.status, ...r });
    }
  }
  return { paused: false as const, received: events.length, results };
}

// ── Outbound ─────────────────────────────────────────────────────

export interface OutgoingFile {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}

type SendContext = {
  conversation: ConversationRow;
  channel: NonNullable<Awaited<ReturnType<typeof CrmConversationRepository.findChannelForDelivery>>>;
  provider: ChannelProvider;
  pc: ProviderChannel;
  recipient: NormalizedIdentity;
};

/** Everything that must hold before anything is sent: channel, capabilities, DND, recipient. */
async function prepareSend(conversation: ConversationRow, opts: { hasText: boolean; files: { mimeType: string; size: number }[]; subject: string | null; textLength: number }): Promise<SendContext> {
  if (conversation.status === "ARCHIVED") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This conversation is archived. Restore it before replying.");
  const channel = await CrmConversationRepository.findChannelForDelivery(conversation.channelId);
  if (!channel) throw new BusinessRuleError("CRM_CHANNEL_UNAVAILABLE", "This conversation's channel no longer exists.");
  const caps = channelCapabilities(channel);
  const unavailable = (message: string) => new BusinessRuleError("CRM_CHANNEL_UNAVAILABLE", message, { channelId: channel.id });
  if (!caps.canSend) throw unavailable(caps.sendUnavailableReason ?? "This channel can't send messages.");
  if (opts.hasText && !caps.supportsText) throw unavailable("This channel can't send text messages.");
  if (opts.textLength > caps.maxTextLength) throw new BusinessRuleError("VALIDATION_ERROR", `Messages on this channel can be at most ${caps.maxTextLength} characters.`, { fieldErrors: { body: `At most ${caps.maxTextLength} characters.` } });
  if (opts.subject && !caps.supportsSubject) throw new BusinessRuleError("VALIDATION_ERROR", "This channel doesn't use a subject line.", { fieldErrors: { subject: "Remove the subject." } });
  if (opts.files.length) {
    if (!caps.supportsAttachments) throw unavailable("This channel can't send attachments.");
    if (opts.files.length > caps.maxAttachments) throw new BusinessRuleError("VALIDATION_ERROR", `At most ${caps.maxAttachments} attachments per message on this channel.`, { fieldErrors: { files: "Too many files." } });
    const total = opts.files.reduce((s, f) => s + f.size, 0);
    if (total > caps.maxAttachmentBytes) throw new BusinessRuleError("VALIDATION_ERROR", `Attachments can be at most ${Math.round(caps.maxAttachmentBytes / 1024 / 1024)} MB in total on this channel.`, { fieldErrors: { files: "Files too large." } });
    for (const f of opts.files) if (!caps.attachmentKinds.includes(attachmentKindOf(f.mimeType))) throw unavailable(`This channel can't send ${f.mimeType} files.`);
  }
  // DND / contactability — enforced here, whatever the UI shows.
  const contactability = await contactabilityFor(conversation);
  if (!contactability.allowed) throw new BusinessRuleError("CRM_CONTACT_NOT_CONTACTABLE", contactability.message ?? "This contact can't be messaged on this channel.", { decidedBy: contactability.decidedBy, status: contactability.status });
  const participants = await CrmConversationRepository.participants(conversation.id);
  const customer = participants.find((p) => p.role === "CUSTOMER" && p.identifierKind && p.externalIdentifier);
  if (!customer) throw unavailable("This conversation has no customer address to reply to.");
  const recipient: NormalizedIdentity = { kind: customer.identifierKind as IdentifierKind, value: customer.externalIdentifier as string, displayName: customer.displayName };
  const provider = providerOf(channel);
  const pc = providerChannel(channel, channel.secretEncrypted);
  const check = provider.validateRecipient(pc, recipient);
  if (!check.ok) throw unavailable(check.reason);
  return { conversation, channel, provider, pc, recipient };
}

/** Calls the provider (outside any transaction) and saves its answer as SENT / FAILED. */
async function deliver(actor: CrmActor | CrmSystemActor, ctxSend: SendContext, message: MessageRow, attachments: OutboundAttachment[], attempt: number) {
  const latestInbound = await CrmConversationRepository.latestInbound(ctxSend.conversation.id);
  let result: SendResult;
  try {
    result = await ctxSend.provider.sendMessage(ctxSend.pc, {
      idempotencyKey: message.id,
      conversation: { id: ctxSend.conversation.id, threadRef: ctxSend.conversation.externalThreadRef },
      to: ctxSend.recipient,
      subject: message.subject,
      body: message.body,
      attachments,
      replyToProviderMessageId: latestInbound?.providerMessageId ?? null,
      metadata: {},
    });
  } catch (e) {
    // Providers must not throw; if one does, log the class of error only (never payloads or secrets).
    logger.error("CRM channel provider threw while sending", { provider: ctxSend.provider.key, channelId: ctxSend.channel.id, messageId: message.id, error: e instanceof Error ? e.name : "unknown" });
    result = { ok: false, errorCode: "PROVIDER_ERROR", errorMessage: "The provider failed unexpectedly.", retryable: true };
  }
  const now = new Date();
  await runCrmMutation(actor, async (ctx) => {
    const conv = (await CrmConversationRepository.findOne(ctxSend.conversation.companyId, ctxSend.conversation.id, ctx.tx))!;
    const preview = messagePreview(message.body, message.attachments.length, message.messageType);
    if (result.ok) {
      const data: Prisma.CrmMessageUncheckedUpdateManyInput = { status: result.status, providerMessageId: result.providerMessageId, sentAt: result.occurredAt ?? now, errorCode: null, errorMessage: null, failedAt: null };
      if (result.status === "DELIVERED" || result.status === "READ") data.deliveredAt = now;
      if (result.status === "READ") data.readAt = now;
      // A provider id already used by another message on this channel (a misbehaving relay) would break the
      // unique index and abort the transaction: keep the send, drop the duplicate reference. Checked before
      // writing because a failed statement can't be recovered inside a PostgreSQL transaction.
      const clash = await ctx.tx.crmMessage.findFirst({ where: { channelId: message.channelId, providerMessageId: result.providerMessageId, id: { not: message.id } }, select: { id: true } });
      if (clash) data.providerMessageId = null;
      await ctx.tx.crmMessage.updateMany({ where: { id: message.id, status: "QUEUED" }, data });
      await ctx.audit({ tableName: MESSAGES, recordId: message.id, action: "UPDATE", oldValues: { status: "QUEUED" }, newValues: { status: result.status, providerMessageId: result.providerMessageId, attempt } });
      emitConversation(ctx, conv, "message.sent", preview, { messageId: message.id, direction: "OUTBOUND", status: result.status, occurredAt: now, attempt, attachmentCount: message.attachments.length });
    } else {
      await ctx.tx.crmMessage.updateMany({ where: { id: message.id, status: "QUEUED" }, data: { status: "FAILED", failedAt: now, errorCode: result.errorCode.slice(0, 60), errorMessage: result.errorMessage.slice(0, 300) } });
      await ctx.audit({ tableName: MESSAGES, recordId: message.id, action: "UPDATE", oldValues: { status: "QUEUED" }, newValues: { status: "FAILED", errorCode: result.errorCode, attempt } });
      emitConversation(ctx, conv, "message.failed", `Not sent: ${result.errorMessage}`, { messageId: message.id, direction: "OUTBOUND", status: "FAILED", occurredAt: now, attempt, errorCode: result.errorCode, retryable: result.retryable });
    }
  });
  return (await CrmConversationRepository.findMessage(ctxSend.conversation.companyId, message.id))!;
}

async function storeOutgoing(files: OutgoingFile[]): Promise<StoredFile[]> {
  const out: StoredFile[] = [];
  for (const f of files) {
    try {
      const stored = await saveFile(f.buffer, f.fileName, f.mimeType);
      out.push({ kind: attachmentKindOf(f.mimeType), fileName: f.fileName, mimeType: f.mimeType, sizeBytes: stored.fileSizeBytes, storageKey: stored.storageKey, providerMediaRef: null });
    } catch (e) {
      await cleanup(out);
      if (e instanceof UnsupportedFileTypeError || e instanceof FileTooLargeError) throw new BusinessRuleError("VALIDATION_ERROR", e.message, { fieldErrors: { files: e.message } });
      throw e;
    }
  }
  return out;
}

/**
 * Reply in a conversation. The message is saved (QUEUED) before the provider
 * is called, so it is never lost: a provider failure leaves it FAILED with a
 * safe reason and a Retry. `clientMessageId` makes a double submit harmless.
 */
export async function sendConversationMessage(actor: CrmActor, conversationId: string, raw: unknown, files: OutgoingFile[] = []) {
  const input = sendMessageSchema.parse(raw);
  const { row } = await loadConversation(actor, conversationId);
  const canRetry = { canRetry: true };
  if (input.clientMessageId) {
    const existing = await CrmConversationRepository.findMessage(actor.companyId, input.clientMessageId);
    if (existing) {
      if (existing.conversationId !== row.id) throw new BusinessRuleError("VALIDATION_ERROR", "That message id is already used.");
      return presentMessage(existing, canRetry);
    }
  }
  const body = input.body.trim();
  const subject = input.subject?.trim() || null;
  if (!body && !files.length) throw new BusinessRuleError("VALIDATION_ERROR", "Write a message or attach a file.", { fieldErrors: { body: "Write a message." } });
  const send = await prepareSend(row, { hasText: Boolean(body), files: files.map((f) => ({ mimeType: f.mimeType, size: f.buffer.byteLength })), subject, textLength: body.length });
  const stored = await storeOutgoing(files);
  const messageId = input.clientMessageId ?? randomUUID();
  const now = new Date();
  const messageType = body ? "TEXT" : stored[0]?.kind === "IMAGE" ? "IMAGE" : "DOCUMENT";
  try {
    await runCrmMutation(actor, async (ctx) => {
      await ctx.tx.$queryRaw`SELECT id FROM crm_conversations WHERE id = ${row.id}::uuid FOR UPDATE`;
      await ctx.tx.crmMessage.create({
        data: {
          id: messageId,
          companyId: actor.companyId,
          conversationId: row.id,
          channelId: row.channelId,
          direction: "OUTBOUND",
          messageType,
          subject,
          body,
          senderIdentifier: send.channel.address,
          recipientIdentifier: send.recipient.value,
          senderUserId: actor.userId,
          status: "QUEUED",
          occurredAt: now,
          attempts: 1,
          lastAttemptAt: now,
        },
      });
      if (stored.length) await createAttachmentRows(ctx.tx, actor.companyId, actor.userId, row.id, messageId, stored, "Sent message");
      await CrmConversationRepository.ensureParticipant({ companyId: actor.companyId, conversationId: row.id, channelId: row.channelId, participantType: "USER", role: "AGENT", userId: actor.userId }, ctx.tx);
      // Replying means the team has read the conversation.
      await ctx.tx.crmMessage.updateMany({ where: { conversationId: row.id, direction: "INBOUND", seenAt: null }, data: { seenAt: now, seenByUserId: actor.userId } });
      const reopen = row.status === "CLOSED";
      const after = await CrmConversationRepository.update(
        row.id,
        {
          messageCount: { increment: 1 },
          unreadCount: 0,
          lastReadAt: now,
          lastReadByUserId: actor.userId,
          lastMessageAt: now,
          lastMessagePreview: messagePreview(body, stored.length, messageType),
          lastMessageDirection: "OUTBOUND",
          lastOutboundAt: now,
          ...(reopen ? { status: "OPEN", closedAt: null, closedByUserId: null } : {}),
        },
        ctx.tx
      );
      if (reopen) emitConversation(ctx, after, "conversation.reopened", "Closed → Open (reply sent)", { from: "CLOSED", to: "OPEN" });
      await ctx.audit({ tableName: MESSAGES, recordId: messageId, action: "CREATE", newValues: { conversationId: row.id, direction: "OUTBOUND", status: "QUEUED", subject, body, attachments: stored.map((f) => f.fileName) } });
      await touchLinkedRecords(ctx.tx, actor.companyId, linkedRefs(row), now, row.channelType);
    });
  } catch (e) {
    await cleanup(stored);
    if (isUniqueViolation(e) && input.clientMessageId) {
      const existing = await CrmConversationRepository.findMessage(actor.companyId, input.clientMessageId);
      if (existing) return presentMessage(existing, canRetry);
    }
    throw e;
  }
  const message = (await CrmConversationRepository.findMessage(actor.companyId, messageId))!;
  const outbound: OutboundAttachment[] = stored.map((f, i) => ({ kind: f.kind, fileName: f.fileName, mimeType: f.mimeType, content: files[i].buffer }));
  return presentMessage(await deliver(actor, send, message, outbound, 1), canRetry);
}

/** Retry a failed outbound message: same message, same idempotency key, checks re-run (DND may have changed). */
export async function retryConversationMessage(actor: CrmActor, conversationId: string, messageId: string) {
  const { row } = await loadConversation(actor, conversationId);
  const message = await CrmConversationRepository.findMessage(actor.companyId, messageId);
  if (!message || message.conversationId !== row.id || message.direction !== "OUTBOUND") throw new BusinessRuleError("NOT_FOUND", "Message not found.", { id: messageId });
  if (message.status !== "FAILED") throw new BusinessRuleError("INVALID_STATE_TRANSITION", message.status === "QUEUED" ? "This message is being sent right now." : "Only a failed message can be retried.", { status: message.status });
  const files = await prisma.crmMessageAttachment.findMany({ where: { messageId }, include: { attachment: { select: { storageKey: true } } } });
  const send = await prepareSend(row, { hasText: Boolean(message.body), files: files.map((f) => ({ mimeType: f.mimeType, size: f.sizeBytes ?? 0 })), subject: message.subject, textLength: message.body.length });
  const outbound: OutboundAttachment[] = [];
  for (const f of files) {
    if (!f.attachment) throw new BusinessRuleError("CRM_CHANNEL_UNAVAILABLE", `The file "${f.fileName}" is no longer stored, so the message can't be resent.`);
    outbound.push({ kind: f.kind as AttachmentKind, fileName: f.fileName, mimeType: f.mimeType, content: await readStoredFile(f.attachment.storageKey) });
  }
  const now = new Date();
  // Claim the retry atomically: two clicks never send twice.
  await runCrmMutation(actor, async (ctx) => {
    const { count } = await ctx.tx.crmMessage.updateMany({ where: { id: messageId, status: "FAILED" }, data: { status: "QUEUED", attempts: { increment: 1 }, lastAttemptAt: now, failedAt: null, errorCode: null, errorMessage: null } });
    if (!count) throw conversationConflict(row.id);
    await ctx.audit({ tableName: MESSAGES, recordId: messageId, action: "UPDATE", oldValues: { status: "FAILED", errorCode: message.errorCode }, newValues: { status: "QUEUED", retry: true, attempt: message.attempts + 1 } });
  });
  const fresh = (await CrmConversationRepository.findMessage(actor.companyId, messageId))!;
  return presentMessage(await deliver(actor, send, fresh, outbound, fresh.attempts), { canRetry: true });
}

/**
 * Worker sweep: an outbound message still QUEUED long after its attempt means
 * the process stopped between calling the provider and saving the answer. It
 * is marked FAILED with a warning (it may have been delivered) so a person
 * decides whether to retry — never resent automatically.
 */
export async function failStaleOutboundMessages(now: Date = new Date()) {
  const cutoff = new Date(now.getTime() - STALE_SEND_MINUTES * 60_000);
  const stale = await CrmConversationRepository.staleQueued(cutoff);
  let failed = 0;
  for (const s of stale) {
    const done = await runCrmMutation(crmSystemActor(s.companyId), async (ctx: CrmMutationContext) => {
      const errorMessage = "Sending was interrupted before the provider answered. It may or may not have been delivered — check before retrying.";
      const { count } = await ctx.tx.crmMessage.updateMany({ where: { id: s.id, status: "QUEUED", lastAttemptAt: { lt: cutoff } }, data: { status: "FAILED", failedAt: now, errorCode: "SEND_INTERRUPTED", errorMessage } });
      if (!count) return false;
      const m = (await ctx.tx.crmMessage.findUnique({ where: { id: s.id }, select: { conversationId: true } }))!;
      const conv = (await CrmConversationRepository.findOne(s.companyId, m.conversationId, ctx.tx))!;
      await ctx.audit({ tableName: MESSAGES, recordId: s.id, action: "UPDATE", oldValues: { status: "QUEUED" }, newValues: { status: "FAILED", errorCode: "SEND_INTERRUPTED" } });
      emitConversation(ctx, conv, "message.failed", `Not sent: ${errorMessage}`, { messageId: s.id, direction: "OUTBOUND", status: "FAILED", occurredAt: now, errorCode: "SEND_INTERRUPTED", retryable: true });
      return true;
    });
    if (done) failed++;
  }
  return { failed };
}
