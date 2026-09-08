import { z } from "zod";

export const updateFabricObservationSchema = z.object({
  approvedObservation: z.string().min(1, "An observation value is required.").max(2000),
});
export type UpdateFabricObservationInput = z.infer<typeof updateFabricObservationSchema>;
