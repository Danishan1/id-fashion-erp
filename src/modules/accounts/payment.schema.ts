import { z } from "zod";

export const paymentAllocationInputSchema = z.object({
  // Exactly one of these two must be set — validated in the parent schema's
  // .refine() below (needs `direction` to know which one is legal) and again
  // by the service layer against real invoice data.
  salesInvoiceId: z.string().uuid().optional(),
  purchaseInvoiceId: z.string().uuid().optional(),
  allocatedAmount: z.coerce.number().positive("Allocated amount must be greater than 0"),
});

export type PaymentAllocationInput = z.infer<typeof paymentAllocationInputSchema>;

export const paymentSchema = z
  .object({
    direction: z.enum(["RECEIPT", "PAYMENT_OUT"]),
    customerId: z.string().uuid().optional(),
    supplierId: z.string().uuid().optional(),
    paymentDate: z.string().min(1, "Payment date is required"),
    paymentTypeId: z.string().uuid("Payment type is required"),
    bankAccountId: z.string().uuid().optional().or(z.literal("")),
    referenceNumber: z.string().max(100).optional().or(z.literal("")),
    amount: z.coerce.number().positive("Amount must be greater than 0"),
    // Zero allocations is now legal — an "On Account" payment, received/paid
    // with no specific invoice yet. The service still requires
    // sum(allocations) <= amount (was: must equal exactly), and a separate
    // allocatePayment() action lets the unallocated remainder be applied to
    // real invoices later, once they exist.
    allocations: z.array(paymentAllocationInputSchema).default([]),
    // Optional, client-generated — see CF-5 in HARDENING_BRANCH_INDEPENDENT_AUDIT.md.
    idempotencyKey: z.string().min(1).max(200).optional(),
  })
  .refine((data) => (data.direction === "RECEIPT" ? !!data.customerId : !data.customerId), {
    message: "Customer is required for a Receipt and must not be set for a Payment Out.",
    path: ["customerId"],
  })
  .refine((data) => (data.direction === "PAYMENT_OUT" ? !!data.supplierId : !data.supplierId), {
    message: "Supplier is required for a Payment Out and must not be set for a Receipt.",
    path: ["supplierId"],
  })
  .refine(
    (data) =>
      data.allocations.every((a) =>
        data.direction === "RECEIPT" ? !!a.salesInvoiceId && !a.purchaseInvoiceId : !!a.purchaseInvoiceId && !a.salesInvoiceId
      ),
    {
      message: "Every allocation must link a Sales Invoice for a Receipt, or a Purchase Invoice for a Payment Out.",
      path: ["allocations"],
    }
  );

export type PaymentInput = z.infer<typeof paymentSchema>;

// Applies part (or all) of an already-POSTED payment's unallocated
// remainder to real invoices — same per-line shape as create, minus the
// header fields (direction/party/amount are already fixed on the payment).
export const paymentAllocateSchema = z.object({
  allocations: z.array(paymentAllocationInputSchema).min(1, "At least one allocation is required"),
});
export type PaymentAllocateInput = z.infer<typeof paymentAllocateSchema>;
