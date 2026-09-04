import { z } from "zod";
import { requiredPhoneSchema } from "@/lib/validation";

export const customerSchema = z.object({
  code: z.string().min(1, "Code is required").max(30),
  name: z.string().min(1, "Name is required").max(200),
  type: z.enum(["CUSTOMER", "AGENT"]).default("CUSTOMER"),
  country: z.string().max(100).optional().or(z.literal("")),
  taxRegistrationNo: z.string().max(50).optional().or(z.literal("")),
  billingAddress: z.string().max(500).optional().or(z.literal("")),
  shippingAddress: z.string().max(500).optional().or(z.literal("")),
  paymentTermsDays: z.coerce.number().int().min(0).optional(),
  creditLimit: z.coerce.number().min(0).optional(),
  defaultCurrencyCode: z.string().length(3).optional().or(z.literal("")),
  isActive: z.boolean().default(true),
});

export type CustomerInput = z.infer<typeof customerSchema>;

export const buyerSchema = z.object({
  code: z.string().min(1, "Code is required").max(30),
  name: z.string().min(1, "Name is required").max(200),
  // Required per the Customer-required-fields analysis (2026-09-01): a Buyer
  // record with no way to reach them isn't useful — Customer itself stays a
  // lightweight identity record, so reachability lives here instead.
  contactPerson: z.string().min(1, "Contact person is required").max(200),
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
  phone: requiredPhoneSchema,
  // No default — omitted means "leave as-is" on update (see updateBuyer);
  // create treats omitted as true. Same reasoning as Color/Size/Unit's own
  // isActive field: a Zod default would silently reactivate a deactivated
  // Buyer on an ordinary edit that doesn't touch this field.
  isActive: z.boolean().optional(),
});

export type BuyerInput = z.infer<typeof buyerSchema>;
