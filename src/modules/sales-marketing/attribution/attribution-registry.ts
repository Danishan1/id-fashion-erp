import { z } from "zod";

/**
 * Sales & Marketing Phase 13 — attribution registry (client-safe).
 * Attribution shows how a stated rule shares credit for an outcome between
 * campaign touchpoints. It does not show that a campaign caused the outcome.
 */

export const MODEL_TYPES = {
  FIRST_TOUCH: { label: "First touch", help: "All credit to the earliest eligible touch." },
  LAST_TOUCH: { label: "Last touch", help: "All credit to the latest eligible touch before the conversion." },
  LINEAR: { label: "Linear", help: "Credit shared equally between the eligible touches." },
  POSITION_BASED: { label: "Position-based", help: "Set shares to the first and last touch; the rest shared equally by the touches in between." },
  TIME_DECAY: { label: "Time decay", help: "Touches closer to the conversion get more: a touch one half-life older gets half the credit." },
} as const;
export type ModelType = keyof typeof MODEL_TYPES;
export const MODEL_TYPE_KEYS = Object.keys(MODEL_TYPES) as ModelType[];

export const TOUCHPOINT_TYPES = {
  MESSAGE_SENT: { label: "Message sent", help: "A campaign message the provider accepted (Phase 10). Not proof it arrived or was read." },
  MESSAGE_DELIVERED: { label: "Message delivered", help: "The provider confirmed delivery. Not proof it was read." },
  CAMPAIGN_RESPONSE: { label: "Campaign set on a record", help: "A lead, enquiry, quotation or Sales Order carries the campaign — recorded by a user or a form." },
} as const;
export type TouchpointType = keyof typeof TOUCHPOINT_TYPES;
export const TOUCHPOINT_TYPE_KEYS = Object.keys(TOUCHPOINT_TYPES) as TouchpointType[];

export const CHANNEL_TYPES = { EMAIL: "Email", SMS: "SMS", WHATSAPP: "WhatsApp" } as const;
export type ChannelType = keyof typeof CHANNEL_TYPES;
export const CHANNEL_KEYS = Object.keys(CHANNEL_TYPES) as ChannelType[];

export const CONVERSION_TYPES = {
  LEAD_CREATED: { label: "Lead created", source: "CRM lead", date: "lead created" },
  ENQUIRY_CREATED: { label: "Enquiry received", source: "Buyer enquiry", date: "enquiry created" },
  QUOTATION_ACCEPTED: { label: "Quotation accepted", source: "Quotation revision accepted by the customer", date: "customer decision date (end of day)" },
  SALES_ORDER_BOOKED: { label: "Sales Order booked", source: "Sales Order confirmed or later (not cancelled)", date: "order date (end of day)" },
} as const;
export type ConversionType = keyof typeof CONVERSION_TYPES;
export const CONVERSION_TYPE_KEYS = Object.keys(CONVERSION_TYPES) as ConversionType[];

/** Money bases for attributed revenue. Each applies to one conversion type only. */
export const REVENUE_BASES = {
  ORDER_VALUE: { label: "Sales Order value", conversion: "SALES_ORDER_BOOKED", help: "Booked order value in company currency, before GST." },
  INVOICED_VALUE: { label: "Invoiced value", conversion: "SALES_ORDER_BOOKED", help: "Posted sales invoices of those orders, subtotal × exchange rate, before GST. Cancelled invoices don't count." },
  QUOTED_VALUE: { label: "Accepted quotation value", conversion: "QUOTATION_ACCEPTED", help: "Taxable total of the accepted revision, before GST. A quote, not revenue." },
} as const satisfies Record<string, { label: string; conversion: ConversionType; help: string }>;
export type RevenueBasis = keyof typeof REVENUE_BASES;
export const REVENUE_BASIS_KEYS = Object.keys(REVENUE_BASES) as RevenueBasis[];

