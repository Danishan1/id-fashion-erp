import { z } from "zod";
import { optionalPhoneSchema } from "@/lib/validation";

export const createUserSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  fullName: z.string().min(1, "Full name is required").max(200),
  password: z.string().min(8, "Password must be at least 8 characters"),
  phone: optionalPhoneSchema,
  branchId: z.string().uuid("Pick a branch"),
  roleId: z.string().uuid("Pick a role"),
  // Links this login to a real Employee record — the actual mechanism by
  // which a shop-floor worker gets self-entry access (see
  // resolveSelfEntryEmployee in job-order.service.ts). Optional: most users
  // (office staff, management) have no corresponding Employee row to link.
  employeeId: z.string().uuid().optional().or(z.literal("")),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserStatusSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED"]),
});
export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>;

export const resetUserPasswordSchema = z.object({
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
});
export type ResetUserPasswordInput = z.infer<typeof resetUserPasswordSchema>;

export const updateUserSchema = z.object({
  fullName: z.string().min(1, "Full name is required").max(200).optional(),
  email: z.string().email("Enter a valid email address").optional(),
  phone: optionalPhoneSchema,
  employeeId: z.string().uuid().optional().or(z.literal("")),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const addUserBranchRoleSchema = z.object({
  branchId: z.string().uuid("Pick a branch"),
  roleId: z.string().uuid("Pick a role"),
});
export type AddUserBranchRoleInput = z.infer<typeof addUserBranchRoleSchema>;
