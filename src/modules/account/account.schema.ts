import { z } from "zod";

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  // Same minimum-length rule createUserSchema already applies to its own
  // password field — one rule, not a second one invented for this form.
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
