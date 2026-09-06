import { z } from "zod";
import { DESIGN_BALANCE_VALUES, DIRECTION_COUNT_VALUES } from "@/core/ai/development-brief/schema";

export const createDevelopmentBriefSchema = z.object({
  // Pre-filled from the Style Master / approved Reference Analysis, editable
  // for just this one generation run — see the schema comment on
  // AiGarmentDevelopmentBriefRun.contextSnapshotJson for why these are NOT
  // written back to AiGarmentProject.
  targetMarket: z.string().max(100).optional().or(z.literal("")),
  targetCustomerProfile: z.string().max(1000).optional().or(z.literal("")),
  seasonId: z.string().uuid().optional().or(z.literal("")),
  categoryId: z.string().uuid().optional().or(z.literal("")),
  targetSellingPrice: z.coerce.number().min(0).optional(),
  currencyCode: z.string().length(3).optional().or(z.literal("")),
  preferredFabric: z.string().max(500).optional().or(z.literal("")),
  factoryCapabilities: z.string().max(1000).optional().or(z.literal("")),
  buyerId: z.string().uuid().optional().or(z.literal("")),
  directionCount: z.union([z.literal(3), z.literal(6), z.literal(9)]).default(6),
  designBalance: z.enum(DESIGN_BALANCE_VALUES).default("BALANCED"),
});
export type CreateDevelopmentBriefInput = z.infer<typeof createDevelopmentBriefSchema>;

export const editDesignDirectionSchema = z.object({
  designDirectionName: z.string().min(1).max(200).optional(),
  commercialClassification: z.enum(["SAFE_COMMERCIAL", "BALANCED", "FASHION_FORWARD"]).optional(),
  targetConsumer: z.string().min(1).max(2000).optional(),
  silhouette: z.string().min(1).max(2000).optional(),
  garmentLength: z.string().min(1).max(2000).optional(),
  fit: z.string().min(1).max(2000).optional(),
  neckline: z.string().min(1).max(2000).optional(),
  collar: z.string().min(1).max(2000).optional(),
  sleeve: z.string().min(1).max(2000).optional(),
  shoulderConstruction: z.string().min(1).max(2000).optional(),
  frontConstruction: z.string().min(1).max(2000).optional(),
  backConstruction: z.string().min(1).max(2000).optional(),
  closure: z.string().min(1).max(2000).optional(),
  pocket: z.string().min(1).max(2000).optional(),
  waistTreatment: z.string().min(1).max(2000).optional(),
  hem: z.string().min(1).max(2000).optional(),
  keyNewDesignFeature: z.string().min(1).max(2000).optional(),
  suggestedFabricCharacter: z.string().min(1).max(2000).optional(),
  suggestedTrims: z.string().min(1).max(2000).optional(),
  userNotes: z.string().max(2000).optional().or(z.literal("")),
});
export type EditDesignDirectionInput = z.infer<typeof editDesignDirectionSchema>;

export const designDirectionDecisionSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT", "SAVE_FOR_LATER"]),
});
export type DesignDirectionDecisionInput = z.infer<typeof designDirectionDecisionSchema>;

export { DIRECTION_COUNT_VALUES };
