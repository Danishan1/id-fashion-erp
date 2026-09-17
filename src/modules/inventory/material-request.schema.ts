import { z } from "zod";

export const MATERIAL_REQUEST_TYPES = ["PRODUCTION_REQUIREMENT", "DAMAGE_REPLACEMENT", "SAMPLING_REQUIREMENT"] as const;

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

// Shared by both create and update — only the `lines` constraint and the
// DAMAGE_REPLACEMENT refine differ between them (see below), so the header
// fields themselves live in one place rather than being duplicated twice.
const materialRequestBaseSchema = z.object({
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
  // Nullable traceability to the SampleVersion this requirement was
  // generated from (requestType = SAMPLING_REQUIREMENT) — same shape as
  // bomId above, populated only by createMaterialRequestFromSampleVersion.
  sampleVersionId: z.string().uuid().optional().or(z.literal("")),
  remarks: z.string().max(1000).optional().or(z.literal("")),
});

const damageReplacementRefineOptions = {
  message: "A Damage Replacement request requires the original request and a damage reason on every line.",
  // Not `as const` — Zod's refine `path` option wants a mutable
  // PropertyKey[], which a readonly tuple isn't assignable to.
  path: ["originalMaterialRequestId"],
};

export const materialRequestSchema = materialRequestBaseSchema
  .extend({ lines: z.array(materialRequestItemSchema).min(1, "At least one line item is required") })
  .refine(
    (input) =>
      input.requestType !== "DAMAGE_REPLACEMENT" ||
      (!!input.originalMaterialRequestId && input.lines.every((line) => !!line.damageReason)),
    damageReplacementRefineOptions
  );
export type MaterialRequestInput = z.infer<typeof materialRequestSchema>;

// Same header shape as create, but `lines` here represents only the
// request's still-unlocked lines (see material-request.repository.ts's
// UNLOCKED_LINE_WHERE/replaceLines) — a line that's already had stock
// issued or a shortfall escalated to a Purchase Order is preserved
// untouched server-side and never appears in this array at all, so unlike
// create, an empty array is a valid submission here (e.g. removing the one
// remaining unlocked line on a request that already has other, locked
// lines). The service itself still rejects if the FINAL total (locked +
// submitted) would be zero — see updateMaterialRequestLines.
export const updateMaterialRequestSchema = materialRequestBaseSchema
  .extend({ lines: z.array(materialRequestItemSchema) })
  .refine(
    (input) =>
      input.requestType !== "DAMAGE_REPLACEMENT" ||
      (!!input.originalMaterialRequestId && input.lines.every((line) => !!line.damageReason)),
    damageReplacementRefineOptions
  );
export type UpdateMaterialRequestInput = z.infer<typeof updateMaterialRequestSchema>;

export const materialRequestStatusChangeSchema = z.object({
  status: z.enum(["ON_HOLD", "CANCELLED"]),
});
export type MaterialRequestStatusChangeInput = z.infer<typeof materialRequestStatusChangeSchema>;

export const issueMaterialRequestLineSchema = z.object({
  issueQuantity: z.coerce.number().positive("Quantity must be greater than 0"),
  // Which room/section within the request's own warehouse this issue is
  // physically picked from — traceability only (see
  // MaterialRequestItem.warehouseLocationId's own schema comment). Picked at
  // issue time by whoever actually pulls the stock, not at request-creation
  // time by the requester.
  warehouseLocationId: z.string().uuid().optional().or(z.literal("")),
  // Which specific FabricRoll (i.e. which physical color/shade) to draw
  // this issue from — only ever offered for FABRIC-category materials, and
  // only when the warehouse actually has roll-level stock to pick from.
  // Optional: a non-fabric line, or a fabric line issued without picking a
  // specific roll, falls back to the material's flat StockBalance total
  // exactly as before this field existed.
  fabricRollId: z.string().uuid().optional().or(z.literal("")),
  // Manual "issue extra" override (2026-09-15) — only meaningful, and only
  // ever honored server-side, for SAMPLING_REQUIREMENT lines where the
  // issued quantity genuinely exceeds what remains; the service throws a
  // clean VALIDATION_ERROR if this is required but omitted.
  extraReason: z.string().max(500).optional().or(z.literal("")),
  // An explicit alternate warehouse to physically issue from (2026-09-16) —
  // the Issue modal's own "Change Warehouse" picker, offered only when the
  // request's own warehouse has nothing. Defaults to the request's own
  // warehouse when omitted.
  issueWarehouseId: z.string().uuid().optional().or(z.literal("")),
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
        // Required — previously absent, which let generatePurchaseOrdersForShortfall()
        // silently hardcode unitPrice to 0 on the resulting PurchaseOrderItem. Same
        // validation as the real PO creation path's purchaseOrderItemSchema (see
        // purchase-order.schema.ts) so this escalation path can't be laxer or
        // stricter than direct PO creation.
        unitPrice: z.coerce.number().min(0, "Unit price cannot be negative"),
      })
    )
    .min(1, "Select at least one line to purchase"),
  expectedDeliveryDate: z.string().optional().or(z.literal("")),
});
export type GeneratePurchaseOrdersForShortfallInput = z.infer<typeof generatePurchaseOrdersForShortfallSchema>;

// Powers the "Generate Material Request" action on a Sample Version's own
// materials list in Sampling — mirrors createMaterialRequestFromShortfallSchema's
// shape (warehouse + an override for the same soft duplicate-warning pattern),
// but scoped to one version's whole material list rather than a selected
// subset, since a version's materials are a small, deliberately-curated set
// already (see createMaterialRequestFromSampleVersion).
export const createMaterialRequestFromSampleVersionSchema = z.object({
  warehouseId: z.string().uuid("Warehouse is required"),
  overrideDuplicateCheck: z.boolean().optional(),
});
export type CreateMaterialRequestFromSampleVersionInput = z.infer<typeof createMaterialRequestFromSampleVersionSchema>;
