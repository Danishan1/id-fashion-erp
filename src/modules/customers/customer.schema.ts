import { z } from "zod";

export const customerSchema = z.object({
  code: z.string().min(1, "Code is required").max(30),
  name: z.string().min(1, "Name is required").max(200),
  type: z.enum(["CUSTOMER", "AGENT"]).default("CUSTOMER"),
  country: z.string().max(100).optional().or(z.literal("")),
  paymentTermsDays: z.coerce.number().int().min(0).optional(),
  creditLimit: z.coerce.number().min(0).optional(),
  defaultCurrencyCode: z.string().length(3).optional().or(z.literal("")),
  isActive: z.boolean().default(true),
});

export type CustomerInput = z.infer<typeof customerSchema>;

export const buyerSchema = z.object({
  code: z.string().min(1, "Code is required").max(30),
  name: z.string().min(1, "Name is required").max(200),
  contactPerson: z.string().max(200).optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(50).optional().or(z.literal("")),
  // No default — omitted means "leave as-is" on update (see updateBuyer);
  // create treats omitted as true. Same reasoning as Color/Size/Unit's own
  // isActive field: a Zod default would silently reactivate a deactivated
  // Buyer on an ordinary edit that doesn't touch this field.
  isActive: z.boolean().optional(),
});

export type BuyerInput = z.infer<typeof buyerSchema>;
