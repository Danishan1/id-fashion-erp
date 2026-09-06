import { z } from "zod";

export const updateObservationSchema = z.object({
  approvedObservation: z.string().min(1, "An observation value is required.").max(2000),
});
export type UpdateObservationInput = z.infer<typeof updateObservationSchema>;
