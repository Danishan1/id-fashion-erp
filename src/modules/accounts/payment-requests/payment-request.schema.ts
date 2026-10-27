import { z } from "zod";
import { PAYMENT_MODES_OF_TRANSFER, PAYMENT_REQUEST_GROUPS, PAYMENT_REQUEST_TYPES } from "./request-type-registry";

/** Money: > 0 and at most 2 decimal places (10.1 ok, 10.123 refused). */
const amountField = z.coerce
  .number({ message: "Amount is required" })
  .positive("Amount must be greater than 0")
  .max(9_999_999_999_999, "Amount is too large")
  .refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, "Amount can have at most 2 decimal places");

const optionalUuid = z.string().uuid().optional().or(z.literal(""));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");

const commonFields = {
  amount: amountField,
  payToName: z.string().trim().max(200).optional().or(z.literal("")),
  supplierId: optionalUuid,
  employeeId: optionalUuid,
  // Optional; defaults to today on the server.
  paymentDueDate: isoDate.optional().or(z.literal("")),
  modeOfTransfer: z.enum(PAYMENT_MODES_OF_TRANSFER).optional().or(z.literal("")),
  remark: z.string().trim().max(2000).optional().or(z.literal("")),
};

export const createPaymentRequestSchema = z.object({
  requestType: z.enum(PAYMENT_REQUEST_TYPES),
  ...commonFields,
  idempotencyKey: z.string().min(1).max(200).optional(),
});
export type CreatePaymentRequestInput = z.infer<typeof createPaymentRequestSchema>;

// The type never changes after creation.
export const updatePaymentRequestSchema = z.object(commonFields);
export type UpdatePaymentRequestInput = z.infer<typeof updatePaymentRequestSchema>;

export const rejectPaymentRequestSchema = z.object({
  rejectionReason: z.string().trim().min(1, "A reason is required to reject a request.").max(1000),
});

export const paymentRequestListFiltersSchema = z.object({
  group: z.enum(PAYMENT_REQUEST_GROUPS).optional(),
  requestType: z.enum(PAYMENT_REQUEST_TYPES).optional(),
  // mine = raised by me; approve = waiting for my approval; pay = approved, waiting for payment.
  view: z.enum(["all", "mine", "approve", "pay"]).optional(),
});
export type PaymentRequestListFilters = z.infer<typeof paymentRequestListFiltersSchema>;
