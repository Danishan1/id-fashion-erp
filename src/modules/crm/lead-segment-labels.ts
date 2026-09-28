// Client-safe (zero server imports) — shared by lead-segments.ts (server)
// and the Leads list page's "Filtered:" chip.
export const LEAD_SEGMENTS = [
  "NEW",
  "CONTACTED",
  "NEVER_CONTACTED",
  "QUALIFIED",
  "QUOTATION",
  "OPEN",
  "WON",
  "LOST",
  "DORMANT",
  "SAMPLING",
  "HOT",
] as const;
export type LeadSegment = (typeof LEAD_SEGMENTS)[number];

export const LEAD_SEGMENT_LABELS: Record<LeadSegment, string> = {
  NEW: "New leads (still in the first stage)",
  CONTACTED: "Contacted leads",
  NEVER_CONTACTED: "Open leads never contacted",
  QUALIFIED: "Qualified leads (reached Qualification or beyond)",
  QUOTATION: "Leads at Quotation stage or beyond",
  OPEN: "Open leads",
  WON: "Won leads",
  LOST: "Lost leads",
  DORMANT: "Dormant leads",
  SAMPLING: "Leads requesting sampling",
  HOT: "Hot leads (score at or above the Hot threshold)",
};

export function isLeadSegment(value: string | null | undefined): value is LeadSegment {
  return !!value && (LEAD_SEGMENTS as readonly string[]).includes(value);
}
