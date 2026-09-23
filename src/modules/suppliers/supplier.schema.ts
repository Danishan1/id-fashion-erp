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
  city: z.string().max(100).optional().or(z.literal("")),
  pinCode: z.string().max(20).optional().or(z.literal("")),
  country: z.string().max(100).optional().or(z.literal("")),
  taxRegistrationNo: z.string().max(50).optional().or(z.literal("")),
  paymentTermsDays: z.coerce.number().int().min(0).optional(),
  defaultCurrencyCode: z.string().length(3).optional().or(z.literal("")),
  isActive: z.boolean().default(true),
  // Distinct from Category (single-valued) — a supplier can be a
  // raw-material vendor AND an external job-work contractor at once.
  // Filters the "Send to External Job-Work" picker (LotWorkflowPanel.tsx).
  isJobWorkContractor: z.boolean().default(false),
});

export type SupplierInput = z.infer<typeof supplierSchema>;

/** Partial variant for PATCH — only fields actually present in the request body are validated/updated. */
export const supplierUpdateSchema = supplierSchema.partial();
export type SupplierUpdateInput = z.infer<typeof supplierUpdateSchema>;
