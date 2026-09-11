import { z } from "zod";
import { MATERIAL_CATEGORIES } from "@/modules/products/product.schema";

/**
 * Tech Pack's own graded size set — deliberately a small fixed list, NOT
 * the company's real Size master (unlike AI Garment Flow's own Technical
 * Specification process, which grades across the real master). This is a
 * documented, deliberate scope reduction: AI Designer has no per-company
 * Size-master integration anywhere else, and building one just for this one
 * feature would be a much larger, separate piece of work.
 */
export const STANDARD_SIZES = ["XS", "S", "M", "L", "XL", "XXL"] as const;
export type StandardSize = (typeof STANDARD_SIZES)[number];

const sizeValuesSchema = z.object({
  XS: z.string().min(1),
  S: z.string().min(1),
  M: z.string().min(1),
  L: z.string().min(1),
  XL: z.string().min(1),
  XXL: z.string().min(1),
});

const measurementPointSchema = z.object({
  pointName: z.string().min(1),
  howToMeasure: z.string().min(1),
  toleranceCm: z.string().min(1),
  values: sizeValuesSchema,
});
export type MeasurementPointOutput = z.infer<typeof measurementPointSchema>;

export interface GradingResponse {
  points: MeasurementPointOutput[];
  generalNotes: string;
}

const gradingResponseSchema = z.object({
  points: z.array(measurementPointSchema).min(5).max(20),
  generalNotes: z.string().min(1),
});

export function validateGradingResponse(input: unknown): { success: true; data: GradingResponse } | { success: false; error: string } {
  const result = gradingResponseSchema.safeParse(input);
  if (result.success) return { success: true, data: result.data };
  const firstIssue = result.error.issues[0];
  return { success: false, error: firstIssue ? `${firstIssue.path.join(".")}: ${firstIssue.message}` : "Invalid structured response." };
}

const bomItemSchema = z.object({
  materialDescription: z.string().min(1),
  materialCategory: z.enum(MATERIAL_CATEGORIES),
  suggestedQuantityPerUnit: z.number().positive(),
  suggestedUom: z.string().min(1),
  reasoning: z.string().min(1),
});
export type TechPackBomItemOutput = z.infer<typeof bomItemSchema>;

export interface BomResponse {
  items: TechPackBomItemOutput[];
}

const bomResponseSchema = z.object({
  items: z.array(bomItemSchema).min(1).max(20),
});

export function validateBomResponse(input: unknown): { success: true; data: BomResponse } | { success: false; error: string } {
  const result = bomResponseSchema.safeParse(input);
  if (result.success) return { success: true, data: result.data };
  const firstIssue = result.error.issues[0];
  return { success: false, error: firstIssue ? `${firstIssue.path.join(".")}: ${firstIssue.message}` : "Invalid structured response." };
}
