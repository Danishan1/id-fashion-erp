import { z } from "zod";

export const colorSchema = z.object({
  code: z.string().min(1, "Code is required").max(20),
  name: z.string().min(1, "Name is required").max(100),
  hexValue: z.string().max(10).optional().or(z.literal("")),
  // No default here deliberately — the "Edit" form never sends this field
  // (only the dedicated Active/Inactive toggle does), and a Zod default
  // would silently reactivate an inactive record on every ordinary edit.
  // Service layer: create defaults to true when omitted; update preserves
  // the existing value when omitted.
  isActive: z.coerce.boolean().optional(),
});
export type ColorInput = z.infer<typeof colorSchema>;

export const sizeSchema = z.object({
  code: z.string().min(1, "Code is required").max(20),
  name: z.string().min(1, "Name is required").max(100),
  sortOrder: z.coerce.number().int().default(0),
  // No default here deliberately — the "Edit" form never sends this field
  // (only the dedicated Active/Inactive toggle does), and a Zod default
  // would silently reactivate an inactive record on every ordinary edit.
  // Service layer: create defaults to true when omitted; update preserves
  // the existing value when omitted.
  isActive: z.coerce.boolean().optional(),
});
export type SizeInput = z.infer<typeof sizeSchema>;

export const unitSchema = z.object({
  code: z.string().min(1, "Code is required").max(20),
  name: z.string().min(1, "Name is required").max(100),
  conversionFactor: z.coerce.number().positive().default(1),
  // If set, 1 of this unit = conversionFactor units of baseUnitId — must itself be a root unit
  // (its own baseUnitId must be null), enforced in lookup.service.ts. Depth-1 only, by design.
  baseUnitId: z.string().uuid().optional().or(z.literal("")),
  // No default here deliberately — the "Edit" form never sends this field
  // (only the dedicated Active/Inactive toggle does), and a Zod default
  // would silently reactivate an inactive record on every ordinary edit.
  // Service layer: create defaults to true when omitted; update preserves
  // the existing value when omitted.
  isActive: z.coerce.boolean().optional(),
});
export type UnitInput = z.infer<typeof unitSchema>;
