import { z } from "zod";

/**
 * Marketing channels & delivery (Phase 10) — client-safe registry: channel
 * types, the provider catalogue (what each adapter can do, its settings and
 * secret fields), delivery / run statuses and the reasons a recipient is
 * skipped. Screens, API validation and the server-side adapters all read
 * from here; adapters live in ./providers (server only).
 */

export const MARKETING_CHANNELS = {
  EMAIL: { label: "Email", consentChannel: "EMAIL" },
  SMS: { label: "SMS", consentChannel: "SMS" },
  WHATSAPP: { label: "WhatsApp", consentChannel: "WHATSAPP" },
} as const;
export type MarketingChannelKey = keyof typeof MARKETING_CHANNELS;
export const MARKETING_CHANNEL_KEYS = Object.keys(MARKETING_CHANNELS) as [MarketingChannelKey, ...MarketingChannelKey[]];

export interface ProviderFieldDef {
  key: string;
  label: string;
  help?: string;
  type: "text" | "number" | "select" | "email";
  required: boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
}

export interface ProviderCapabilities {
  /** The provider reports per-recipient delivery (beyond "accepted"). */
  deliveryReceipts: boolean;
  /** Signed / tokenised callbacks are supported. */
  webhooks: boolean;
  /** How the webhook is authenticated. */
  webhookAuth: "SIGNATURE" | "URL_TOKEN" | "NONE";
  /** Our delivery id travels with the message and comes back in callbacks. */
  correlationEcho: boolean;
  /** Can look a message up after a lost response (none of the built-in providers can). */
  statusLookup: boolean;
  /** Provider unsubscribe / complaint events update CRM consent. */
  unsubscribeEvents: boolean;
  /** Needs an externally approved template reference on the CRM template version. */
  providerTemplateRequired: boolean;
  /** Subject line used. */
  subject: boolean;
  /** Connection test available. */
  connectionTest: boolean;
}

export interface ProviderDef {
  label: string;
  channel: MarketingChannelKey;
  summary: string;
  setup: string[];
  capabilities: ProviderCapabilities;
  fields: ProviderFieldDef[];
  secretFields: { key: string; label: string; help?: string; required: boolean }[];
  /** Live-verified against the real provider in this build? */
  liveVerified: false;
}

const countryCodeField: ProviderFieldDef = {
  key: "defaultCountryCode",
  label: "Default country code",
  help: "Digits only, e.g. 91. Used for numbers saved without a + prefix; without it such numbers are skipped, never guessed.",
  type: "text",
  required: false,
  placeholder: "91",
};

