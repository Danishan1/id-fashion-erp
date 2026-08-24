export const STAGE_LABELS = {
  QUALIFIED: "Qualified",
  PROPOSAL: "Proposal",
  NEGOTIATION: "Negotiation",
  WON: "Won",
  LOST: "Lost",
} as const;

// Forward-progression map matching deal.service.ts's ALLOWED_TRANSITIONS
// exactly — kept here purely to drive which buttons the UI offers; the
// server-side guard is the real enforcement.
export const NEXT_STAGES: Record<keyof typeof STAGE_LABELS, Array<keyof typeof STAGE_LABELS>> = {
  QUALIFIED: ["PROPOSAL", "LOST"],
  PROPOSAL: ["NEGOTIATION", "LOST"],
  NEGOTIATION: ["WON", "LOST"],
  WON: [],
  LOST: [],
};
