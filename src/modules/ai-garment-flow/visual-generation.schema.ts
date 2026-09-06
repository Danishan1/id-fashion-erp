import { z } from "zod";

export const IMAGE_COUNT_VALUES = [1, 3, 4] as const;

export const generateVisualsSchema = z.object({
  imageCount: z.union([z.literal(1), z.literal(3), z.literal(4)]),
});
export type GenerateVisualsInput = z.infer<typeof generateVisualsSchema>;

export const createVariationSchema = z.object({
  imageCount: z.union([z.literal(1), z.literal(3), z.literal(4)]),
});
export type CreateVariationInput = z.infer<typeof createVariationSchema>;

export const imageDecisionSchema = z.object({
  decision: z.enum(["SELECT", "REJECT"]),
  /** Required only for SELECT — this is the "require confirmation" step; the client shows a ConfirmModal and this flag is the server-side proof it was actually confirmed, not just clicked once. */
  confirmed: z.boolean().optional(),
});
export type ImageDecisionInput = z.infer<typeof imageDecisionSchema>;

export const updateImageNotesSchema = z.object({
  userNotes: z.string().max(1000).optional().or(z.literal("")),
});
export type UpdateImageNotesInput = z.infer<typeof updateImageNotesSchema>;
