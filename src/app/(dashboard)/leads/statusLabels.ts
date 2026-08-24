export const STATUS_LABELS = {
  NEW: "New",
  CONTACTED: "Contacted",
  QUALIFIED: "Qualified",
  PROPOSAL: "Proposal",
  NEGOTIATION: "Negotiation",
  WON: "Won",
  LOST: "Lost",
} as const;

export const PRIORITY_LABELS = {
  NORMAL: "Normal",
  WARM: "Warm",
  HOT: "Hot",
} as const;

export const SOURCE_LABELS = {
  EMAIL: "Email",
  PHONE: "Phone",
  TRADE_SHOW: "Trade Show",
  REFERRAL: "Referral",
  WEBSITE: "Website",
  OTHER: "Other",
} as const;
