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

// Two distinct modes for closing the Deal→Customer gap: CREATE makes a brand
// new Customer (with a name-based duplicate check, overridable — mirrors
// Lead's own duplicate-detection shape), LINK attaches an already-existing
// one. Only reachable once a Deal is WON (enforced in the service, not here).
export const convertDealToCustomerSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("CREATE"),
    name: z.string().min(1, "Customer name is required").max(200),
    code: z.string().min(1, "Code is required").max(30),
    type: z.enum(["CUSTOMER", "AGENT"]).default("CUSTOMER"),
    country: z.string().max(100).optional().or(z.literal("")),
    overrideDuplicateCheck: z.boolean().optional(),
  }),
  z.object({
    mode: z.literal("LINK"),
    customerId: z.string().uuid("Select a customer"),
  }),
]);
export type ConvertDealToCustomerInput = z.infer<typeof convertDealToCustomerSchema>;

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
