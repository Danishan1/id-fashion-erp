import { z } from "zod";

const optionalTextField = (max: number) => z.string().max(max).optional();

export const createFabricApplicationSchema = z.object({
  fabricCode: optionalTextField(100),
  composition: optionalTextField(300),
  width: optionalTextField(100),
  gsm: optionalTextField(100),
  wovenOrKnit: optionalTextField(100),
  stretch: optionalTextField(300),
  drape: optionalTextField(300),
  transparency: optionalTextField(300),
  surfaceCharacter: optionalTextField(300),
  printPattern: optionalTextField(300),
  directionality: optionalTextField(300),
  specialPlacement: optionalTextField(300),
  availableQuantity: z.coerce.number().min(0).optional(),
  costPerMetre: z.coerce.number().min(0).optional(),
});
export type CreateFabricApplicationInput = z.infer<typeof createFabricApplicationSchema>;

export const fabricApplicationDecisionSchema = z.object({
  decision: z.literal("APPROVE"),
  /** Required — every decision-style action in this codebase requires explicit confirmation before committing. */
  confirmed: z.boolean(),
});
export type FabricApplicationDecisionInput = z.infer<typeof fabricApplicationDecisionSchema>;

export const approveDesignAndFabricSchema = z.object({
  fabricApplicationId: z.string().uuid(),
  /** Required — "APPROVE DESIGN & FABRIC" is the final, workflow-advancing action. */
  confirmed: z.boolean(),
});
export type ApproveDesignAndFabricInput = z.infer<typeof approveDesignAndFabricSchema>;
