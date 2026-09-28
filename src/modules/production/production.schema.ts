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

// Scoped single-field update, matching this project's established sub-route
// convention (Sample Request's /color, /damage, /costing) — a Production
// Order's quantity is deliberately not editable through the same route as
// its status/dates, since it needs its own "no lots yet" business guard.
export const updateProductionOrderQuantitySchema = z.object({
  plannedQuantity: z.coerce.number().positive("Planned quantity must be greater than 0"),
});
export type UpdateProductionOrderQuantityInput = z.infer<typeof updateProductionOrderQuantitySchema>;

export const productionOrderStatusChangeSchema = z.object({
  status: z.enum(["ON_HOLD", "CANCELLED", "CLOSED"]),
});
export type ProductionOrderStatusChangeInput = z.infer<typeof productionOrderStatusChangeSchema>;

export const generateMaterialRequestSchema = z.object({
  warehouseId: z.string().uuid("Warehouse is required"),
});
export type GenerateMaterialRequestInput = z.infer<typeof generateMaterialRequestSchema>;

// Purely informational (see LotVariantBreakdown in schema.prisma) — optional
// so a style with no configured variants (or a lot that genuinely doesn't
// need this) still creates exactly as before. When supplied, createLot()
// requires the rows to sum to `quantity` exactly.
export const lotVariantBreakdownRowSchema = z.object({
  productVariantId: z.string().uuid(),
  quantity: z.coerce.number().positive("Quantity must be greater than 0"),
});

