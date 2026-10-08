import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  MESSAGE_TYPES,
  PROVIDER_DELIVERY_STATUSES,
  ProviderConfigError,
  ProviderPayloadError,
  receiveOnlyCapabilities,
  type ChannelCapabilities,
  type ChannelProvider,
  type ChannelType,
  type IdentifierKind,
  type NormalizedAttachment,
  type NormalizedIdentity,
  type NormalizedInboundEvent,
  type OutboundMessage,
  type ProviderChannel,
  type SendResult,
} from "../CommunicationProvider";

/**
 * Generic signed-webhook provider — the reference adapter for the channel
 * contract and the way to connect any system that can speak HTTP + JSON
 * (a website chat backend, an n8n / Make / Zapier bridge, an in-house SMS
 * gateway). It is provider-neutral on purpose: no Meta, Google or Twilio
 * specifics live here. Same signing scheme as the Phase 03 lead webhooks.
 *
 * INBOUND  POST /api/v1/crm/webhooks/conversations/generic/<channelId>
 *   X-CRM-Timestamp: <unix seconds>   (requests older than 5 minutes are rejected)
 *   X-CRM-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>
 *   Body: one event, or { "events": [ … ] } (up to 50):
 *     { "type": "message", "id": "<unique message id>", "threadId"?: "…",
 *       "from": { "email"?, "phone"?, "id"?, "sessionId"?, "name"? },
 *       "timestamp"?: ISO-8601, "subject"?, "text"?, "messageType"?,
 *       "attachments"?: [{ "fileName", "mimeType", "contentBase64"? | "mediaId"?, "size"? }],
 *       "location"?: { "latitude", "longitude", "name"? }, "inReplyTo"?, "references"? }
 *     { "type": "status", "messageId": "<id the outbound call returned>",
 *       "status": "sent" | "delivered" | "read" | "failed", "timestamp"?, "error"? }
 *
 * OUTBOUND (only when the channel has an outbound URL): the CRM POSTs
 *   { id, channelId, conversationId, threadId, to: { kind, value }, subject,
 *     text, inReplyTo, attachments: [{ fileName, mimeType, contentBase64 }] }
 *   signed the same way, with X-CRM-Idempotency-Key = id (identical on retry).
 *   A 2xx JSON reply { "messageId": "…", "status"?: "sent" | "delivered" } means accepted.
 */

export const GENERIC_SIGNATURE_TOLERANCE_SECONDS = 300;
export const GENERIC_MAX_EVENTS = 50;
const SEND_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_ATTACHMENT_MB = 5;

export function signGenericPayload(secret: string, timestamp: number | string, rawBody: string) {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
}

// ── Configuration ───────────────────────────────────────────────

const configSchema = z
  .object({
    outboundUrl: z
      .string()
      .trim()
      .max(500)
      .optional()
      .or(z.literal(""))
      .nullable()
      .transform((v) => (v ? v : null)),
    allowAttachments: z.boolean().optional().default(true),
    maxAttachmentMb: z.number().int().min(1).max(10).optional().default(DEFAULT_MAX_ATTACHMENT_MB),
  })
  .strict();
export type GenericChannelConfig = z.infer<typeof configSchema>;

/** Outbound URLs: https only in production (http allowed for local development), no embedded credentials. */
export function checkOutboundUrl(value: string, production = process.env.NODE_ENV === "production"): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "Enter a full URL, e.g. https://chat.example.com/crm/outbound.";
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && !production)) return "The outbound URL must use https.";
  if (url.username || url.password) return "Don't put a user name or password in the URL — requests are signed instead.";
  return null;
}

function readConfig(config: Record<string, unknown>): GenericChannelConfig {
  const parsed = configSchema.safeParse(config ?? {});
  return parsed.success ? parsed.data : { outboundUrl: null, allowAttachments: true, maxAttachmentMb: DEFAULT_MAX_ATTACHMENT_MB };
}

// ── Identities ──────────────────────────────────────────────────

/** Which identity the channel type is keyed on, in order of preference. */
const IDENTITY_PREFERENCE: Record<ChannelType, IdentifierKind[]> = {
  EMAIL: ["EMAIL"],
  SMS: ["PHONE"],
  WHATSAPP: ["PHONE"],
  FACEBOOK_MESSENGER: ["PROVIDER_ID"],
  INSTAGRAM: ["PROVIDER_ID"],
  WEB_CHAT: ["SESSION", "PROVIDER_ID", "EMAIL", "PHONE"],
  OTHER: ["PROVIDER_ID", "EMAIL", "PHONE", "SESSION"],
};

