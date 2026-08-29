import { z } from "zod";

export const createRoleSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().max(500).optional().or(z.literal("")),
});
export type CreateRoleInput = z.infer<typeof createRoleSchema>;

// Permission keys ("module.action", e.g. "sales_orders.view") — validated
// against the real catalog server-side in the service, not just shape-checked
// here, so a typo'd key can't silently no-op instead of erroring.
export const updateRolePermissionsSchema = z.object({
  grantedKeys: z.array(z.string()),
});
export type UpdateRolePermissionsInput = z.infer<typeof updateRolePermissionsSchema>;

// Production stage ids this role is restricted to — validated against the
// real active-stage set server-side in the service, not just shape-checked
// here. An empty array means "unrestricted" (sees every stage), not "no
// change" — a PUT with [] deliberately clears any existing restriction.
export const updateRoleProductionStagesSchema = z.object({
  stageIds: z.array(z.string().uuid()),
});
export type UpdateRoleProductionStagesInput = z.infer<typeof updateRoleProductionStagesSchema>;
