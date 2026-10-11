import { CHANNEL_TYPES, IDENTIFIER_KINDS, type ChannelType, type IdentifierKind } from "@/core/communication/CommunicationProvider";
import { emailKey, phoneKey } from "../core/crm-normalize";
import type { ContactabilityChannel } from "../contacts/contact-registry";

/**
 * Client-safe registry for unified conversations (Phase 11). Stored as text
 * and validated here (plus CHECK constraints), like every other CRM registry,
 * so a new channel type or status is one entry — no migration.
 */

export { CHANNEL_TYPES, IDENTIFIER_KINDS, type ChannelType, type IdentifierKind };

export const CHANNEL_TYPE_LABELS: Record<ChannelType, string> = {
  EMAIL: "Email",
  SMS: "SMS",
  WHATSAPP: "WhatsApp",
  FACEBOOK_MESSENGER: "Facebook Messenger",
  INSTAGRAM: "Instagram",
  WEB_CHAT: "Website chat",
  OTHER: "Other",
};

export const CHANNEL_STATUSES = { ACTIVE: "Active", PAUSED: "Paused" } as const;
export type ChannelStatus = keyof typeof CHANNEL_STATUSES;

// ── Conversation lifecycle ──────────────────────────────────────

export const CONVERSATION_STATUSES = {
  OPEN: { label: "Open", tone: "blue" },
  PENDING: { label: "Pending", tone: "amber" },
  CLOSED: { label: "Closed", tone: "zinc" },
  ARCHIVED: { label: "Archived", tone: "zinc" },
} as const;
export type ConversationStatus = keyof typeof CONVERSATION_STATUSES;
export const CONVERSATION_STATUS_KEYS = Object.keys(CONVERSATION_STATUSES) as [ConversationStatus, ...ConversationStatus[]];

/** Allowed status changes. Closing never deletes anything; archived conversations can be restored. */
export const CONVERSATION_TRANSITIONS: Record<ConversationStatus, ConversationStatus[]> = {
  OPEN: ["PENDING", "CLOSED", "ARCHIVED"],
  PENDING: ["OPEN", "CLOSED", "ARCHIVED"],
  CLOSED: ["OPEN", "ARCHIVED"],
  ARCHIVED: ["OPEN"],
};

export function canChangeConversationStatus(from: string, to: ConversationStatus): boolean {
  return (CONVERSATION_TRANSITIONS[from as ConversationStatus] ?? []).includes(to);
}

export const MATCH_STATUSES = {
  MATCHED: "Linked",
  UNMATCHED: "Unmatched",
  MULTIPLE: "Several possible contacts",
} as const;
export type MatchStatus = keyof typeof MATCH_STATUSES;

// ── Messages ────────────────────────────────────────────────────

export const MESSAGE_DIRECTIONS = ["INBOUND", "OUTBOUND"] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

export const MESSAGE_STATUSES = {
  RECEIVED: "Received",
  QUEUED: "Sending…",
  SENT: "Sent",
  DELIVERED: "Delivered",
  READ: "Read",
  FAILED: "Failed",
} as const;
export type MessageStatus = keyof typeof MESSAGE_STATUSES;

const RANK: Partial<Record<MessageStatus, number>> = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3 };

/**
 * Delivery updates only move forward (a late "delivered" never overrides
 * "read"). FAILED is accepted while the message is queued or sent; a later
 * success from the provider wins over an earlier failure (provider truth).
 */
export function canApplyDeliveryStatus(current: string, next: "SENT" | "DELIVERED" | "READ" | "FAILED"): boolean {
  if (current === next) return false;
  if (next === "FAILED") return current === "QUEUED" || current === "SENT";
  if (current === "FAILED") return true;
  const a = RANK[current as MessageStatus];
  const b = RANK[next];
  return a !== undefined && b !== undefined && b > a;
}

export const MESSAGE_PAGE_SIZE = 50;
export const PREVIEW_LENGTH = 140;
/** An outbound message still QUEUED after this long (crash between send and save) is marked failed by the sweeper. */
export const STALE_SEND_MINUTES = 10;
export const MAX_BODY_LENGTH = 10_000;

export function messagePreview(body: string, attachmentCount: number, messageType = "TEXT"): string {
  const t = body.replace(/\s+/g, " ").trim();
  if (t) return t.length > PREVIEW_LENGTH ? `${t.slice(0, PREVIEW_LENGTH - 1)}…` : t;
  if (messageType === "LOCATION") return "[Location]";
  if (attachmentCount) return attachmentCount === 1 ? "[Attachment]" : `[${attachmentCount} attachments]`;
  return "(empty message)";
}

// ── Identities & contactability ─────────────────────────────────

/** Normalised identity key used for matching and participant uniqueness. */
export function identifierKey(kind: IdentifierKind, value: string): string | null {
  if (kind === "EMAIL") return emailKey(value);
  if (kind === "PHONE") return phoneKey(value);
  const v = value.trim();
  return v ? v.slice(0, 200) : null;
}

/**
 * Which Phase 04 contactability channel governs a conversation channel.
 * Channels without their own consent row (Messenger, Instagram, website
 * chat, other) are governed by the contact-wide "All channels" restriction.
 */
export const CONTACTABILITY_CHANNEL_FOR: Record<ChannelType, Exclude<ContactabilityChannel, "ALL"> | null> = {
  EMAIL: "EMAIL",
  SMS: "SMS",
  WHATSAPP: "WHATSAPP",
  FACEBOOK_MESSENGER: null,
  INSTAGRAM: null,
  WEB_CHAT: null,
  OTHER: null,
};

// ── Inbox ───────────────────────────────────────────────────────

export const INBOX_FOLDERS = {
  all: "All",
  unread: "Unread",
  mine: "Assigned to me",
  unassigned: "Unassigned",
  unmatched: "Unmatched",
} as const;
export type InboxFolder = keyof typeof INBOX_FOLDERS;
export const INBOX_FOLDER_KEYS = Object.keys(INBOX_FOLDERS) as [InboxFolder, ...InboxFolder[]];

// ── Events ──────────────────────────────────────────────────────

/** Automation-facing events (crm_events, entity CONVERSATION). Payload: ConversationEventPayload. */
export const CONVERSATION_EVENT_TYPES = [
  "conversation.created",
  "conversation.updated",
  "conversation.assigned",
  "conversation.status_changed",
  "conversation.closed",
  "conversation.reopened",
  "conversation.archived",
  "conversation.contact_linked",
  "conversation.company_linked",
  "conversation.opportunity_linked",
  "message.received",
  "message.sent",
  "message.failed",
  "message.delivered",
  "message.read",
] as const;
export type ConversationEventType = (typeof CONVERSATION_EVENT_TYPES)[number];

/**
 * Event payload (schemaVersion 1). Ids and routing facts only — the message
 * body is not copied into every event (consumers load it by messageId).
 * The event row's own id is the idempotency key for consumers.
 */
export interface ConversationEventPayload {
  schemaVersion: 1;
  conversationId: string;
  messageId: string | null;
  channelId: string;
  channelType: string;
  contactId: string | null;
  crmCompanyId: string | null;
  opportunityId: string | null;
  assignedUserId: string | null;
  direction: MessageDirection | null;
  status: string;
  occurredAt: string;
  [extra: string]: unknown;
}