const text = (max: number) => z.string().trim().max(max);
const fromSchema = z.object({
  email: text(254).optional().nullable(),
  phone: text(40).optional().nullable(),
  id: text(200).optional().nullable(),
  sessionId: text(200).optional().nullable(),
  name: text(200).optional().nullable(),
});

const attachmentSchema = z.object({
  fileName: text(255).min(1),
  mimeType: text(150).min(1),
  contentBase64: z.string().max(14_000_000).optional().nullable(),
  mediaId: text(500).optional().nullable(),
  size: z.number().int().min(0).optional().nullable(),
});

const messageEventSchema = z.object({
  type: z.literal("message"),
  id: text(200).min(1),
  threadId: text(300).optional().nullable(),
  from: fromSchema,
  timestamp: z.string().datetime({ offset: true }).optional().nullable(),
  subject: text(300).optional().nullable(),
  text: z.string().max(20_000).optional().nullable(),
  messageType: z.enum(MESSAGE_TYPES).optional(),
  attachments: z.array(attachmentSchema).max(10).optional(),
  location: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), name: text(200).optional().nullable() }).optional().nullable(),
  inReplyTo: text(300).optional().nullable(),
  references: z.array(text(300)).max(50).optional(),
});

const statusEventSchema = z.object({
  type: z.literal("status"),
  messageId: text(200).min(1),
  status: z.enum(["sent", "delivered", "read", "failed", "SENT", "DELIVERED", "READ", "FAILED"]),
  timestamp: z.string().datetime({ offset: true }).optional().nullable(),
  error: text(300).optional().nullable(),
});

const eventSchema = z.discriminatedUnion("type", [messageEventSchema, statusEventSchema]);

function identitiesOf(from: z.infer<typeof fromSchema>): NormalizedIdentity[] {
  const name = from.name || null;
  const out: NormalizedIdentity[] = [];
  if (from.email) out.push({ kind: "EMAIL", value: from.email, displayName: name });
  if (from.phone) out.push({ kind: "PHONE", value: from.phone, displayName: name });
  if (from.id) out.push({ kind: "PROVIDER_ID", value: from.id, displayName: name });
  if (from.sessionId) out.push({ kind: "SESSION", value: from.sessionId, displayName: name });
  return out;
}

export function primaryIdentity(channelType: ChannelType, identities: NormalizedIdentity[]): NormalizedIdentity | null {
  for (const kind of IDENTITY_PREFERENCE[channelType]) {
    const hit = identities.find((i) => i.kind === kind);
    if (hit) return hit;
  }
  return null;
}

export function attachmentKindOf(mimeType: string): NormalizedAttachment["kind"] {
  if (mimeType.startsWith("image/")) return "IMAGE";
  if (mimeType.startsWith("audio/")) return "AUDIO";
  if (mimeType.startsWith("video/")) return "VIDEO";
  if (mimeType === "application/pdf" || mimeType.includes("officedocument") || mimeType === "application/msword" || mimeType === "application/vnd.ms-excel" || mimeType === "text/csv") return "DOCUMENT";
  return "FILE";
}

function decodeBase64(value: string, index: number): Buffer {
  if (!/^[A-Za-z0-9+/=\s]*$/.test(value)) throw new ProviderPayloadError(`Attachment ${index + 1}: contentBase64 is not valid base64.`);
  return Buffer.from(value, "base64");
}

// ── Provider ────────────────────────────────────────────────────