export const MODEL_STATUSES = {
  DRAFT: { label: "Draft", tone: "zinc" },
  ACTIVE: { label: "In use", tone: "green" },
  RETIRED: { label: "Retired", tone: "zinc" },
} as const;
export const VERSION_STATUSES = {
  DRAFT: { label: "Draft", tone: "zinc" },
  PENDING_APPROVAL: { label: "Pending approval", tone: "amber" },
  APPROVED: { label: "Approved — in use", tone: "green" },
  SUPERSEDED: { label: "Superseded", tone: "zinc" },
  REJECTED: { label: "Rejected", tone: "red" },
} as const;
export const RUN_STATUSES = {
  QUEUED: { label: "Queued", tone: "zinc" },
  RUNNING: { label: "Running", tone: "indigo" },
  COMPLETED: { label: "Completed", tone: "green" },
  FAILED: { label: "Failed", tone: "red" },
  PURGED: { label: "Old — details removed", tone: "zinc" },
} as const;

/** Business dates end at midnight India time (UTC+5:30, no daylight saving). */
export const BUSINESS_UTC_OFFSET_MINUTES = 330;
export const MAX_RUN_DAYS = 731;
export const MAX_REPORT_DAYS = 731;

// ── Schemas ────────────────────────────────────────────────────────

const pct = z.union([z.literal(""), z.null(), z.coerce.number().min(0).max(100)]).optional().transform((v) => (v === "" || v === undefined ? null : v));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const modelRulesSchema = z
  .object({
    modelType: z.enum(MODEL_TYPE_KEYS as [ModelType, ...ModelType[]]),
    windowDays: z.coerce.number().int().min(1, "At least 1 day").max(730, "At most 730 days"),
    touchpointTypes: z.array(z.enum(TOUCHPOINT_TYPE_KEYS as [TouchpointType, ...TouchpointType[]])).min(1, "Pick at least one kind of touch").transform((a) => [...new Set(a)]),
    channelTypes: z.array(z.enum(CHANNEL_KEYS as [ChannelType, ...ChannelType[]])).default([]).transform((a) => [...new Set(a)]),
    conversionTypes: z.array(z.enum(CONVERSION_TYPE_KEYS as [ConversionType, ...ConversionType[]])).min(1, "Pick at least one conversion").transform((a) => [...new Set(a)]),
    collapseRepeats: z.boolean().default(true),
    firstTouchPercent: pct,
    lastTouchPercent: pct,
    halfLifeDays: z.union([z.literal(""), z.null(), z.coerce.number().positive().max(365)]).optional().transform((v) => (v === "" || v === undefined ? null : v)),
    changeNote: z.string().trim().max(300).optional().nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.modelType === "POSITION_BASED") {
      if (v.firstTouchPercent === null || v.lastTouchPercent === null) ctx.addIssue({ code: "custom", path: ["firstTouchPercent"], message: "Enter the first and last touch shares" });
      else if (v.firstTouchPercent + v.lastTouchPercent > 100) ctx.addIssue({ code: "custom", path: ["lastTouchPercent"], message: "First + last can't be more than 100%" });
    }
    if (v.modelType === "TIME_DECAY" && v.halfLifeDays === null) ctx.addIssue({ code: "custom", path: ["halfLifeDays"], message: "Enter a half-life" });
    const messages = v.touchpointTypes.some((t) => t !== "CAMPAIGN_RESPONSE");
    if (!messages && v.channelTypes.length) ctx.addIssue({ code: "custom", path: ["channelTypes"], message: "Channels only apply to message touches" });
  });
export type ModelRules = z.infer<typeof modelRulesSchema>;

export const modelCreateSchema = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{1,29}$/, "2–30 letters, digits, - or _"),
    name: z.string().trim().min(1, "Enter a name").max(150),
    description: z.string().trim().max(2000).optional().nullable(),
    rules: modelRulesSchema,
  })
  .strict();

export const reportQuerySchema = z
  .object({
    modelId: z.string().uuid().optional(),
    compareModelId: z.string().uuid().optional().or(z.literal("")),
    basis: z.enum(REVENUE_BASIS_KEYS as [RevenueBasis, ...RevenueBasis[]]).default("ORDER_VALUE"),
    from: isoDate.optional(),
    to: isoDate.optional(),
    campaignId: z.string().uuid().optional(),
  })
  .strict();
export type ReportQuery = z.infer<typeof reportQuerySchema>;
