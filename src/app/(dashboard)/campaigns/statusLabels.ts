export const CHANNEL_LABELS = {
  META_ADS: "Meta Ads",
  GOOGLE_ADS: "Google Ads",
  LINKEDIN: "LinkedIn",
  YOUTUBE: "YouTube",
  EMAIL: "Email",
  WHATSAPP: "WhatsApp",
  SEO: "SEO",
  ORGANIC: "Organic",
  REFERRAL: "Referral",
  OFFLINE: "Offline",
} as const;

export const STATUS_LABELS = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  PAUSED: "Paused",
  COMPLETED: "Completed",
} as const;

export const APPROVAL_LABELS = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
} as const;

export const ALERT_TYPE_LABELS = {
  BUDGET_OVERSPEND: "Budget Exceeded",
  BUDGET_80_PERCENT: "80% Budget Used",
  LOW_ROAS: "ROAS Below 1.0x",
  ROAS_WATCH: "ROAS Needs Review",
  HIGH_CPL: "CPL Above Benchmark",
  LOW_CONVERSION: "Low Conversion",
} as const;
