import { z } from "zod";

export const createJobWorkOrderSchema = z.object({
  jobOrderId: z.string().uuid("Job order is required"),
  supplierId: z.string().uuid("Contractor is required"),
  issuedQuantity: z.coerce.number().positive("Issued quantity must be greater than 0"),
  uomId: z.string().uuid("Unit is required"),
  issueDate: z.string().min(1, "Issue date is required"),
  expectedCompletionDate: z.string().optional().or(z.literal("")),
  remarks: z.string().max(1000).optional().or(z.literal("")),
  // Piece-Rate external costing (2026-09-18) — optional: a JobWorkOrder's
  // single stage may have more than one configured Operation, so this is set
  // explicitly rather than inferred. Never blocks issuance when omitted or
  // when no rate resolves — see createJobWorkOrder()'s own UNRESOLVED handling.
  productionOperationId: z.string().uuid().optional().or(z.literal("")),
  materials: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.coerce.number().positive("Material quantity must be greater than 0"),
        uomId: z.string().uuid(),
        warehouseId: z.string().uuid(),
        fabricRollId: z.string().uuid().optional().or(z.literal("")),
        notes: z.string().max(500).optional().or(z.literal("")),
      })
    )
    .optional()
    .default([]),
});
export type CreateJobWorkOrderInput = z.infer<typeof createJobWorkOrderSchema>;

export const receiveJobWorkSchema = z.object({
  receivedDate: z.string().min(1, "Received date is required"),
  receivedQuantity: z.coerce.number().min(0).default(0),
  rejectedQuantity: z.coerce.number().min(0).default(0),
  damagedQuantity: z.coerce.number().min(0).default(0),
  remarks: z.string().max(1000).optional().or(z.literal("")),
  // Optional, client-generated — see CF-5 in HARDENING_BRANCH_INDEPENDENT_AUDIT.md.
  idempotencyKey: z.string().min(1).max(200).optional(),
});
export type ReceiveJobWorkInput = z.infer<typeof receiveJobWorkSchema>;

export const reverseJobWorkReceiptSchema = z.object({
  reason: z.string().min(1, "A reason is required to reverse a job-work receipt.").max(500),
});
export type ReverseJobWorkReceiptInput = z.infer<typeof reverseJobWorkReceiptSchema>;

export const jobWorkOrderStatusChangeSchema = z.object({
  status: z.enum(["ON_HOLD", "CANCELLED", "CLOSED"]),
});
export type JobWorkOrderStatusChangeInput = z.infer<typeof jobWorkOrderStatusChangeSchema>;

// External Unit User (2026-09-18) — a Supervisor's decision on an external
// receipt submission. Rejection requires a remark, mirroring
// rejectProgressEntry's own precedent.
export const rejectJobWorkReceiptSchema = z.object({
  approvalRemark: z.string().min(1, "A reason is required to reject this receipt.").max(500),
});
export type RejectJobWorkReceiptInput = z.infer<typeof rejectJobWorkReceiptSchema>;
