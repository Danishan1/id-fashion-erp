import { z } from "zod";

/**
 * Sales & Marketing Phase 11 — content library registry (client-safe).
 * Asset types and the files each accepts, review statuses and actions, and
 * the input schemas. Keep CHECK constraints in the migration in step.
 */

// ── Assets ─────────────────────────────────────────────────────────

export const ASSET_MIME = {
  "image/jpeg": { ext: "jpg", label: "JPEG image", preview: "image", attachable: true },
  "image/png": { ext: "png", label: "PNG image", preview: "image", attachable: true },
  "image/webp": { ext: "webp", label: "WebP image", preview: "image", attachable: true },
  "image/gif": { ext: "gif", label: "GIF image", preview: "image", attachable: true },
  "application/pdf": { ext: "pdf", label: "PDF", preview: "pdf", attachable: true },
  "video/mp4": { ext: "mp4", label: "MP4 video", preview: "video", attachable: false },
  "video/webm": { ext: "webm", label: "WebM video", preview: "video", attachable: false },
} as const;
export type AssetMime = keyof typeof ASSET_MIME;
export const isAssetMime = (m: string): m is AssetMime => m in ASSET_MIME;

const IMAGES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export const ASSET_TYPES = {
  IMAGE: { label: "Image", mimes: IMAGES as readonly AssetMime[], help: "Photos and illustrations (JPEG, PNG, WebP, GIF)." },
  LOGO: { label: "Logo / brand graphic", mimes: IMAGES as readonly AssetMime[], help: "Raster logos (JPEG, PNG, WebP, GIF). SVG isn't accepted — it can carry scripts." },
  DOCUMENT: { label: "Document", mimes: ["application/pdf"] as readonly AssetMime[], help: "PDF brochures, price sheets, catalogues." },
  VIDEO: { label: "Video", mimes: ["video/mp4", "video/webm"] as readonly AssetMime[], help: "Short MP4 / WebM clips. Stored and previewed only — not sent with messages." },
} as const;
export type AssetType = keyof typeof ASSET_TYPES;
export const ASSET_TYPE_KEYS = Object.keys(ASSET_TYPES) as [AssetType, ...AssetType[]];

/** The file storage limit (FileStorage) is 20 MB; marketing can go lower via MARKETING_ASSET_MAX_MB. */
export const STORAGE_MAX_MB = 20;
export function assetMaxBytes(env: Record<string, string | undefined> = typeof process === "undefined" ? {} : process.env) {
  const mb = Number(env.MARKETING_ASSET_MAX_MB);
  return Math.round((Number.isFinite(mb) && mb > 0 ? Math.min(mb, STORAGE_MAX_MB) : STORAGE_MAX_MB) * 1024 * 1024);
}

/** Email attachments: total per message (providers commonly cap at 10–25 MB including encoding). */
export const MAX_ATTACHMENT_TOTAL_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS = 5;

export const ASSET_STATUSES = {
  ACTIVE: { label: "Active", tone: "green" },
  ARCHIVED: { label: "Archived", tone: "zinc" },
} as const;

// ── Reviews ────────────────────────────────────────────────────────

export const REVIEW_SUBJECTS = {
  ASSET_VERSION: "Asset version",
  TEMPLATE_VERSION: "Template version",
  CONTENT_VERSION: "Campaign content version",
} as const;
export type ReviewSubject = keyof typeof REVIEW_SUBJECTS;
export const REVIEW_SUBJECT_KEYS = Object.keys(REVIEW_SUBJECTS) as [ReviewSubject, ...ReviewSubject[]];

/** "DRAFT" = no review yet (no row). */
export const REVIEW_STATUSES = {
  DRAFT: { label: "Not submitted", tone: "zinc", help: "Saved, not yet sent for review." },
  PENDING: { label: "In review", tone: "amber", help: "Waiting for an approver." },
  APPROVED: { label: "Approved", tone: "green", help: "Approved for marketing use. This exact version can't change." },
  CHANGES_REQUESTED: { label: "Changes requested", tone: "amber", help: "Make a new version and submit that." },
  REJECTED: { label: "Rejected", tone: "red", help: "Not to be used." },
  WITHDRAWN: { label: "Withdrawn", tone: "zinc", help: "Taken back by the author; can be submitted again." },
} as const;
export type ReviewStatus = keyof typeof REVIEW_STATUSES;

