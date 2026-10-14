import { z } from "zod";

/** Platform SaaS Phase 5 (PLAT-028..030): support tickets. */

export const TICKET_STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_ON_CUSTOMER", "RESOLVED", "CLOSED"] as const;
export const TICKET_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export const TICKET_CATEGORIES = ["GENERAL", "BUG", "BILLING", "ACCOUNT", "DATA", "FEATURE_REQUEST"] as const;

export type TicketStatusValue = (typeof TICKET_STATUSES)[number];
export type TicketPriorityValue = (typeof TICKET_PRIORITIES)[number];
export type TicketCategoryValue = (typeof TICKET_CATEGORIES)[number];

export const TICKET_STATUS_LABELS: Record<TicketStatusValue, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  WAITING_ON_CUSTOMER: "Waiting on you",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

/** Platform staff see "waiting on customer" instead of "waiting on you". */
export const TICKET_STATUS_LABELS_PLATFORM: Record<TicketStatusValue, string> = {
  ...TICKET_STATUS_LABELS,
  WAITING_ON_CUSTOMER: "Waiting on customer",
};

export const TICKET_PRIORITY_LABELS: Record<TicketPriorityValue, string> = {
  LOW: "Low",
  NORMAL: "Normal",
  HIGH: "High",
  URGENT: "Urgent",
};

export const TICKET_CATEGORY_LABELS: Record<TicketCategoryValue, string> = {
  GENERAL: "General question",
  BUG: "Something isn't working",
  BILLING: "Billing / subscription",
  ACCOUNT: "Account & login",
  DATA: "Data correction",
  FEATURE_REQUEST: "Feature request",
};

export const MAX_TICKET_ATTACHMENTS = 5;

export const createTicketSchema = z.object({
  subject: z.string().trim().min(5, "Subject must be at least 5 characters").max(200),
  category: z.enum(TICKET_CATEGORIES).default("GENERAL"),
  priority: z.enum(TICKET_PRIORITIES).default("NORMAL"),
  body: z.string().trim().min(10, "Describe the problem (at least 10 characters)").max(10000),
});
export type CreateTicketInput = z.infer<typeof createTicketSchema>;

export const replySchema = z.object({
  body: z.string().trim().min(1, "Write a message").max(10000),
});

export const platformReplySchema = z.object({
  body: z.string().trim().min(1, "Write a message").max(10000),
  isInternal: z.boolean().default(false),
  // Status after the reply; default = waiting on the customer.
  status: z.enum(TICKET_STATUSES).optional(),
});
export type PlatformReplyInput = z.infer<typeof platformReplySchema>;

export const platformTicketUpdateSchema = z
  .object({
    status: z.enum(TICKET_STATUSES).optional(),
    priority: z.enum(TICKET_PRIORITIES).optional(),
    // "" = unassign
    assignedToPlatformUserId: z.union([z.literal(""), z.null(), z.string().uuid()]).optional(),
  })
  .refine((v) => v.status !== undefined || v.priority !== undefined || v.assignedToPlatformUserId !== undefined, {
    message: "Nothing to change",
  });
export type PlatformTicketUpdateInput = z.infer<typeof platformTicketUpdateSchema>;
