import { z } from "zod";

export const tagNameSchema = z.string().trim().min(1, "Tag name is required").max(40, "Tags are at most 40 characters");

export const createTagSchema = z.object({ name: tagNameSchema, color: z.string().trim().max(20).optional() });
export const updateTagSchema = z.object({ name: tagNameSchema.optional(), color: z.string().trim().max(20).nullable().optional() });

/** Add by id (existing) or by name (created if missing); remove by id. */
export const entityTagChangeSchema = z
  .object({
    addTagIds: z.array(z.string().uuid()).max(50).default([]),
    addTagNames: z.array(tagNameSchema).max(50).default([]),
    removeTagIds: z.array(z.string().uuid()).max(50).default([]),
  })
  .refine((v) => v.addTagIds.length + v.addTagNames.length + v.removeTagIds.length > 0, { message: "Nothing to change." });
export type EntityTagChange = z.infer<typeof entityTagChangeSchema>;
