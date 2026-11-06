import type { MarketingProviderKeyT, ProviderCapabilities } from "../delivery-registry";

/**
 * The one seam between campaign delivery and a vendor (Phase 10). An adapter
 * builds the vendor request, classifies the response and parses callbacks.
 * It never touches the database, never decides who may be contacted and
 * never logs payloads or secrets. Adding a provider = one file here + one
 * line in ./index.ts + one entry in MARKETING_PROVIDERS (delivery-registry).
 */

/** A connection as an adapter sees it (server only — `secrets` are decrypted). */
export interface ConnectionRuntime {
  id: string;
  companyId: string;
  config: Record<string, string | number>;
  secrets: Record<string, string>;
}

export interface OutboundMarketingMessage {
  /** Our delivery id: idempotency key and correlation tag. */
  deliveryId: string;
  /** Normalised destination (email, or phone digits with country code). */
  to: string;
  toName: string | null;
  subject: string | null;
  body: string;
  /** Template variables in order of first use (positional provider templates). */
  parameters: { key: string; value: string }[];
  /** From the CRM template version (externally approved template name / id, language). */
  providerMetadata: Record<string, string>;
  unsubscribeUrl: string | null;
  /** Short tag for provider-side reporting (campaign code). */
  tag: string | null;
  /** Phase 11: approved library files (email only). `content` is absent in validation-only calls. */
  attachments?: OutboundAttachment[];
}

export interface OutboundAttachment {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  content?: Buffer;
}

/**
 * - ACCEPTED: the provider took it (not delivery).
 * - PERMANENT: this message will never be accepted (bad address, refused content).
 * - RETRYABLE: definitely not taken (connection refused, provider said "try later").
 * - THROTTLED: rate limited; retry after `retryAfterMs`.
 * - CONNECTION: credentials / account problem — stop the run.
 * - UNKNOWN: may or may not have been taken (timeout after sending, ambiguous 5xx). Never resent automatically.
 */
export type SendOutcome =
  | { kind: "ACCEPTED"; providerMessageId: string | null; providerStatus?: string }
  | { kind: "PERMANENT" | "RETRYABLE" | "THROTTLED" | "CONNECTION" | "UNKNOWN"; code: string; message: string; retryAfterMs?: number; providerStatus?: string };

export type NormalizedProviderEvent = "ACCEPTED" | "SENT" | "DELIVERED" | "BOUNCED" | "REJECTED" | "FAILED" | "UNSUBSCRIBED" | "COMPLAINED" | "OPENED" | "CLICKED" | "DEFERRED";

export interface ParsedProviderEvent {
  /** Stable per connection; repeats of the same callback share it. */
  eventKey: string;
  providerMessageId: string | null;
  /** Our delivery id, when the provider echoes it. */
  correlationId: string | null;
  /** The provider's own event name (kept for troubleshooting). */
  eventType: string;
  normalized: NormalizedProviderEvent | null;
  occurredAt: Date;
  errorCode?: string | null;
  /** Short, safe text (no payload). */
  detail?: string | null;
}

export interface WebhookRequest {
  method: "GET" | "POST";
  headers: Headers;
  rawBody: string;
  query: URLSearchParams;
}

export type WebhookVerification = { ok: true } | { ok: false; reason: string };

export interface SmtpLikeTransport {
  sendMail(mail: Record<string, unknown>): Promise<{ messageId?: string; accepted?: unknown[]; rejected?: unknown[]; response?: string }>;
  verify(): Promise<unknown>;
  close?(): void;
}

export interface ProviderDeps {
  fetch: typeof fetch;
  now: () => Date;
  /** SMTP transport factory (nodemailer by default; tests inject a fake). */
  smtpTransport?: (options: Record<string, unknown>) => SmtpLikeTransport;
}

export interface MarketingProviderAdapter {
  key: MarketingProviderKeyT;
  capabilities: ProviderCapabilities;
  /** Field-level problems with the non-secret settings + secrets ({} = fine). */
  validateConfig(config: Record<string, string | number>, secrets: Record<string, string>): Record<string, string>;
  /** Normalised destination, or null when it can't be used. */
  normalizeDestination(raw: string, config: Record<string, string | number>): string | null;
  /** Problems with a message before it is sent (missing template id, too long…). */
  validateMessage(msg: Pick<OutboundMarketingMessage, "subject" | "body" | "providerMetadata" | "parameters" | "attachments">, config: Record<string, string | number>): string[];
  testConnection(conn: ConnectionRuntime, deps: ProviderDeps): Promise<{ ok: boolean; message: string }>;
  send(conn: ConnectionRuntime, msg: OutboundMarketingMessage, deps: ProviderDeps): Promise<SendOutcome>;
  /** Provider-specific check on top of the URL token (signatures). */
  verifyWebhook?(req: WebhookRequest, conn: ConnectionRuntime): WebhookVerification;
  /** Subscription handshake (WhatsApp GET challenge). Returns the body to echo, or null. */
  handshake?(req: WebhookRequest, conn: ConnectionRuntime): string | null;
  parseWebhook?(req: WebhookRequest, conn: ConnectionRuntime): ParsedProviderEvent[];
}