export const createLotSchema = z.object({
  quantity: z.coerce.number().positive("Quantity must be greater than 0"),
  uomId: z.string().uuid("Unit is required"),
  variantBreakdown: z.array(lotVariantBreakdownRowSchema).optional(),
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

/** Whole garment pieces — no fractional pieces anywhere a worker's quantity is recorded. */
const pieces = (label: string) =>
  z.coerce
    .number({ message: `${label} must be a number.` })
    .int(`${label} must be a whole number of pieces.`)
    .min(0, `${label} cannot be negative.`);

/** A client datetime string that must parse to a real date. */
const validDateTimeString = (label: string) =>
  z
    .string()
    .min(1, `${label} is required.`)
    .refine((v) => !Number.isNaN(new Date(v).getTime()), `${label} is not a valid date/time.`);

export const createJobOrderAssignmentSchema = z
  .object({
    employeeId: z.string({ message: "Worker is required." }).uuid("Worker is required."),
    assignedQuantity: z.coerce
      .number({ message: "Assigned quantity is required." })
      .int("Assigned quantity must be a whole number of pieces.")
      .positive("Assigned quantity must be greater than 0."),
    // Expected time window (2026-09-28). Start defaults to "now" server-side
    // when omitted; end is required and must be after start.
    expectedStartAt: z
      .string()
      .optional()
      .or(z.literal(""))
      .refine((v) => !v || !Number.isNaN(new Date(v).getTime()), "Expected start is not a valid date/time."),
    expectedEndAt: validDateTimeString("Expected completion time"),
    // Piece-Rate (2026-09-18) — optional: a FIXED_SALARY worker, or a
    // company that hasn't enabled piece-rate tracking, never needs this.
    productionOperationId: z.string().uuid().optional().or(z.literal("")),
    // An authorized rate override, gated behind piece_rate.override —
    // requires a reason. Supplying overriddenRate with no reason (or vice
    // versa) is rejected below.
    overriddenRate: z.coerce.number().positive().optional(),
    overrideReason: z.string().max(500).optional().or(z.literal("")),
  })
  .refine((data) => !data.overriddenRate || (data.overrideReason && data.overrideReason.length > 0), {
    message: "A reason is required when overriding the resolved rate.",
    path: ["overrideReason"],
  })
  .refine(
    (data) => {
      const start = data.expectedStartAt ? new Date(data.expectedStartAt).getTime() : Date.now();
      return new Date(data.expectedEndAt).getTime() > start;
    },
    { message: "Expected completion time must be after the expected start time.", path: ["expectedEndAt"] },
  );
export type CreateJobOrderAssignmentInput = z.infer<typeof createJobOrderAssignmentSchema>;

// ─────────────────────────────────────────────────────────────
// Piece-Rate / Worker-Pricing engine (2026-09-18)
// ─────────────────────────────────────────────────────────────

export const productionOperationSchema = z.object({
  code: z.string().min(1, "Code is required").max(30),
  name: z.string().min(1, "Name is required").max(200),
  productionStageId: z.string().uuid().optional().or(z.literal("")),
});
export type ProductionOperationSchemaInput = z.infer<typeof productionOperationSchema>;

export const pieceRateCardSchema = z
  .object({
    productionOperationId: z.string().uuid("Operation is required"),
    productId: z.string().uuid().optional().or(z.literal("")),
    employeeId: z.string().uuid().optional().or(z.literal("")),
    employeeCategoryId: z.string().uuid().optional().or(z.literal("")),
    rate: z.coerce.number().positive("Rate must be greater than 0"),
    effectiveFrom: z.string().min(1, "Effective-from date is required"),
    effectiveTo: z.string().optional().or(z.literal("")),
  })
  .refine((data) => !(data.employeeId && data.employeeCategoryId), {
    message: "Scope a rate to a specific worker OR a worker grade, never both.",
    path: ["employeeCategoryId"],
  });
export type PieceRateCardSchemaInput = z.infer<typeof pieceRateCardSchema>;

export const resolvePieceRateSchema = z.object({
  jobOrderId: z.string().uuid(),
  employeeId: z.string().uuid(),
  productionOperationId: z.string().uuid(),
});
export type ResolvePieceRateInput = z.infer<typeof resolvePieceRateSchema>;

/**
 * Log Process (2026-09-28): an entry is always FOR a real worker assignment —
 * the worker is derived from the assignment server-side, never trusted from
 * the client. `employeeId` is still accepted for backward compatibility and,
 * when sent, must match the assignment's own worker.
 */
export const createProgressEntrySchema = z.object({
  jobOrderAssignmentId: z
    .string({ message: "Select an assigned worker." })
    .uuid("Select an assigned worker."),
  employeeId: z.string().uuid().optional().or(z.literal("")),
  completedQuantity: pieces("Completed").default(0),
  rejectedQuantity: pieces("Rejected").default(0),
  damagedQuantity: pieces("Damage").default(0),
  // Explicit extra pieces — only accepted on a stage that allows extras
  // (e.g. Cutting); part of completedQuantity, never additional to it.
  extraQuantity: pieces("Extra").default(0),
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
  // Epsilon tolerance, not exact equality — 0.1 + 0.2 !== 0.3 in IEEE-754,
  // and this codebase's own decimal quantities routinely land on inexact
  // sums (matches the EPSILON convention already used by every quantity-cap
  // check in job-order.service.ts).
  .refine(
    (input) => Math.abs(input.acceptedQuantity + input.rejectedQuantity + input.damagedQuantity - input.inspectedQuantity) < 0.0001,
    {
      message: "Accepted + Rejected + Damaged must equal the inspected quantity.",
      path: ["inspectedQuantity"],
    }
  )
  // Only required when the service actually consults it — recordQcInspection()
  // only looks up reworkTargetStageId when rejectedQuantity > 0 (a pure-damage
  // disposition with damagedQuantity > 0 and rejectedQuantity === 0 never
  // reads it at all). Requiring it for any non-PASS result was stricter than
  // the service needs, and made a pure-damage FAIL unrecordable at the very
  // first production stage (no earlier stage exists to name).
  .refine((input) => input.result === "PASS" || input.rejectedQuantity <= 0 || !!input.reworkTargetStageId, {
    message: "A rework target stage is required whenever any quantity is being rejected.",
    path: ["reworkTargetStageId"],
  })
  // A defect describes what's wrong with rejected/damaged units — it can
  // never exceed how many units were actually disposed as rejected/damaged
  // on this inspection, and a clean PASS (nothing rejected or damaged) has
  // nothing for a defect to describe. Neither was previously enforced: a
  // real DB row was found with a defect quantity of 500 attached to an
  // inspection whose own totals were inspected=200/accepted=200/rejected=0/
  // damaged=0 — a clean PASS — silently corrupting Defect-wise Analysis
  // reporting (ERP-BUG-Q10-0002, Phase 10 QA pass).
  .refine((input) => input.defects.length === 0 || input.result !== "PASS", {
    message: "Defects cannot be recorded against a PASS result — nothing was rejected or damaged.",
    path: ["defects"],
  })
  .refine(
    (input) => input.defects.reduce((sum, d) => sum + d.quantity, 0) <= input.rejectedQuantity + input.damagedQuantity + 0.0001,
    {
      message: "Total defect quantity cannot exceed the rejected + damaged quantity on this inspection.",
      path: ["defects"],
    }
  );
export type CreateQcInspectionInput = z.infer<typeof createQcInspectionSchema>;

// Worker self-entry (2026-09-02) — deliberately no employeeId/jobOrderAssignmentId
// field: the service resolves both itself from the caller's own linked
// Employee, so a worker can never submit progress crediting someone else.
export const submitSelfProgressEntrySchema = z.object({
  completedQuantity: pieces("Completed").default(0),
  rejectedQuantity: pieces("Rejected").default(0),
  damagedQuantity: pieces("Damage").default(0),
  extraQuantity: pieces("Extra").default(0),
  remarks: z.string().max(500).optional().or(z.literal("")),
});
export type SubmitSelfProgressEntryInput = z.infer<typeof submitSelfProgressEntrySchema>;

export const updatePendingProgressEntrySchema = z.object({
  completedQuantity: pieces("Completed"),
  rejectedQuantity: pieces("Rejected"),
  damagedQuantity: pieces("Damage"),
  // Optional on edit — omitted keeps the entry's existing extra pieces.
  extraQuantity: pieces("Extra").optional(),
  remarks: z.string().max(500).optional().or(z.literal("")),
});
export type UpdatePendingProgressEntryInput = z.infer<typeof updatePendingProgressEntrySchema>;

export const decideProgressEntrySchema = z.object({
  approvalRemark: z.string().max(500).optional().or(z.literal("")),
});
export type DecideProgressEntryInput = z.infer<typeof decideProgressEntrySchema>;

export const rejectProgressEntrySchema = z.object({
  approvalRemark: z.string().min(1, "A remark is required to reject an entry").max(500),
});
export type RejectProgressEntryInput = z.infer<typeof rejectProgressEntrySchema>;

export const defectTypeSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(200),
});
export type DefectTypeInput = z.infer<typeof defectTypeSchema>;
