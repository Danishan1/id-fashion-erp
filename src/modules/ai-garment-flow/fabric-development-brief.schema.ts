import { z } from "zod";
import { DESIGN_BALANCE_VALUES } from "@/core/ai/development-brief/schema";

// Mirrors createDevelopmentBriefSchema, minus preferredFabric — the fabric
// is already fixed and known for a FABRIC-sourced project, there is nothing
// to "prefer."
export const createFabricDevelopmentBriefSchema = z.object({
  targetMarket: z.string().max(100).optional().or(z.literal("")),
  targetCustomerProfile: z.string().max(1000).optional().or(z.literal("")),
  seasonId: z.string().uuid().optional().or(z.literal("")),
  targetSellingPrice: z.coerce.number().min(0).optional(),
  currencyCode: z.string().length(3).optional().or(z.literal("")),
  factoryCapabilities: z.string().max(1000).optional().or(z.literal("")),
  buyerId: z.string().uuid().optional().or(z.literal("")),
  directionCount: z.union([z.literal(3), z.literal(6), z.literal(9)]).default(6),
  designBalance: z.enum(DESIGN_BALANCE_VALUES).default("BALANCED"),
});
export type CreateFabricDevelopmentBriefInput = z.infer<typeof createFabricDevelopmentBriefSchema>;
