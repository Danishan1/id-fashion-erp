import { z } from "zod";
import { optionalPhoneSchema } from "@/lib/validation";

export const FORWARDER_TYPES = ["COURIER", "ROAD", "RAIL", "AIR", "OTHER"] as const;

export const forwarderSchema = z.object({
  // Auto-generated server-side when blank (see createForwarder).
  code: z.string().max(30).optional().or(z.literal("")),
  name: z.string().min(1, "Name is required").max(200),
  type: z.enum(FORWARDER_TYPES).default("COURIER"),
  contactPerson: z.string().max(200).optional().or(z.literal("")),
  phone: optionalPhoneSchema,
  altPhone: optionalPhoneSchema,
  email: z.string().email().optional().or(z.literal("")),
  address: z.string().max(500).optional().or(z.literal("")),
  city: z.string().max(100).optional().or(z.literal("")),
  state: z.string().max(100).optional().or(z.literal("")),
  country: z.string().max(100).optional().or(z.literal("")),
  postalCode: z.string().max(20).optional().or(z.literal("")),
  gstin: z.string().max(20).optional().or(z.literal("")),
  remarks: z.string().max(1000).optional().or(z.literal("")),
  isActive: z.boolean().default(true),
});

export type ForwarderInput = z.infer<typeof forwarderSchema>;

/** Partial variant for PATCH — only fields actually present in the request body are validated/updated. */
export const forwarderUpdateSchema = forwarderSchema.partial();
export type ForwarderUpdateInput = z.infer<typeof forwarderUpdateSchema>;
