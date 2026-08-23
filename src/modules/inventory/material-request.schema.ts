import { z } from "zod";

export const MATERIAL_REQUEST_TYPES = ["PRODUCTION_REQUIREMENT", "DAMAGE_REPLACEMENT"] as const;

export const materialRequestItemSchema = z.object({
  materialId: z.string().uuid("Material is required"),
  colorId: z.string().uuid().optional().or(z.literal("")),
  dyeId: z.string().uuid().optional().or(z.literal("")),
  uomId: z.string().uuid("Unit is required"),
  requestedQuantity: z.coerce.number().positive("Quantity must be greater than 0"),
  // Only meaningful (and required, enforced by materialRequestSchema's own
  // refine below) when the header's requestType is DAMAGE_REPLACEMENT.
  damageReason: z.string().max(500).optional().or(z.literal("")),
  remarks: z.string().max(500).optional().or(z.literal("")),
});
export type MaterialRequestItemInput = z.infer<typeof materialRequestItemSchema>;

export const materialRequestSchema = z
  .object({
    requestType: z.enum(MATERIAL_REQUEST_TYPES).default("PRODUCTION_REQUIREMENT"),
    departmentId: z.string().uuid().optional().or(z.literal("")),
    // Where the material will be issued from — required, since Material Issue
    // must decrement a specific warehouse's real stock balance.
    warehouseId: z.string().uuid("Warehouse is required"),
    requiredDate: z.string().optional().or(z.literal("")),
    purpose: z.string().max(500).optional().or(z.literal("")),
    salesOrderId: z.string().uuid().optional().or(z.literal("")),
    // Nullable traceability to the Production Order this requirement was
    // generated for (Phase 5C) — can be set alongside or instead of
    // salesOrderId.
    productionOrderId: z.string().uuid().optional().or(z.literal("")),
    bomId: z.string().uuid().optional().or(z.literal("")),
    // Required, and only meaningful, when requestType = DAMAGE_REPLACEMENT —
    // the original requirement this damage relates to.
    originalMaterialRequestId: z.string().uuid().optional().or(z.literal("")),
    remarks: z.string().max(1000).optional().or(z.literal("")),
    lines: z.array(materialRequestItemSchema).min(1, "At least one line item is required"),
  })
  .refine(
    (input) =>
      input.requestType !== "DAMAGE_REPLACEMENT" ||
      (!!input.originalMaterialRequestId && input.lines.every((line) => !!line.damageReason)),
    {
      message: "A Damage Replacement request requires the original request and a damage reason on every line.",
      path: ["originalMaterialRequestId"],
    }
  );
export type MaterialRequestInput = z.infer<typeof materialRequestSchema>;

// Same shape as create — full replace-in-a-transaction, blocked once
// anything on the request has actually been issued or escalated (see
// updateMaterialRequestLines in material-request.service.ts).
export const updateMaterialRequestSchema = materialRequestSchema;
export type UpdateMaterialRequestInput = z.infer<typeof updateMaterialRequestSchema>;

export const materialRequestStatusChangeSchema = z.object({
  status: z.enum(["ON_HOLD", "CANCELLED"]),
});
export type MaterialRequestStatusChangeInput = z.infer<typeof materialRequestStatusChangeSchema>;

export const issueMaterialRequestLineSchema = z.object({
  issueQuantity: z.coerce.number().positive("Quantity must be greater than 0"),
});
export type IssueMaterialRequestLineInput = z.infer<typeof issueMaterialRequestLineSchema>;

// Powers the "Generate Material Request" button on BOM/MRP's requirements
// page — recomputes requirements server-side, never trusts client-sent
// needed/available/shortfall numbers (see createMaterialRequestFromShortfall).
export const createMaterialRequestFromShortfallSchema = z.object({
  salesOrderId: z.string().uuid("Sales order is required"),
  warehouseId: z.string().uuid("Warehouse is required"),
  materialIds: z.array(z.string().uuid()).min(1, "Select at least one material"),
  // Set only on a deliberate resubmit after the user has seen and
  // acknowledged the duplicate-request warning.
  overrideDuplicateCheck: z.boolean().optional(),
});
export type CreateMaterialRequestFromShortfallInput = z.infer<typeof createMaterialRequestFromShortfallSchema>;

// One line per material being escalated to a Purchase Order — purchaseQuantity
// is the user-reviewed/edited quantity, never forced to equal the computed
// shortfall (see generatePurchaseOrdersForShortfall).
export const generatePurchaseOrdersForShortfallSchema = z.object({
  lines: z
    .array(
      z.object({
        materialRequestItemId: z.string().uuid(),
        purchaseQuantity: z.coerce.number().positive("Purchase quantity must be greater than 0"),
        supplierId: z.string().uuid("Supplier is required"),
      })
    )
    .min(1, "Select at least one line to purchase"),
  expectedDeliveryDate: z.string().optional().or(z.literal("")),
});
export type GeneratePurchaseOrdersForShortfallInput = z.infer<typeof generatePurchaseOrdersForShortfallSchema>;
