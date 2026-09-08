import { z } from "zod";

export const generateBuyerCommentsSchema = z.object({});
export type GenerateBuyerCommentsInput = z.infer<typeof generateBuyerCommentsSchema>;