export const MARKETING_PROVIDERS = {
  SMTP: {
    label: "Email via SMTP",
    channel: "EMAIL",
    summary: "Any mail service that offers SMTP (Google Workspace, Zoho, Amazon SES, Brevo SMTP…). The server's acceptance is recorded; SMTP has no delivery receipts.",
    setup: ["Create an SMTP user / app password at your mail provider.", "Enter host, port and security as your provider documents them.", "The From address must be one your provider allows you to send as (SPF / DKIM set up for its domain)."],
    capabilities: { deliveryReceipts: false, webhooks: false, webhookAuth: "NONE", correlationEcho: false, statusLookup: false, unsubscribeEvents: false, providerTemplateRequired: false, subject: true, connectionTest: true },
    fields: [
      { key: "host", label: "SMTP host", type: "text", required: true, placeholder: "smtp.example.com" },
      { key: "port", label: "Port", type: "number", required: true, placeholder: "587" },
      {
        key: "security",
        label: "Security",
        type: "select",
        required: true,
        options: [
          { value: "STARTTLS", label: "STARTTLS (usually port 587)" },
          { value: "TLS", label: "TLS / SSL (usually port 465)" },
          { value: "NONE", label: "None (not recommended)" },
        ],
      },
      { key: "username", label: "Username", type: "text", required: false },
      { key: "fromEmail", label: "From email", type: "email", required: true },
      { key: "fromName", label: "From name", type: "text", required: false },
      { key: "replyTo", label: "Reply-to email", type: "email", required: false },
    ],
    secretFields: [{ key: "password", label: "Password / app password", required: false, help: "Leave empty only if the server needs no login." }],
    liveVerified: false,
  },
  BREVO: {
    label: "Email via Brevo API",
    channel: "EMAIL",
    summary: "Brevo transactional email API with delivery, bounce, complaint and unsubscribe callbacks.",
    setup: ["In Brevo: SMTP & API → API keys → create a key.", "Verify the sender address / domain in Brevo.", "In Brevo: Transactional → Settings → Webhook, add the webhook URL shown here for delivered, hard/soft bounce, blocked, spam, unsubscribed, error, opened and click events."],
    capabilities: { deliveryReceipts: true, webhooks: true, webhookAuth: "URL_TOKEN", correlationEcho: true, statusLookup: false, unsubscribeEvents: true, providerTemplateRequired: false, subject: true, connectionTest: true },
    fields: [
      { key: "fromEmail", label: "Sender email", type: "email", required: true },
      { key: "fromName", label: "Sender name", type: "text", required: false },
      { key: "replyTo", label: "Reply-to email", type: "email", required: false },
    ],
    secretFields: [{ key: "apiKey", label: "API key", required: true }],
    liveVerified: false,
  },
  MSG91: {
    label: "SMS via MSG91",
    channel: "SMS",
    summary: "MSG91 Flow API (DLT-registered templates). One request per recipient; delivery reports by callback.",
    setup: [
      "Register the sender ID and each SMS template on the DLT portal and in MSG91; create an MSG91 Flow for it.",
      "Name the Flow's variables var1, var2, … in the order the CRM template uses its merge fields.",
      "On the CRM SMS template version, enter the MSG91 flow / template id.",
      "In MSG91, set the delivery-report webhook to the URL shown here.",
    ],
    capabilities: { deliveryReceipts: true, webhooks: true, webhookAuth: "URL_TOKEN", correlationEcho: false, statusLookup: false, unsubscribeEvents: false, providerTemplateRequired: true, subject: false, connectionTest: true },
    fields: [{ key: "senderId", label: "Sender ID (DLT header)", type: "text", required: true, placeholder: "INDRDH" }, countryCodeField],
    secretFields: [{ key: "authKey", label: "Auth key", required: true }],
    liveVerified: false,
  },
  WHATSAPP_CLOUD: {
    label: "WhatsApp Cloud API (Meta)",
    channel: "WHATSAPP",
    summary: "Meta WhatsApp Business Cloud API. Marketing messages must use Meta-approved templates; sent, delivered, read and failed statuses by signed callback.",
    setup: [
      "In Meta Business: create the WhatsApp Business account, add and verify the phone number.",
      "Create a system-user access token with whatsapp_business_messaging permission.",
      "Get each marketing template approved by Meta; enter its name and language on the CRM WhatsApp template version.",
      "In the Meta app: Webhooks → WhatsApp Business Account → callback URL shown here, verify token as entered below, subscribe to 'messages'.",
    ],
    capabilities: { deliveryReceipts: true, webhooks: true, webhookAuth: "SIGNATURE", correlationEcho: true, statusLookup: false, unsubscribeEvents: false, providerTemplateRequired: true, subject: false, connectionTest: true },
    fields: [
      { key: "phoneNumberId", label: "Phone number ID", type: "text", required: true },
      { key: "businessAccountId", label: "WhatsApp business account ID", type: "text", required: false },
      { key: "apiVersion", label: "Graph API version", type: "text", required: false, placeholder: "v21.0" },
      countryCodeField,
    ],
    secretFields: [
      { key: "accessToken", label: "Access token", required: true },
      { key: "appSecret", label: "App secret (webhook signature)", required: true },
      { key: "verifyToken", label: "Webhook verify token", required: true, help: "Any random text; enter the same in the Meta app's webhook settings." },
    ],
    liveVerified: false,
  },
} as const satisfies Record<string, ProviderDef>;
export type MarketingProviderKeyT = keyof typeof MARKETING_PROVIDERS;
export const MARKETING_PROVIDER_KEYS = Object.keys(MARKETING_PROVIDERS) as [MarketingProviderKeyT, ...MarketingProviderKeyT[]];

export const CONSENT_POLICIES = {
  OPT_OUT: "Send unless the contact opted out, is do-not-contact or bounced on this channel",
  OPT_IN: "Send only to contacts with a recorded 'Allowed' consent for this channel",
} as const;
export type ConsentPolicyKey = keyof typeof CONSENT_POLICIES;

// ── Statuses ──────────────────────────────────────────────────────

export const DELIVERY_STATUSES = {
  PENDING: { label: "Pending", tone: "zinc", help: "Waiting to be sent." },
  SUBMITTING: { label: "Submitting", tone: "blue", help: "Being sent to the provider right now." },
  ACCEPTED: { label: "Accepted by provider", tone: "blue", help: "The provider accepted it. Not proof of delivery." },
  SENT: { label: "Sent", tone: "blue", help: "The provider reports it was sent on." },
  DELIVERED: { label: "Delivered", tone: "green", help: "The provider confirmed delivery." },
  BOUNCED: { label: "Bounced", tone: "red", help: "The address rejected the message." },
  REJECTED: { label: "Rejected", tone: "red", help: "The provider refused the message." },
  FAILED: { label: "Failed", tone: "red", help: "It could not be sent." },
  SUPPRESSED: { label: "Not sent", tone: "amber", help: "Skipped: consent, address or record checks." },
  CANCELLED: { label: "Cancelled", tone: "zinc", help: "Cancelled before it was sent." },
  UNKNOWN: { label: "Outcome unknown", tone: "amber", help: "The provider may or may not have received it. Not retried automatically." },
} as const;
export type DeliveryStatusKey = keyof typeof DELIVERY_STATUSES;

