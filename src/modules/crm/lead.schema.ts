import { z } from "zod";
import { optionalPhoneSchema } from "@/lib/validation";

// Mirrors the existing EnquirySource enum's values exactly (Lead reuses that
// enum directly — see the migration report, no new source-taxonomy needed).
export const LEAD_SOURCES = ["EMAIL", "PHONE", "TRADE_SHOW", "REFERRAL", "WEBSITE", "OTHER"] as const;
export const LEAD_STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"] as const;

export const createLeadSchema = z.object({
  name: z.string().min(1, "Name is required").max(150),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: optionalPhoneSchema,
  companyName: z.string().max(190).optional().or(z.literal("")),
  source: z.enum(LEAD_SOURCES).default("OTHER"),
  campaignId: z.string().uuid().optional().or(z.literal("")),
  campaignText: z.string().max(190).optional().or(z.literal("")),
  leadScore: z.coerce.number().min(0).max(100).default(0),
  value: z.coerce.number().min(0).default(0),
  expectedCloseDate: z.string().optional().or(z.literal("")),
  assignedToUserId: z.string().uuid().optional().or(z.literal("")),
  notes: z.string().max(2000).optional().or(z.literal("")),
  // Set only on a deliberate resubmit after the user has seen and
  // acknowledged the duplicate-email/phone warning — mirrors the exact
  // pattern already established for Material Request's own duplicate check.
  overrideDuplicateCheck: z.boolean().optional(),
});
export type CreateLeadInput = z.infer<typeof createLeadSchema>;

export const updateLeadSchema = createLeadSchema.extend({
  status: z.enum(LEAD_STATUSES).optional(),
});
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;
