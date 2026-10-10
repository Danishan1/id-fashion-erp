import type { ChannelCapabilities } from "@/core/communication/CommunicationProvider";

/** Client-side shapes of the Phase 11 conversation API (see crm-conversations.service.ts). */

export const CONVERSATIONS_API = "/api/v1/crm/conversations";
export const CHANNEL_SETTINGS_API = "/api/v1/crm/settings/channels";

export type ConversationStatus = "OPEN" | "PENDING" | "CLOSED" | "ARCHIVED";
export type MatchStatus = "MATCHED" | "UNMATCHED" | "MULTIPLE";
export type InboxFolder = "all" | "unread" | "mine" | "unassigned" | "unmatched";

export interface InboxChannelDto {
  id: string;
  name: string;
  channelType: string;
  typeLabel: string;
  status: "ACTIVE" | "PAUSED";
  capabilities: ChannelCapabilities;
}

export interface InboxMetaDto {
  channels: InboxChannelDto[];
  statuses: { key: ConversationStatus; label: string }[];
  folders: { key: InboxFolder; label: string }[];
  canViewAll: boolean;
}

export interface InboxCountsDto {
  folders: Record<InboxFolder, number>;
  channels: { channelId: string; open: number; unreadMessages: number }[];
}

export interface ConversationDto {
  id: string;
  title: string;
  channel: { id: string; name: string; channelType: string; typeLabel: string; status: string; address?: string | null };
  subject: string | null;
  status: ConversationStatus;
  statusLabel: string;
  matchStatus: MatchStatus;
  matchLabel: string;
  contact: { id: string; fullName: string; href: string; archived: boolean } | null;
  company: { id: string; name: string; href: string; archived: boolean } | null;
  opportunity: { id: string; label: string; status: string; href: string } | null;
  assignedTo: { id: string; fullName: string } | null;
  displayName: string | null;
  displayIdentifier: string | null;
  unreadCount: number;
  messageCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastMessageDirection: "INBOUND" | "OUTBOUND" | null;
  createdAt: string;
  closedAt: string | null;
  version: number;
}

export interface ConversationDetailDto extends ConversationDto {
  participants: { id: string; type: string; role: string; identifierKind: string | null; identifier: string | null; displayName: string | null; contactId: string | null; user: { id: string; fullName: string } | null }[];
  capabilities: ChannelCapabilities;
  contactability: { allowed: boolean; decidedBy: string | null; status: string; message: string | null };
  matchCandidates: { id: string; fullName: string; companyName: string | null; email: string | null; phone: string | null; archived: boolean }[];
  opportunityChoices: { id: string; label: string }[];
  permissions: { send: boolean; note: boolean; task: boolean; assign: boolean; link: boolean; createContact: boolean; status: boolean; viewAll: boolean };
}

export interface MessageAttachmentDto {
  id: string;
  kind: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number | null;
  stored: boolean;
  downloadUrl: string | null;
}

export interface ThreadMessage {
  kind: "message";
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  messageType: string;
  subject: string | null;
  body: string;
  status: string;
  statusLabel: string;
  senderName: string;
  senderIdentifier: string | null;
  senderUser: { id: string; fullName: string } | null;
  occurredAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  failedAt: string | null;
  error: { code: string | null; message: string } | null;
  attachments: MessageAttachmentDto[];
  location: { latitude: number; longitude: number; name?: string | null } | null;
  /** Phase 12: written from a template (body = what was actually sent). */
  template?: { id: string; versionId: string | null; name: string | null; versionNumber: number | null; edited: boolean } | null;
  canRetry: boolean;
}

export interface ThreadNote {
  kind: "note";
  id: string;
  body: string;
  author: { id: string; fullName: string };
  createdAt: string;
  editedAt: string | null;
  canEdit: boolean;
  canDelete: boolean;
}

export interface ThreadEvent {
  kind: "event";
  id: string;
  eventType: string;
  summary: string | null;
  actor: { id: string; fullName: string } | null;
  occurredAt: string;
}

export type ThreadItem = ThreadMessage | ThreadNote | ThreadEvent;

export const itemTime = (i: ThreadItem) => (i.kind === "note" ? i.createdAt : i.occurredAt);

/** Merge pages / refreshes by id, keeping chronological order (time, then id). */
export function mergeThread(a: ThreadItem[], b: ThreadItem[]): ThreadItem[] {
  const map = new Map<string, ThreadItem>();
  for (const i of [...a, ...b]) map.set(`${i.kind}:${i.id}`, i);
  return [...map.values()].sort((x, y) => new Date(itemTime(x)).getTime() - new Date(itemTime(y)).getTime() || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

export const STATUS_TONES: Record<ConversationStatus, "indigo" | "amber" | "neutral"> = { OPEN: "indigo", PENDING: "amber", CLOSED: "neutral", ARCHIVED: "neutral" };

/** "10:42", "Mon", "12 Oct" — compact last-activity time for inbox rows. */
export function shortWhen(iso: string | null, now = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const days = (now.getTime() - d.getTime()) / 86_400_000;
  if (days >= 0 && days < 6) return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}

export const fullWhen = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** File-input accept attribute for the attachment kinds a channel supports. */
export function acceptFor(kinds: string[]): string {
  const parts: string[] = [];
  if (kinds.includes("IMAGE")) parts.push("image/jpeg", "image/png", "image/webp");
  if (kinds.includes("DOCUMENT")) parts.push(".pdf", ".doc", ".docx", ".xls", ".xlsx", ".csv");
  return parts.join(",");
}
