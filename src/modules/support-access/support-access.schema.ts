import { z } from "zod";
import { SUPPORT_SESSION_DURATIONS } from "@/core/support-access/codes";

export const createSupportRequestSchema = z.object({
  companyId: z.string().uuid(),
  reason: z.string().trim().min(10, "Describe why you need access (at least 10 characters).").max(1000),
  durationMinutes: z
    .number()
    .int()
    .refine((value) => (SUPPORT_SESSION_DURATIONS as readonly number[]).includes(value), {
      message: `Duration must be one of ${SUPPORT_SESSION_DURATIONS.join(", ")} minutes.`,
    }),
});
export type CreateSupportRequestInput = z.infer<typeof createSupportRequestSchema>;

export const verificationCodeSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code."),
});

export const rejectSchema = z.object({
  reason: z.string().trim().max(1000).optional(),
});

export const writeAccessRequestSchema = z.object({
  justification: z
    .string()
    .trim()
    .min(10, "Explain what you need to change and why (at least 10 characters).")
    .max(1000),
});