export const RUN_STATUSES = {
  PREPARING: { label: "Preparing", tone: "blue" },
  SCHEDULED: { label: "Scheduled", tone: "indigo" },
  QUEUED: { label: "Queued", tone: "blue" },
  RUNNING: { label: "Sending", tone: "blue" },
  COMPLETED: { label: "Completed", tone: "green" },
  PARTIALLY_COMPLETED: { label: "Partly completed", tone: "amber" },
  FAILED: { label: "Failed", tone: "red" },
  CANCELLED: { label: "Cancelled", tone: "zinc" },
} as const;
export type RunStatusKey = keyof typeof RUN_STATUSES;
export const OPEN_RUN_STATUSES: RunStatusKey[] = ["PREPARING", "SCHEDULED", "QUEUED", "RUNNING"];

/** Server-enforced run lifecycle. */
export const RUN_TRANSITIONS: Record<RunStatusKey, RunStatusKey[]> = {
  PREPARING: ["SCHEDULED", "QUEUED", "FAILED", "CANCELLED"],
  SCHEDULED: ["QUEUED", "RUNNING", "CANCELLED", "FAILED"],
  QUEUED: ["RUNNING", "CANCELLED", "FAILED"],
  RUNNING: ["COMPLETED", "PARTIALLY_COMPLETED", "FAILED", "CANCELLED", "QUEUED"],
  COMPLETED: ["QUEUED"],
  PARTIALLY_COMPLETED: ["QUEUED"],
  FAILED: ["QUEUED"],
  CANCELLED: [],
};
export function canRunMove(from: RunStatusKey, to: RunStatusKey) {
  return RUN_TRANSITIONS[from].includes(to);
}

/**
 * Per-recipient status ranks for provider events arriving out of order: an
 * event only moves a delivery forward. Delivered and the final failures share
 * the top rank, so whichever the provider reported first stays.
 */
export const DELIVERY_RANK: Record<DeliveryStatusKey, number> = {
  PENDING: 0,
  SUBMITTING: 1,
  UNKNOWN: 1,
  ACCEPTED: 2,
  SENT: 3,
  DELIVERED: 4,
  BOUNCED: 4,
  REJECTED: 4,
  FAILED: 4,
  SUPPRESSED: 9,
  CANCELLED: 9,
};

export const SKIP_REASONS = {
  RECORD_UNAVAILABLE: "Contact archived or merged",
  NO_ADDRESS: "No email / number for this channel",
  INVALID_ADDRESS: "Email / number isn't valid for this provider",
  DUPLICATE_ADDRESS: "Same address as another recipient in this run",
  CONSENT_RESTRICTED: "Opted out, do-not-contact or bounced on this channel",
  CONSENT_MISSING: "No recorded consent (this connection requires opt-in)",
  NOT_IN_SNAPSHOT: "No longer in the audience",
  RENDER_FAILED: "Template couldn't be filled for this contact",
} as const;
export type SkipReasonKey = keyof typeof SKIP_REASONS;

/** Final per-recipient outcomes (nothing more will happen unless a provider reports more). */
export const SETTLED_STATUSES: DeliveryStatusKey[] = ["ACCEPTED", "SENT", "DELIVERED", "BOUNCED", "REJECTED", "FAILED", "SUPPRESSED", "CANCELLED", "UNKNOWN"];

// ── Payload schemas ───────────────────────────────────────────────

const codeSchema = z.string().trim().min(1, "Enter a code").max(40).regex(/^[A-Za-z0-9._-]+$/, "Letters, digits, . _ - only");

export const connectionCreateSchema = z
  .object({
    code: codeSchema,
    name: z.string().trim().min(1, "Enter a name").max(120),
    description: z.string().trim().max(1000).optional().or(z.literal("")),
    providerKey: z.enum(MARKETING_PROVIDER_KEYS),
    config: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
    secrets: z.record(z.string(), z.string().max(4000)).default({}),
    consentPolicy: z.enum(["OPT_OUT", "OPT_IN"]).default("OPT_OUT"),
    ratePerMinute: z.number().int().min(1).max(6000).default(60),
    batchSize: z.number().int().min(1).max(500).default(50),
  })
  .strict();

export const connectionUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).optional().or(z.literal("")),
    config: z.record(z.string(), z.union([z.string(), z.number()])),
    /** Only the secrets being replaced; omitted keys keep their stored value, "" clears an optional one. */
    secrets: z.record(z.string(), z.string().max(4000)).default({}),
    consentPolicy: z.enum(["OPT_OUT", "OPT_IN"]),
    ratePerMinute: z.number().int().min(1).max(6000),
    batchSize: z.number().int().min(1).max(500),
    version: z.number().int().min(1),
  })
  .strict();
