import { z } from "zod";
import { GARMENT_ANALYSIS_FIELD_KEYS } from "@/core/ai-designer/garment-analysis/schema";

export const createNewDesignSchema = z.object({
  designSource: z.enum(["FABRIC", "GARMENT", "SKETCH"]),
  projectName: z.string().max(200).optional(),
});

export const newDesignStepSchema = z.object({ step: z.enum(["SOURCE", "GARMENT", "GENERATE", "DESIGNS"]) });

export const updateSourceAnalysisFieldSchema = z.object({
  field: z.enum(GARMENT_ANALYSIS_FIELD_KEYS),
  value: z.string().max(1000),
});

export const selectFabricSchema = z.object({ productId: z.string().uuid() });
export const selectGarmentTemplateSchema = z.object({ key: z.string().min(1).max(100) });
// Every generated design is a garment photo with its own CAD sketch, so there is no output choice.
export const generateNewDesignSchema = z.object({
  imageCount: z.union([z.literal(1), z.literal(3), z.literal(4)]).default(3),
});
/** Undo on the edit page: restore an earlier sketch as the working sketch. */
export const setWorkingSketchSchema = z.object({ attachmentId: z.string().uuid() });
export const colorVariantsSchema = z.object({ colors: z.array(z.string().min(1).max(60)).min(1).max(6) });
export const makeCurrentSchema = z.object({ imageId: z.string().uuid() });

export const generateSketchSchema = z.object({
  viewAngle: z.enum(["FRONT", "BACK", "BOTH"]).default("BOTH"),
  notes: z.string().max(1000).optional(),
});

export const sketchEditSchema = z.object({
  instruction: z.string().max(2000).optional().or(z.literal("")),
  structuralFields: z.record(z.string().min(1).max(100), z.string().max(300)).optional(),
  viewAngle: z.enum(["FRONT", "BACK", "BOTH"]).default("FRONT"),
  imageCount: z.number().int().min(1).max(4).default(1),
  generateGarment: z.boolean().default(true),
  sketchImageAttachmentId: z.string().uuid().optional(),
});
