import { z } from "zod";

export const savedViewBaseSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  filters: z.record(z.string(), z.unknown()).default({}),
  sort: z.object({ sortBy: z.string().max(40), sortOrder: z.enum(["asc", "desc"]) }).nullable().optional(),
  columns: z.array(z.string().max(40)).max(40).nullable().optional(),
  visibility: z.enum(["PRIVATE", "SHARED"]).default("PRIVATE"),
});
export const updateSavedViewSchema = savedViewBaseSchema.partial();
