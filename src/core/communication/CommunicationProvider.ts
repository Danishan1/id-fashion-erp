/**
 * Channel provider contract — the one seam between the CRM's unified
 * conversations (Phase 11, src/modules/crm/conversations) and any messaging
 * provider (an email service, an SMS gateway, the WhatsApp Business API,
 * Messenger / Instagram, a website chat backend…).
 *
 *   Provider webhook → ChannelProvider.verifyWebhook / normalizeInbound
 *                    → Conversation service → Conversation → Message → CRM
 *   User reply       → Conversation service (DND, permissions, capabilities)
 *                    → ChannelProvider.sendMessage → normalised SendResult
 *
 * A provider only authenticates deliveries and translates payloads to and
 * from the provider-neutral shapes below. It never touches the database,
 * never decides who a sender is, and never sees internal notes. Adding a
 * channel later = one new provider file + one line in provider-registry.ts.
 *
 * Credentials: the per-channel webhook signing secret is stored encrypted
 * (crm_channels.secret_encrypted) and handed to the provider decrypted, server
 * side only. Provider API credentials, when a real provider is added, follow
 * the same rule — they never reach the browser or the logs.
 *
 * Before Phase 11 this file held a single-method stub (ManualCommunicationProvider)
 * that nothing called; the CRM's Call / Email / WhatsApp quick actions still
 * open the user's own apps (src/lib/communication.ts).
 */

export const CHANNEL_TYPES = ["EMAIL", "SMS", "WHATSAPP", "FACEBOOK_MESSENGER", "INSTAGRAM", "WEB_CHAT", "OTHER"] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

/** How a participant is identified on a channel. */
export const IDENTIFIER_KINDS = ["EMAIL", "PHONE", "PROVIDER_ID", "SESSION"] as const;
export type IdentifierKind = (typeof IDENTIFIER_KINDS)[number];

export const MESSAGE_TYPES = ["TEXT", "IMAGE", "FILE", "AUDIO", "VIDEO", "DOCUMENT", "LOCATION", "SYSTEM", "OTHER"] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export const ATTACHMENT_KINDS = ["IMAGE", "DOCUMENT", "AUDIO", "VIDEO", "FILE"] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

/** Delivery states a provider can report for an outbound message. */
export const PROVIDER_DELIVERY_STATUSES = ["SENT", "DELIVERED", "READ", "FAILED"] as const;
export type ProviderDeliveryStatus = (typeof PROVIDER_DELIVERY_STATUSES)[number];

/**
 * What a channel can do. The composer and the send service read this —
 * never `channelType === "WHATSAPP"` checks — so a provider decides its own
 * limits (and can make them depend on the channel's configuration).
 */
export interface ChannelCapabilities {
  canReceive: boolean;
  canSend: boolean;
  /** Shown when canSend is false ("No outbound connection is configured…"). */
  sendUnavailableReason: string | null;
  supportsText: boolean;
  supportsSubject: boolean;
  supportsAttachments: boolean;
  attachmentKinds: AttachmentKind[];
  /** Total bytes of attachments per outbound message. */
  maxAttachmentBytes: number;
  maxAttachments: number;
  maxTextLength: number;
  supportsTemplates: boolean;
  supportsReactions: boolean;
  supportsEdit: boolean;
  supportsDelete: boolean;
  /** Delivery states this provider reports back (others are never shown). */
  deliveryStatuses: ProviderDeliveryStatus[];
}

/** The configured channel as a provider sees it (server-side only — `secret` is decrypted). */
export interface ProviderChannel {
  id: string;
  companyId: string;
  channelType: ChannelType;
  provider: string;
  address: string | null;
  config: Record<string, unknown>;
  secret: string;
}

export interface NormalizedIdentity {
  kind: IdentifierKind;
  value: string;
  displayName?: string | null;
}

export interface NormalizedAttachment {
  kind: AttachmentKind;
  fileName: string;
  mimeType: string;
  sizeBytes?: number | null;
  /** File bytes when the provider delivered them inline. */
  content?: Buffer | null;
  /** Provider media id when the file must be fetched from the provider (not downloaded in Phase 11). */
  providerMediaRef?: string | null;
}

/**
 * Provider-neutral extras. Only these keys are stored — never the raw
 * provider payload. Email threading uses messageIdHeader / inReplyTo /
 * references; chat providers use replyToProviderMessageId.
 */
export interface NormalizedMessageMetadata {
  messageIdHeader?: string;
  inReplyTo?: string;
  references?: string[];
  replyToProviderMessageId?: string;
  location?: { latitude: number; longitude: number; name?: string | null };
}