export const REVIEW_ACTIONS = {
  submit: { from: ["DRAFT", "WITHDRAWN"], to: "PENDING", event: "SUBMITTED", permission: "edit" },
  withdraw: { from: ["PENDING"], to: "WITHDRAWN", event: "WITHDRAWN", permission: "edit" },
  approve: { from: ["PENDING"], to: "APPROVED", event: "APPROVED", permission: "approve" },
  request_changes: { from: ["PENDING"], to: "CHANGES_REQUESTED", event: "CHANGES_REQUESTED", permission: "reject" },
  reject: { from: ["PENDING"], to: "REJECTED", event: "REJECTED", permission: "reject" },
} as const satisfies Record<string, { from: readonly ReviewStatus[]; to: ReviewStatus; event: string; permission: "edit" | "approve" | "reject" }>;
export type ReviewAction = keyof typeof REVIEW_ACTIONS;
export const REVIEW_ACTION_KEYS = Object.keys(REVIEW_ACTIONS) as [ReviewAction, ...ReviewAction[]];

export function canReview(status: ReviewStatus, action: ReviewAction) {
  return (REVIEW_ACTIONS[action].from as readonly string[]).includes(status);
}

// ── Campaign content ───────────────────────────────────────────────

export const CONTENT_CHANNELS = ["EMAIL", "SMS", "WHATSAPP"] as const;
export type ContentChannel = (typeof CONTENT_CHANNELS)[number];
/** Channels whose messages may carry library files. */
export const ATTACHMENT_CHANNELS: ReadonlySet<ContentChannel> = new Set(["EMAIL"]);

export const LOCALE_RE = /^[a-z]{2,3}(-[A-Z]{2})?$/;

// ── Schemas ────────────────────────────────────────────────────────

const text = (max: number) => z.string().trim().max(max);
const tags = z
  .array(z.string().trim().toLowerCase().min(1).max(40).regex(/^[a-z0-9][a-z0-9 _-]*$/, "Tags: letters, digits, space, _ and - only"))
  .max(20)
  .transform((t) => [...new Set(t)]);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .nullable()
  .optional();

export const assetMetadataSchema = z
  .object({
    name: text(150).min(1, "Enter a name"),
    description: text(1000).optional().nullable(),
    assetType: z.enum(ASSET_TYPE_KEYS),
    tags: tags.default([]),
    altText: text(300).optional().nullable(),
    usageNotes: text(1000).optional().nullable(),
    expiresOn: date,
    ownerUserId: z.string().uuid().optional(),
  })
  .strict();
export const assetUpdateSchema = assetMetadataSchema.omit({ assetType: true }).extend({ version: z.number().int().min(1) }).strict();

export const reviewActionSchema = z.object({ comment: text(1000).optional().nullable() }).strict();
export const reviewDecisionSchema = z.object({ comment: text(1000).min(3, "Say why").optional().nullable() }).strict();

export const contentCreateSchema = z
  .object({
    name: text(150).min(1, "Enter a name"),
    templateId: z.string().uuid("Choose a template"),
    locale: z.string().trim().regex(LOCALE_RE, "Use a language tag like en or hi-IN").default("en"),
  })
  .strict();

export const contentVersionSchema = z
  .object({
    subject: text(250).optional().nullable(),
    body: z.string().max(10_000).refine((b) => b.trim().length > 0, "Enter the message"),
    providerMetadata: z.record(z.string(), z.string().trim().max(200)).default({}),
    assetVersionIds: z.array(z.string().uuid()).max(MAX_ATTACHMENTS).default([]),
    locale: z.string().trim().regex(LOCALE_RE).optional(),
    changeNote: text(200).optional().nullable(),
    /** Optimistic lock on the content row. */
    version: z.number().int().min(1),
  })
  .strict();

export const contentPreviewSchema = z
  .object({
    versionId: z.string().uuid().optional(),
    /** A CRM contact the viewer may see; otherwise sample data. */
    contactId: z.string().uuid().optional(),
  })
  .strict();
