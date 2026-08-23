import { z } from "zod";

export const createProductionOrderSchema = z.object({
  salesOrderItemId: z.string().uuid().optional().or(z.literal("")),
  productId: z.string().uuid("Style is required"),
  plannedQuantity: z.coerce.number().positive("Planned quantity must be greater than 0"),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
  plannedStartDate: z.string().optional().or(z.literal("")),
  plannedEndDate: z.string().optional().or(z.literal("")),
  remarks: z.string().max(1000).optional().or(z.literal("")),
});
export type CreateProductionOrderInput = z.infer<typeof createProductionOrderSchema>;

export const productionOrderStatusChangeSchema = z.object({
  status: z.enum(["ON_HOLD", "CANCELLED", "CLOSED"]),
});
export type ProductionOrderStatusChangeInput = z.infer<typeof productionOrderStatusChangeSchema>;

export const generateMaterialRequestSchema = z.object({
  warehouseId: z.string().uuid("Warehouse is required"),
});
export type GenerateMaterialRequestInput = z.infer<typeof generateMaterialRequestSchema>;

export const createLotSchema = z.object({
  quantity: z.coerce.number().positive("Quantity must be greater than 0"),
  uomId: z.string().uuid("Unit is required"),
});
export type CreateLotInput = z.infer<typeof createLotSchema>;

export const splitLotSchema = z.object({
  children: z
    .array(
      z.object({
        quantity: z.coerce.number().positive("Quantity must be greater than 0"),
      })
    )
    .min(2, "Split requires at least 2 resulting lots"),
  reason: z.string().max(500).optional().or(z.literal("")),
});
export type SplitLotInput = z.infer<typeof splitLotSchema>;

export const mergeLotsSchema = z.object({
  parentLotIds: z.array(z.string().uuid()).min(2, "Merge requires at least 2 source lots"),
  reason: z.string().max(500).optional().or(z.literal("")),
});
export type MergeLotsInput = z.infer<typeof mergeLotsSchema>;

export const createJobOrderAssignmentSchema = z.object({
  employeeId: z.string().uuid("Employee is required"),
  assignedQuantity: z.coerce.number().positive("Assigned quantity must be greater than 0"),
});
export type CreateJobOrderAssignmentInput = z.infer<typeof createJobOrderAssignmentSchema>;

export const createProgressEntrySchema = z.object({
  jobOrderAssignmentId: z.string().uuid().optional().or(z.literal("")),
  employeeId: z.string().uuid("Employee is required"),
  completedQuantity: z.coerce.number().min(0).default(0),
  rejectedQuantity: z.coerce.number().min(0).default(0),
  damagedQuantity: z.coerce.number().min(0).default(0),
  remarks: z.string().max(500).optional().or(z.literal("")),
  startedAt: z.string().optional().or(z.literal("")),
  endedAt: z.string().optional().or(z.literal("")),
});
export type CreateProgressEntryInput = z.infer<typeof createProgressEntrySchema>;

// A correction entry — the only kind allowed to carry a value that reduces
// an earlier (mistaken) entry. Gated behind a distinct permission from a
// normal progress entry (see job-order.service.ts).
export const createAdjustmentEntrySchema = z.object({
  completedQuantity: z.coerce.number().default(0),
  rejectedQuantity: z.coerce.number().default(0),
  damagedQuantity: z.coerce.number().default(0),
  remarks: z.string().min(1, "A reason is required for an adjustment entry").max(500),
});
export type CreateAdjustmentEntryInput = z.infer<typeof createAdjustmentEntrySchema>;

export const forwardJobOrderSchema = z.object({
  quantity: z.coerce.number().positive("Quantity must be greater than 0"),
  // Omit to default to the immediate next active stage; a stage further
  // ahead requires the caller to hold production.approve (stage-skip override).
  targetStageId: z.string().uuid().optional().or(z.literal("")),
  // Required only when the resolved target stage is flagged isFinal — the
  // warehouse the Finished-Goods receipt posts into.
  finishedGoodsWarehouseId: z.string().uuid().optional().or(z.literal("")),
});
export type ForwardJobOrderInput = z.infer<typeof forwardJobOrderSchema>;

export const startLotSchema = z.object({
  stageId: z.string().uuid().optional().or(z.literal("")),
});
export type StartLotInput = z.infer<typeof startLotSchema>;

export const revertJobOrderSchema = z.object({
  targetStageId: z.string().uuid("Target stage is required"),
  quantity: z.coerce.number().positive("Quantity must be greater than 0"),
  reason: z.string().min(1, "A reason is required to revert to an earlier stage").max(500),
});
export type RevertJobOrderInput = z.infer<typeof revertJobOrderSchema>;

export const createQcInspectionSchema = z
  .object({
    inspectedQuantity: z.coerce.number().positive("Inspected quantity must be greater than 0"),
    acceptedQuantity: z.coerce.number().min(0),
    rejectedQuantity: z.coerce.number().min(0),
    damagedQuantity: z.coerce.number().min(0).default(0),
    result: z.enum(["PASS", "PARTIAL_PASS", "FAIL"]),
    // Required whenever any quantity needs to go backward (PARTIAL_PASS/FAIL).
    reworkTargetStageId: z.string().uuid().optional().or(z.literal("")),
    // Required whenever damagedQuantity > 0 (fully-damaged write-off) or
    // acceptedQuantity > 0 and the next stage is isFinal.
    damageWarehouseId: z.string().uuid().optional().or(z.literal("")),
    finishedGoodsWarehouseId: z.string().uuid().optional().or(z.literal("")),
    remarks: z.string().max(500).optional().or(z.literal("")),
    defects: z
      .array(
        z.object({
          defectTypeId: z.string().uuid(),
          quantity: z.coerce.number().positive(),
          severity: z.string().max(50).optional().or(z.literal("")),
          remarks: z.string().max(500).optional().or(z.literal("")),
        })
      )
      .optional()
      .default([]),
  })
  .refine((input) => input.acceptedQuantity + input.rejectedQuantity + input.damagedQuantity === input.inspectedQuantity, {
    message: "Accepted + Rejected + Damaged must equal the inspected quantity.",
    path: ["inspectedQuantity"],
  })
  .refine((input) => input.result === "PASS" || !!input.reworkTargetStageId, {
    message: "A rework target stage is required for a Partial Pass or Fail result.",
    path: ["reworkTargetStageId"],
  });
export type CreateQcInspectionInput = z.infer<typeof createQcInspectionSchema>;

export const defectTypeSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(200),
});
export type DefectTypeInput = z.infer<typeof defectTypeSchema>;