export interface NormalizedInboundMessage {
  /** The provider's id for this message — the idempotency key (unique per channel). */
  providerMessageId: string;
  /** Provider thread / conversation reference when the provider has one (email root id, chat session). */
  threadRef: string | null;
  from: NormalizedIdentity;
  /** Other identities of the same sender (a web-chat visitor who typed an email address). Used for matching only. */
  alternateIdentities: NormalizedIdentity[];
  to: NormalizedIdentity | null;
  occurredAt: Date;
  messageType: MessageType;
  subject: string | null;
  body: string;
  attachments: NormalizedAttachment[];
  metadata: NormalizedMessageMetadata;
}

export interface NormalizedStatusUpdate {
  providerMessageId: string;
  status: ProviderDeliveryStatus;
  occurredAt: Date;
  /** Safe, short reason for FAILED (no provider internals). */
  errorCode?: string | null;
  errorMessage?: string | null;
}

export type NormalizedInboundEvent = { type: "message"; message: NormalizedInboundMessage } | { type: "status"; status: NormalizedStatusUpdate };

export interface ProviderWebhookRequest {
  headers: Headers;
  rawBody: string;
  now: Date;
}

export type WebhookVerification = { ok: true } | { ok: false; reason: string };

export interface OutboundAttachment {
  kind: AttachmentKind;
  fileName: string;
  mimeType: string;
  content: Buffer;
}

export interface OutboundMessage {
  /** Stable per CRM message (its id) — the same key on every retry, so the provider can de-duplicate. */
  idempotencyKey: string;
  conversation: { id: string; threadRef: string | null };
  to: NormalizedIdentity;
  subject: string | null;
  body: string;
  attachments: OutboundAttachment[];
  /** Provider id of the message being replied to (threading), when known. */
  replyToProviderMessageId: string | null;
  metadata: NormalizedMessageMetadata;
}

export type SendResult =
  | { ok: true; providerMessageId: string; status: Exclude<ProviderDeliveryStatus, "FAILED">; occurredAt?: Date }
  | { ok: false; errorCode: string; errorMessage: string; retryable: boolean };

export type RecipientCheck = { ok: true } | { ok: false; reason: string };

export class ProviderPayloadError extends Error {}
export class ProviderConfigError extends Error {
  constructor(
    message: string,
    readonly field?: string
  ) {
    super(message);
  }
}

export interface ChannelProvider {
  /** Stored in crm_channels.provider and used in the webhook URL. */
  readonly key: string;
  readonly label: string;
  /** Channel types this provider can serve. */
  readonly channelTypes: readonly ChannelType[];
  /** Validates and normalises the channel's non-secret settings (throws ProviderConfigError). */
  validateConfig(channelType: ChannelType, config: unknown): Record<string, unknown>;
  capabilities(channel: Pick<ProviderChannel, "channelType" | "config">): ChannelCapabilities;
  /** Authenticates a webhook delivery (signature, token, timestamp / replay window). */
  verifyWebhook(channel: ProviderChannel, request: ProviderWebhookRequest): WebhookVerification;
  /** Provider payload → provider-neutral events (throws ProviderPayloadError). Never touches the database. */
  normalizeInbound(channel: ProviderChannel, request: ProviderWebhookRequest): NormalizedInboundEvent[];
  validateRecipient(channel: ProviderChannel, to: NormalizedIdentity): RecipientCheck;
  /** Sends text and attachments in one call. Must not throw for provider errors — return { ok: false }. */
  sendMessage(channel: ProviderChannel, message: OutboundMessage): Promise<SendResult>;
  /** Optional pull of a delivery status for providers without status webhooks. */
  getDeliveryStatus?(channel: ProviderChannel, providerMessageId: string): Promise<NormalizedStatusUpdate | null>;
}

/** Capabilities of a channel that can receive but not send — the base every provider starts from. */
export function receiveOnlyCapabilities(reason: string): ChannelCapabilities {
  return {
    canReceive: true,
    canSend: false,
    sendUnavailableReason: reason,
    supportsText: true,
    supportsSubject: false,
    supportsAttachments: false,
    attachmentKinds: [],
    maxAttachmentBytes: 0,
    maxAttachments: 0,
    maxTextLength: 4096,
    supportsTemplates: false,
    supportsReactions: false,
    supportsEdit: false,
    supportsDelete: false,
    deliveryStatuses: [],
  };
}
