import { z } from "zod";

export const CAMPAIGN_CHANNELS = [
  "META_ADS",
  "GOOGLE_ADS",
  "LINKEDIN",
  "YOUTUBE",
  "EMAIL",
  "WHATSAPP",
  "SEO",
  "ORGANIC",
  "REFERRAL",
  "OFFLINE",
] as const;
export const CAMPAIGN_STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "COMPLETED"] as const;
export const CAMPAIGN_APPROVAL_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;

// status/approvalStatus are deliberately NOT part of this payload — every new
// campaign always starts DRAFT/PENDING (matches how Deal/Lead/SalesOrder
// each start at one fixed status regardless of input), and an edit no longer
// touches lifecycle/approval state directly. Both are now only reachable
// through the dedicated status/approve/reject actions below, the same
// discipline that already protects e.g. SampleStatus.TECH_PACK_READY from
// being forged via a plain status PATCH.
export const createCampaignSchema = z.object({
  name: z.string().min(1, "Name is required").max(190),
  objective: z.string().max(190).optional().or(z.literal("")),
  channel: z.enum(CAMPAIGN_CHANNELS),
  startDate: z.string().optional().or(z.literal("")),
  endDate: z.string().optional().or(z.literal("")),
  budget: z.coerce.number().min(0).default(0),
  ownerUserId: z.string().uuid().optional().or(z.literal("")),
  notes: z.string().max(2000).optional().or(z.literal("")),
});
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

export const updateCampaignSchema = createCampaignSchema;
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;

// DRAFT -> ACTIVE requires approvalStatus === APPROVED (enforced in the
// service, not here) — "Running" in the request's own diagram is this
// project's existing ACTIVE value, not a new one, since a company-configurable
// status shouldn't be duplicated under a second name.
export const campaignStatusChangeSchema = z.object({
  status: z.enum(CAMPAIGN_STATUSES),
});
export type CampaignStatusChangeInput = z.infer<typeof campaignStatusChangeSchema>;

export const rejectCampaignSchema = z.object({
  reason: z.string().min(1, "A rejection reason is required.").max(1000),
});
export type RejectCampaignInput = z.infer<typeof rejectCampaignSchema>;

export const recordDailyMetricSchema = z.object({
  metricDate: z.string().min(1, "Date is required"),
  spend: z.coerce.number().min(0).default(0),
  impressions: z.coerce.number().int().min(0).default(0),
  clicks: z.coerce.number().int().min(0).default(0),
  notes: z.string().max(500).optional().or(z.literal("")),
});
export type RecordDailyMetricInput = z.infer<typeof recordDailyMetricSchema>;

export const addAttributionSchema = z.object({
  campaignId: z.string().uuid().optional().or(z.literal("")),
  leadId: z.string().uuid().optional().or(z.literal("")),
  prospectName: z.string().max(190).optional().or(z.literal("")),
  source: z.string().max(100).optional().or(z.literal("")),
  medium: z.string().max(100).optional().or(z.literal("")),
  content: z.string().max(190).optional().or(z.literal("")),
  term: z.string().max(190).optional().or(z.literal("")),
  utmCampaign: z.string().max(190).optional().or(z.literal("")),
  landingPage: z.string().max(255).optional().or(z.literal("")),
  isFirstTouch: z.boolean().default(false),
  isLastTouch: z.boolean().default(false),
  attributedRevenue: z.coerce.number().min(0).default(0),
});
export type AddAttributionInput = z.infer<typeof addAttributionSchema>;
