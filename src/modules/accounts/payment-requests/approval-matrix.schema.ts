import { z } from "zod";
import { PAYMENT_REQUEST_TYPES } from "./request-type-registry";

const money = (label: string) =>
  z.coerce
    .number({ message: `${label} is required` })
    .min(0, `${label} cannot be negative`)
    .refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, `${label} can have at most 2 decimal places`);

export const approvalRuleApproverSchema = z
  .object({
    level: z.coerce.number().int().min(1).max(3),
    roleId: z.string().uuid().optional().or(z.literal("")),
    userId: z.string().uuid().optional().or(z.literal("")),
  })
  .refine((a) => Boolean(a.roleId) !== Boolean(a.userId), "Each approver is either a role or a user.");

export const approvalRuleSchema = z
  .object({
    requestType: z.enum(PAYMENT_REQUEST_TYPES),
    branchId: z.string().uuid().optional().or(z.literal("")),
    minAmount: money("Amount from").default(0),
    // Empty = no upper limit ("" must not be coerced to 0).
    maxAmount: z.preprocess((v) => (v === "" || v === null ? undefined : v), money("Amount to").optional()),
    routing: z.enum(["APPROVAL_THEN_PAY", "DIRECT_TO_ACCOUNTANT"]),
    approvalLevels: z.coerce.number().int().min(1).max(3).default(1),
    approverMayPay: z.boolean().default(false),
    approvers: z.array(approvalRuleApproverSchema).max(60).default([]),
  })
  .refine((r) => r.maxAmount === undefined || r.maxAmount > r.minAmount, {
    message: "Amount to must be greater than amount from.",
    path: ["maxAmount"],
  });
export type ApprovalRuleInput = z.infer<typeof approvalRuleSchema>;

export const approvalRuleStatusSchema = z.object({ isActive: z.boolean() });

export const approveDecisionSchema = z.object({
  remark: z.string().trim().max(1000).optional().or(z.literal("")),
});
