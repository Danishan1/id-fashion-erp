import { z } from "zod";

export const productionStageSchema = z.object({
  code: z.string().min(1, "Code is required").max(30),
  name: z.string().min(1, "Name is required").max(200),
  sequence: z.coerce.number().int().default(0),
  isActive: z.coerce.boolean().default(true),
});
export type ProductionStageInput = z.infer<typeof productionStageSchema>;

export const productionLineSchema = z.object({
  code: z.string().min(1, "Code is required").max(30),
  name: z.string().min(1, "Name is required").max(200),
  capacityPerDay: z.coerce.number().int().min(0).optional(),
  isActive: z.coerce.boolean().default(true),
});
export type ProductionLineInput = z.infer<typeof productionLineSchema>;

export const machineSchema = z.object({
  code: z.string().min(1, "Code is required").max(30),
  name: z.string().min(1, "Name is required").max(200),
  productionLineId: z.string().uuid().optional().or(z.literal("")),
  machineType: z.string().max(100).optional().or(z.literal("")),
  isActive: z.coerce.boolean().default(true),
});
export type MachineInput = z.infer<typeof machineSchema>;

export const salesAgentSchema = z.object({
  code: z.string().min(1, "Code is required").max(30),
  name: z.string().min(1, "Name is required").max(200),
  contactPerson: z.string().max(200).optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(50).optional().or(z.literal("")),
  commissionPercent: z.coerce.number().min(0).max(100).optional(),
  isActive: z.coerce.boolean().default(true),
});
export type SalesAgentInput = z.infer<typeof salesAgentSchema>;
