import { z } from "zod";

export const DEAL_STAGES = ["QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON", "LOST"] as const;

export const createDealSchema = z.object({
  title: z.string().min(1, "Title is required").max(190),
  leadId: z.string().uuid().optional().or(z.literal("")),
  customerId: z.string().uuid().optional().or(z.literal("")),
  value: z.coerce.number().min(0).default(0),
  probabilityPercent: z.coerce.number().min(0).max(100).default(0),
  assignedToUserId: z.string().uuid().optional().or(z.literal("")),
  salesAgentId: z.string().uuid().optional().or(z.literal("")),
  expectedCloseDate: z.string().optional().or(z.literal("")),
  notes: z.string().max(2000).optional().or(z.literal("")),
});
export type CreateDealInput = z.infer<typeof createDealSchema>;

export const updateDealSchema = createDealSchema;
export type UpdateDealInput = z.infer<typeof updateDealSchema>;

export const dealStageChangeSchema = z
  .object({
    stage: z.enum(DEAL_STAGES),
    lostReason: z.string().max(1000).optional().or(z.literal("")),
  })
  .refine((input) => input.stage !== "LOST" || !!input.lostReason, {
    message: "A reason is required when marking a deal as Lost.",
    path: ["lostReason"],
  });
export type DealStageChangeInput = z.infer<typeof dealStageChangeSchema>;
