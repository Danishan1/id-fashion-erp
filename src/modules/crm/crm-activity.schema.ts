import { z } from "zod";

// Polymorphic discriminator, reusing the existing RelatedModule enum
// convention (Attachment/AuditLog/InventoryTransaction already work this
// way) — scoped to the 3 CRM record types an activity/followup can attach to.
export const CRM_RELATED_MODULES = ["LEAD", "DEAL", "CUSTOMER"] as const;
export const CRM_INTERACTION_TYPES = ["CALL", "WHATSAPP", "EMAIL", "MEETING", "NOTE"] as const;

export const createCrmActivitySchema = z.object({
  relatedModule: z.enum(CRM_RELATED_MODULES),
  relatedRecordId: z.string().uuid(),
  activityType: z.enum(CRM_INTERACTION_TYPES).default("NOTE"),
  subject: z.string().max(190).optional().or(z.literal("")),
  body: z.string().max(4000).optional().or(z.literal("")),
});
export type CreateCrmActivityInput = z.infer<typeof createCrmActivitySchema>;

export const createCrmFollowupSchema = z.object({
  relatedModule: z.enum(CRM_RELATED_MODULES),
  relatedRecordId: z.string().uuid(),
  assignedToUserId: z.string().uuid().optional().or(z.literal("")),
  followupDate: z.string().min(1, "Follow-up date is required"),
  type: z.enum(CRM_INTERACTION_TYPES).default("CALL"),
  notes: z.string().max(2000).optional().or(z.literal("")),
});
export type CreateCrmFollowupInput = z.infer<typeof createCrmFollowupSchema>;

export const crmFollowupStatusChangeSchema = z.object({
  status: z.enum(["COMPLETED", "CANCELLED"]),
});
export type CrmFollowupStatusChangeInput = z.infer<typeof crmFollowupStatusChangeSchema>;
