import { z } from "zod";
import { optionalPhoneSchema } from "@/lib/validation";

export const contractorSchema = z.object({
  code: z.string().min(1, "Code is required").max(30),
  name: z.string().min(1, "Name is required").max(200),
  contactPerson: z.string().max(200).optional().or(z.literal("")),
  phone: optionalPhoneSchema,
  email: z.string().email().optional().or(z.literal("")),
  address: z.string().max(500).optional().or(z.literal("")),
  isActive: z.boolean().default(true),
});

export type ContractorInput = z.infer<typeof contractorSchema>;

/** Partial variant for PATCH — only fields actually present in the request body are validated/updated. */
export const contractorUpdateSchema = contractorSchema.partial();
export type ContractorUpdateInput = z.infer<typeof contractorUpdateSchema>;
