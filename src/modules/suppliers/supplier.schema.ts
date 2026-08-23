import { z } from "zod";

export const SUPPLIER_CATEGORIES = [
  "FABRIC",
  "TRIMS",
  "ZIPS",
  "BUTTONS",
  "ACCESSORIES",
  "PACKAGING",
  "SERVICES",
  "MACHINERY",
  "OTHER",
] as const;

export const supplierSchema = z.object({
  code: z.string().min(1, "Code is required").max(30),
  name: z.string().min(1, "Name is required").max(200),
  category: z.enum(SUPPLIER_CATEGORIES),
  contactPerson: z.string().max(200).optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(50).optional().or(z.literal("")),
  address: z.string().max(500).optional().or(z.literal("")),
  taxRegistrationNo: z.string().max(50).optional().or(z.literal("")),
  paymentTermsDays: z.coerce.number().int().min(0).optional(),
  defaultCurrencyCode: z.string().length(3).optional().or(z.literal("")),
  isActive: z.boolean().default(true),
});

export type SupplierInput = z.infer<typeof supplierSchema>;
