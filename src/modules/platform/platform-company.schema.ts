import { z } from "zod";

export const createCompanySchema = z.object({
  companyName: z.string().min(1, "Company name is required").max(200),
  legalName: z.string().max(200).optional().or(z.literal("")),
  taxRegistrationNo: z.string().max(100).optional().or(z.literal("")),
  baseCurrencyCode: z.string().length(3, "Select a currency"),
  fiscalYearStartMonth: z.coerce.number().int().min(1).max(12).default(1),
  branchCode: z.string().min(1, "Branch code is required").max(30),
  branchName: z.string().min(1, "Branch name is required").max(200),
  branchType: z.enum(["FACTORY", "OFFICE", "WAREHOUSE"]),
  adminEmail: z.string().email("A valid email is required"),
  adminPassword: z.string().min(8, "Password must be at least 8 characters"),
  adminFullName: z.string().min(1, "Admin name is required").max(200),
  // Phase 4: trial plan; empty = the default trial plan.
  planId: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.string().uuid("Select a plan").optional()),
});

export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
