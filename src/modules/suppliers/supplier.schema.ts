import { z } from "zod";
import { optionalPhoneSchema } from "@/lib/validation";

export const supplierSchema = z.object({
  code: z.string().min(1, "Code is required").max(30),
  name: z.string().min(1, "Name is required").max(200),
  categoryId: z.string().uuid("Category is required"),
  contactPerson: z.string().max(200).optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  phone: optionalPhoneSchema,
  address: z.string().max(500).optional().or(z.literal("")),
  taxRegistrationNo: z.string().max(50).optional().or(z.literal("")),
  paymentTermsDays: z.coerce.number().int().min(0).optional(),
  defaultCurrencyCode: z.string().length(3).optional().or(z.literal("")),
  isActive: z.boolean().default(true),
});

export type SupplierInput = z.infer<typeof supplierSchema>;

/** Partial variant for PATCH — only fields actually present in the request body are validated/updated. */
export const supplierUpdateSchema = supplierSchema.partial();
export type SupplierUpdateInput = z.infer<typeof supplierUpdateSchema>;
