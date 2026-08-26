import { z } from "zod";

export const createUserSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  fullName: z.string().min(1, "Full name is required").max(200),
  password: z.string().min(8, "Password must be at least 8 characters"),
  phone: z.string().max(20).optional().or(z.literal("")),
  branchId: z.string().uuid("Pick a branch"),
  roleId: z.string().uuid("Pick a role"),
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
  phone: z.string().max(20).optional().or(z.literal("")),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const addUserBranchRoleSchema = z.object({
  branchId: z.string().uuid("Pick a branch"),
  roleId: z.string().uuid("Pick a role"),
});
export type AddUserBranchRoleInput = z.infer<typeof addUserBranchRoleSchema>;
