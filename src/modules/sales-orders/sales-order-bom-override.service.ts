import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { ProductRepository } from "@/modules/products/product.repository";
import type { ProposeSalesOrderBomOverrideInput } from "./sales-order-bom-override.schema";
import { SalesOrderBomOverrideRepository, SalesOrderLineRepository } from "./sales-order-bom.repository";
import { resolveSnapshotSource } from "./sales-order-bom.service";

interface ActorContext {
  companyId: string;
  userId: string;
}

async function assertLineAccessible(actor: ActorContext, salesOrderLineId: string) {
  const line = await SalesOrderLineRepository.findByIdWithOrder(actor.companyId, salesOrderLineId);
  if (!line) throw new BusinessRuleError("NOT_FOUND", "Sales order line not found.", { id: salesOrderLineId });
  if (line.salesOrder.status === "CANCELLED") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Cannot change the BOM for a line on a cancelled Sales Order.", { salesOrderLineId });
  }
  return line;
}

/** Every override ever recorded for a line, active and deactivated alike —
 * the historical record is the point, never hidden once retired. */
export async function listSalesOrderLineOverrides(actor: ActorContext, salesOrderLineId: string) {
  await PermissionService.assert(actor.userId, "sales_orders", "view");
  await assertLineAccessible(actor, salesOrderLineId);
  return SalesOrderBomOverrideRepository.findManyForLine(salesOrderLineId);
}

/**
 * Records a deliberate, customer/buyer-driven Sales-Order-specific BOM
 * change on top of the line's own frozen snapshot — never overwrites the
 * snapshot itself, never touches the Style's real Bom/BomItem rows (both
 * remain exactly what they were, for every other order/style that still
 * relies on them). Gated on `sales_orders`/`edit` — the same permission
 * editing the order's own fields already requires; per the schema's own
 * documented decision, this is a deliberate, authorized customization
 * decision (reason + remarks + who/when IS the audit trail), not a stock-
 * driven, unplanned event needing Material Substitution's two-step
 * maker/checker flow.
 */
export async function proposeSalesOrderBomOverride(actor: ActorContext, salesOrderLineId: string, input: ProposeSalesOrderBomOverrideInput) {
  await PermissionService.assert(actor.userId, "sales_orders", "edit");
  await assertLineAccessible(actor, salesOrderLineId);

  if (input.originalMaterialId) {
    const material = await ProductRepository.findMaterialById(actor.companyId, input.originalMaterialId);
    if (!material) {
      throw new BusinessRuleError("NOT_FOUND", "The material this override targets was not found.", { materialId: input.originalMaterialId });
    }
  }
  if (input.effectiveMaterialId) {
    const material = await ProductRepository.findMaterialById(actor.companyId, input.effectiveMaterialId);
    if (!material) {
      throw new BusinessRuleError("NOT_FOUND", "The replacement/added material was not found.", { materialId: input.effectiveMaterialId });
    }
  }

  const override = await SalesOrderBomOverrideRepository.create({
    companyId: actor.companyId,
    salesOrderLineId,
    originalMaterialId: input.originalMaterialId,
    effectiveMaterialId: input.effectiveMaterialId,
    effectiveQuantityPerUnit: input.effectiveQuantityPerUnit,
    wastagePercentage: input.wastagePercentage,
    colorId: input.colorId,
    uomId: input.uomId,
    reason: input.reason,
    remarks: input.remarks ?? null,
    changedByUserId: actor.userId,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "sales_order_bom_overrides",
    recordId: override.id,
    action: "CREATE",
    newValues: {
      salesOrderLineId,
      originalMaterialId: input.originalMaterialId,
      effectiveMaterialId: input.effectiveMaterialId,
      effectiveQuantityPerUnit: input.effectiveQuantityPerUnit,
      wastagePercentage: input.wastagePercentage,
      reason: input.reason,
    },
  });

  return override;
}

/**
 * Soft-retires one override — never a hard delete, so the full "what did we
 * change and why" history stays inspectable even once superseded. Applying
 * an override is purely a function of `isActive` at resolution time (see
 * effective-bom.service.ts), so deactivating one here takes effect on the
 * very next Effective BOM read with no further step needed.
 */
export async function deactivateSalesOrderBomOverride(actor: ActorContext, overrideId: string) {
  await PermissionService.assert(actor.userId, "sales_orders", "edit");

  const existing = await SalesOrderBomOverrideRepository.findById(actor.companyId, overrideId);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Override not found.", { id: overrideId });
  await assertLineAccessible(actor, existing.salesOrderLineId);
  if (!existing.isActive) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This override has already been deactivated.", { id: overrideId });
  }

  const updated = await SalesOrderBomOverrideRepository.deactivate(overrideId, actor.userId);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "sales_order_bom_overrides",
    recordId: overrideId,
    action: "UPDATE",
    oldValues: { isActive: true },
    newValues: { isActive: false },
  });

  return updated;
}

/**
 * The explicit "Revise / Refresh BOM" action — the ONLY way an already-
 * confirmed Sales Order Line's own frozen snapshot ever moves onto a newer
 * BomVersion/SampleVersion once captured. Per the user's own explicit
 * correction, an ordinary edit (quantity/price/delivery date/remarks) must
 * NEVER silently do this — updateSalesOrder()'s own reuse path (see
 * sales-order-bom.service.ts) never calls this function at all.
 *
 * Active overrides on the line are deliberately left untouched by a refresh:
 * a Replace/Quantity-change override whose originalMaterialId no longer
 * matches anything in the refreshed base becomes a safe no-op at resolution
 * time (applyBomOverrides' own defensive findIndex in effective-bom.service.ts),
 * never a crash; a pure-Addition override (originalMaterialId null) still
 * applies regardless of what the base now is. A user should review a line's
 * overrides after refreshing its BOM, but nothing here forces that — a
 * deliberate MVP choice, not an oversight.
 */
export async function refreshSalesOrderLineBomSnapshot(actor: ActorContext, salesOrderLineId: string) {
  await PermissionService.assert(actor.userId, "sales_orders", "edit");

  const line = await assertLineAccessible(actor, salesOrderLineId);
  const currentItem = line.items[0];
  if (!currentItem) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This line has no active item to refresh a BOM snapshot for.", { salesOrderLineId });
  }

  const source = await resolveSnapshotSource(actor.companyId, {
    productId: currentItem.productId,
    sampleRequestId: currentItem.sampleRequestId,
  });

  const before = { sourceType: line.sourceType, bomVersionId: line.bomVersionId, sampleVersionId: line.sampleVersionId };
  const updated = await SalesOrderLineRepository.updateSnapshot(salesOrderLineId, {
    sourceType: source.sourceType,
    bomVersionId: source.bomVersionId,
    sampleVersionId: source.sampleVersionId,
    snapshotTakenAt: new Date(),
    snapshotTakenByUserId: actor.userId,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "sales_order_lines",
    recordId: salesOrderLineId,
    action: "UPDATE",
    oldValues: before,
    newValues: { sourceType: source.sourceType, bomVersionId: source.bomVersionId, sampleVersionId: source.sampleVersionId },
  });

  return updated;
}