export const genericWebhookProvider: ChannelProvider = {
  key: "generic",
  label: "Generic signed webhook",
  channelTypes: ["EMAIL", "SMS", "WHATSAPP", "FACEBOOK_MESSENGER", "INSTAGRAM", "WEB_CHAT", "OTHER"],

  validateConfig(_channelType, raw) {
    const parsed = configSchema.safeParse(raw ?? {});
    if (!parsed.success) throw new ProviderConfigError(parsed.error.issues[0]?.message ?? "Invalid settings.", String(parsed.error.issues[0]?.path?.[0] ?? "config"));
    if (parsed.data.outboundUrl) {
      const problem = checkOutboundUrl(parsed.data.outboundUrl);
      if (problem) throw new ProviderConfigError(problem, "outboundUrl");
    }
    return parsed.data;
  },

  capabilities(channel): ChannelCapabilities {
    const config = readConfig(channel.config);
    if (!config.outboundUrl) return receiveOnlyCapabilities("Replies are not set up for this channel yet. An admin can add an outbound URL in CRM Settings → Channels.");
    return {
      ...receiveOnlyCapabilities(""),
      canSend: true,
      sendUnavailableReason: null,
      supportsSubject: channel.channelType === "EMAIL",
      supportsAttachments: config.allowAttachments,
      // Only what the ERP file store accepts (images, PDF, Office, CSV).
      attachmentKinds: config.allowAttachments ? ["IMAGE", "DOCUMENT"] : [],
      maxAttachmentBytes: config.allowAttachments ? config.maxAttachmentMb * 1024 * 1024 : 0,
      maxAttachments: config.allowAttachments ? 5 : 0,
      maxTextLength: channel.channelType === "SMS" ? 1600 : 10_000,
      deliveryStatuses: ["SENT", "DELIVERED", "READ", "FAILED"],
    };
  },

  verifyWebhook(channel, { headers, rawBody, now }) {
    const ts = headers.get("x-crm-timestamp");
    const sig = headers.get("x-crm-signature");
    if (!ts || !sig) return { ok: false, reason: "Missing X-CRM-Timestamp or X-CRM-Signature header." };
    if (!/^\d{9,11}$/.test(ts)) return { ok: false, reason: "X-CRM-Timestamp must be a Unix time in seconds." };
    if (Math.abs(now.getTime() / 1000 - Number(ts)) > GENERIC_SIGNATURE_TOLERANCE_SECONDS) return { ok: false, reason: "The request timestamp is too old or in the future." };
    const expected = Buffer.from(signGenericPayload(channel.secret, ts, rawBody));
    const given = Buffer.from(sig.trim());
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "Invalid signature." };
    return { ok: true };
  },

  normalizeInbound(channel, { rawBody, now }) {
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      throw new ProviderPayloadError("The body must be JSON.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new ProviderPayloadError("The body must be a JSON object.");
    const obj = body as Record<string, unknown>;
    const items = Array.isArray(obj.events) ? obj.events : [obj];
    if (!items.length) throw new ProviderPayloadError("No events in the payload.");
    if (items.length > GENERIC_MAX_EVENTS) throw new ProviderPayloadError(`At most ${GENERIC_MAX_EVENTS} events per delivery.`);
    return items.map((item, i): NormalizedInboundEvent => {
      const parsed = eventSchema.safeParse(item);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new ProviderPayloadError(`Event ${i + 1}: ${issue?.path?.length ? `${issue.path.join(".")}: ` : ""}${issue?.message ?? "invalid"}`);
      }
      const ev = parsed.data;
      const occurredAt = ev.timestamp ? new Date(ev.timestamp) : now;
      if (ev.type === "status") {
        const status = ev.status.toUpperCase() as (typeof PROVIDER_DELIVERY_STATUSES)[number];
        return { type: "status", status: { providerMessageId: ev.messageId, status, occurredAt, errorCode: status === "FAILED" ? "PROVIDER_REPORTED_FAILURE" : null, errorMessage: status === "FAILED" ? ev.error || "The provider reported that the message could not be delivered." : null } };
      }
      const identities = identitiesOf(ev.from);
      const from = primaryIdentity(channel.channelType, identities);
      if (!from) throw new ProviderPayloadError(`Event ${i + 1}: "from" needs ${IDENTITY_PREFERENCE[channel.channelType].map((k) => ({ EMAIL: "email", PHONE: "phone", PROVIDER_ID: "id", SESSION: "sessionId" })[k]).join(" or ")} for a ${channel.channelType} channel.`);
      const attachments: NormalizedAttachment[] = (ev.attachments ?? []).map((a, j) => {
        const content = a.contentBase64 ? decodeBase64(a.contentBase64, j) : null;
        if (!content && !a.mediaId) throw new ProviderPayloadError(`Event ${i + 1}, attachment ${j + 1}: send contentBase64 or mediaId.`);
        return { kind: attachmentKindOf(a.mimeType.toLowerCase()), fileName: a.fileName, mimeType: a.mimeType.toLowerCase(), sizeBytes: content?.byteLength ?? a.size ?? null, content, providerMediaRef: content ? null : (a.mediaId ?? null) };
      });
      const bodyText = (ev.text ?? "").trim();
      const messageType = ev.messageType ?? (ev.location ? "LOCATION" : !bodyText && attachments.length ? (attachments[0].kind === "IMAGE" ? "IMAGE" : attachments[0].kind === "DOCUMENT" ? "DOCUMENT" : "FILE") : "TEXT");
      if (!bodyText && !attachments.length && !ev.location) throw new ProviderPayloadError(`Event ${i + 1}: the message has no text, attachment or location.`);
      return {
        type: "message",
        message: {
          providerMessageId: ev.id,
          threadRef: ev.threadId || null,
          from,
          alternateIdentities: identities.filter((x) => x !== from),
          to: null,
          occurredAt: occurredAt.getTime() > now.getTime() + 5 * 60_000 ? now : occurredAt,
          messageType,
          subject: ev.subject || null,
          body: bodyText,
          attachments,
          metadata: {
            ...(ev.inReplyTo ? { inReplyTo: ev.inReplyTo } : {}),
            ...(ev.references?.length ? { references: ev.references } : {}),
            ...(ev.location ? { location: { latitude: ev.location.latitude, longitude: ev.location.longitude, name: ev.location.name ?? null } } : {}),
          },
        },
      };
    });
  },

  validateRecipient(channel, to) {
    if (!to.value.trim()) return { ok: false, reason: "This conversation has no recipient address." };
    if (!IDENTITY_PREFERENCE[channel.channelType].includes(to.kind)) return { ok: false, reason: `A ${channel.channelType} channel can't send to a ${to.kind.toLowerCase()} identity.` };
    return { ok: true };
  },

  async sendMessage(channel: ProviderChannel, message: OutboundMessage): Promise<SendResult> {
    const config = readConfig(channel.config);
    if (!config.outboundUrl) return { ok: false, errorCode: "CHANNEL_NOT_SENDABLE", errorMessage: "Replies are not set up for this channel.", retryable: false };
    const payload = JSON.stringify({
      id: message.idempotencyKey,
      channelId: channel.id,
      conversationId: message.conversation.id,
      threadId: message.conversation.threadRef,
      to: { kind: message.to.kind, value: message.to.value },
      subject: message.subject,
      text: message.body,
      inReplyTo: message.replyToProviderMessageId,
      attachments: message.attachments.map((a) => ({ fileName: a.fileName, mimeType: a.mimeType, contentBase64: a.content.toString("base64") })),
    });
    const ts = Math.floor(Date.now() / 1000);
    let res: Response;
    try {
      res = await fetch(config.outboundUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CRM-Timestamp": String(ts),
          "X-CRM-Signature": signGenericPayload(channel.secret, ts, payload),
          "X-CRM-Idempotency-Key": message.idempotencyKey,
        },
        body: payload,
        redirect: "error",
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
    } catch (e) {
      const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      return { ok: false, errorCode: timeout ? "PROVIDER_TIMEOUT" : "PROVIDER_UNREACHABLE", errorMessage: timeout ? "The provider did not answer in time." : "The provider could not be reached.", retryable: true };
    }
    if (!res.ok) {
      // The provider's response body is never stored or shown (it may echo credentials or internals).
      const retryable = res.status === 429 || res.status >= 500;
      return { ok: false, errorCode: `PROVIDER_HTTP_${res.status}`, errorMessage: `The provider rejected the message (HTTP ${res.status}).`, retryable };
    }
    let data: Record<string, unknown> = {};
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      return { ok: false, errorCode: "PROVIDER_BAD_RESPONSE", errorMessage: "The provider's reply could not be read — it may or may not have sent the message.", retryable: false };
    }
    const providerMessageId = typeof data.messageId === "string" ? data.messageId : typeof data.id === "string" ? data.id : null;
    if (!providerMessageId || providerMessageId.length > 200) return { ok: false, errorCode: "PROVIDER_BAD_RESPONSE", errorMessage: "The provider's reply had no message id — it may or may not have sent the message.", retryable: false };
    const status = typeof data.status === "string" && ["delivered", "read"].includes(data.status.toLowerCase()) ? (data.status.toUpperCase() as "DELIVERED" | "READ") : "SENT";
    return { ok: true, providerMessageId, status };
  },
};
