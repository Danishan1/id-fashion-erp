import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import { PermissionService } from "@/core/rbac/PermissionService";
import type { ListQuery } from "@/lib/list-query";
import { branchScopeWhere } from "@/lib/branch-access";
import { convertUomQuantity } from "@/lib/uom-conversion";
import { BomRepository } from "@/modules/bom-mrp/bom.repository";
import { getMaterialRequirementForOrderLine } from "@/modules/bom-mrp/mrp.service";
import { createMaterialRequest } from "@/modules/inventory/material-request.service";
import { ProductRepository } from "@/modules/products/product.repository";
import { ProductionOrderStatus, type Prisma } from "@prisma/client";
import { LotRepository, ProductionOrderRepository } from "./production.repository";
import { getProductionOrderProgress } from "./production-progress.service";
import { materialRequestScopeForOrder } from "./material-request-scope";
import type { AddExtraProductionQuantityInput, CreateProductionOrderInput, GenerateMaterialRequestInput } from "./production.schema";

const EPSILON = 0.0001;

export interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

/**
 * ProductionOrder.status is a small, genuinely fixed set — the existing
 * ALLOWED_TRANSITIONS idiom fits it fine (unlike a Lot's stage position,
 * which is a runtime graph — see job-order.service.ts). CLOSED is reachable
 * only through closeProductionOrder(), never this generic map, since it
 * carries its own "every lot must be done" business rule.
 */
const ALLOWED_TRANSITIONS: Record<ProductionOrderStatus, ProductionOrderStatus[]> = {
  PLANNED: ["ON_HOLD", "CANCELLED"],
  MATERIAL_ALLOCATED: ["ON_HOLD", "CANCELLED"],
  IN_PROGRESS: ["ON_HOLD", "CANCELLED"],
  ON_HOLD: ["CANCELLED"],
  CANCELLED: [],
  CLOSED: [],
};

/** Blocks cancellation once any Lot has real activity, checked directly
 * against Lot status — never inferred from the order's own status label
 * (the same lesson this project has learned repeatedly: Sampling's
 * Hold/Resume bug, Purchasing's cancel-from-ON_HOLD bug, Material Request's
 * real-state guards). */
async function assertNoActiveLots(productionOrderId: string, action: string) {
  const lots = await LotRepository.findByProductionOrderId(productionOrderId);
  const active = lots.filter((lot) => lot.status !== "PLANNED" && lot.status !== "CANCELLED");
  if (active.length > 0) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot ${action} — ${active.length} lot(s) already have real production activity.`,
      { activeLotCount: active.length }
    );
  }
}

export interface SalesOrderLineCommitment {
  orderedTotal: number;
  /** Sum of every OTHER non-cancelled Production Order's plannedQuantity
   * already committed against this exact Sales Order line — excludes
   * excludeProductionOrderId so a Production Order reading its own context
   * doesn't count itself. */
  otherCommitted: number;
  remaining: number;
}

/**
 * Purely informational — Production Order quantity is deliberately NOT
 * capped to a Sales Order line's ordered quantity (a business may
 * legitimately plan more, for future demand/replacements, or less, for
 * capacity constraints). Both createProductionOrder (post-creation context)
 * and the create form's live preview (pre-creation, via the dedicated GET
 * route below) call this same function so the numbers can never disagree.
 */
export async function getSalesOrderLineCommitment(
  companyId: string,
  salesOrderItemId: string,
  excludeProductionOrderId?: string
): Promise<SalesOrderLineCommitment> {
  const item = await prisma.salesOrderItem.findFirst({
    where: { id: salesOrderItemId, salesOrder: { companyId } },
    include: { breakdown: true },
  });
  if (!item) throw new BusinessRuleError("NOT_FOUND", "Sales order line not found.", { id: salesOrderItemId });

  const orderedTotal = item.breakdown.reduce((sum, b) => sum + b.orderedQuantity, 0);
  const committedAgg = await prisma.productionOrder.aggregate({
    where: {
      salesOrderItemId,
      status: { not: "CANCELLED" },
      ...(excludeProductionOrderId ? { id: { not: excludeProductionOrderId } } : {}),
    },
    _sum: { plannedQuantity: true },
  });
  const otherCommitted = Number(committedAgg._sum.plannedQuantity ?? 0);

  return { orderedTotal, otherCommitted, remaining: orderedTotal - otherCommitted };
}

const VALID_PRODUCTION_ORDER_STATUSES = new Set<string>(Object.values(ProductionOrderStatus));

export async function listProductionOrders(actor: { companyId: string; userId: string }, query: ListQuery) {
  const allowedBranchIds = await PermissionService.getAllowedBranchIds(actor.userId);
  const where: Prisma.ProductionOrderWhereInput = {
    companyId: actor.companyId,
    ...branchScopeWhere(allowedBranchIds),
    ...(query.search ? { orderNumber: { contains: query.search, mode: "insensitive" as const } } : {}),
    ...(query.status && VALID_PRODUCTION_ORDER_STATUSES.has(query.status)
      ? { status: query.status as ProductionOrderStatus }
      : {}),
  };

  const [data, totalCount] = await Promise.all([
    ProductionOrderRepository.findMany(where, {
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
    }),
    ProductionOrderRepository.count(where),
  ]);

  return { data, totalCount };
}

/** A branch-restricted user gets NOT_FOUND for an order outside their allowed branches — same "deny as not-found" convention used across this app. */
export async function getProductionOrderById(actor: { companyId: string; userId: string }, id: string) {
  const order = await ProductionOrderRepository.findByIdWithDetails(actor.companyId, id);
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Production order not found.", { id });

  const allowedBranchIds = await PermissionService.getAllowedBranchIds(actor.userId);
  if (allowedBranchIds !== null && (!order.branchId || !allowedBranchIds.has(order.branchId))) {
    throw new BusinessRuleError("NOT_FOUND", "Production order not found.", { id });
  }

  const salesOrderContext = order.salesOrderItemId
    ? await getSalesOrderLineCommitment(actor.companyId, order.salesOrderItemId, id)
    : null;
  const progress = await getProductionOrderProgress(actor.companyId, id);
  const quantityChanges = await prisma.productionOrderQuantityChange.findMany({
    where: { productionOrderId: id, companyId: actor.companyId },
    orderBy: { createdAt: "asc" },
    include: { createdBy: { select: { fullName: true } } },
  });

  return { ...order, salesOrderContext, progress, quantityChanges };
}

export async function createProductionOrder(actor: ActorContext, input: CreateProductionOrderInput) {
  const product = await ProductRepository.findStyleById(actor.companyId, input.productId);
  if (!product) throw new BusinessRuleError("NOT_FOUND", "Style not found.", { id: input.productId });

  // Informational only, never enforced — a Production Order's quantity is
  // deliberately NOT capped to what the linked Sales Order line actually
  // ordered. A business may legitimately plan more (future demand,
  // replacements) or less (capacity constraints) than what was ordered; this
  // context is returned so the UI can show it, never to block creation.
  let salesOrderContext: SalesOrderLineCommitment | null = null;
  if (input.salesOrderItemId) {
    // One Sales Order line keeps ONE Production Order (2026-09-29). More
    // quantity for the same line is added to the existing order via
    // addExtraProductionQuantity — never a silent second, duplicate order.
    const existing = await findActiveProductionOrderForSalesOrderItem(actor.companyId, input.salesOrderItemId);
    if (existing) {
      throw new BusinessRuleError(
        "PRODUCTION_ORDER_EXISTS",
        `A production order (${existing.orderNumber}) has already been created for this Sale Order. Add extra quantity to it instead of creating another production order.`,
        { existingProductionOrderId: existing.id, existingOrderNumber: existing.orderNumber }
      );
    }
    salesOrderContext = await getSalesOrderLineCommitment(actor.companyId, input.salesOrderItemId);
  }

  // Snapshot pointer to the Bom header only (not a specific BomVersion) —
  // the real "which version was actually in effect" gate lives at material-
  // requirement-generation time, see generateMaterialRequestForOrder below,
  // which reads bom.approvedVersion specifically.
  const bom = await BomRepository.findByProductId(actor.companyId, input.productId);

  const orderNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    documentType: "PRODUCTION_ORDER",
  });

  const order = await ProductionOrderRepository.create({
    companyId: actor.companyId,
    branchId: actor.branchId || null,
    orderNumber,
    salesOrderItemId: input.salesOrderItemId || null,
    productId: input.productId,
    bomId: bom?.id ?? null,
    plannedQuantity: input.plannedQuantity,
    status: "PLANNED",
    priority: input.priority,
    plannedStartDate: input.plannedStartDate ? new Date(input.plannedStartDate) : null,
    plannedEndDate: input.plannedEndDate ? new Date(input.plannedEndDate) : null,
    remarks: input.remarks || null,
    requestedByUserId: actor.userId,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "production_orders",
    recordId: order.id,
    action: "CREATE",
    newValues: { orderNumber: order.orderNumber, productId: input.productId, plannedQuantity: input.plannedQuantity },
  });

  return { ...order, salesOrderContext };
}

/**
 * Explodes this order's material source (quantityPerUnit * (1 + wastage%) *
 * plannedQuantity per material, converted to each material's own base UOM)
 * and raises a real MaterialRequest for whatever's short — reuses
 * createMaterialRequest() unchanged, exactly the pattern BOM/MRP's own
 * "Generate Material Request" button already established. Per the user's own
 * explicit rule, the source is resolved by getMaterialRequirementForOrderLine:
 * the linked Sample's own material list when this order's Sales Order Item
 * has one, otherwise the Style's own real, approved BOM — the same
 * resolution the create/edit form's live preview uses, so a shortfall/cost
 * figure a user previews can never disagree with what this actually raises.
 * A BomItem/SampleMaterial's colorId is informational only here (Production
 * Order carries no color/size breakdown of its own) — every line applies to
 * the full plannedQuantity regardless of colorId, a deliberate V1
 * simplification.
 */
export async function generateMaterialRequestForOrder(actor: ActorContext, id: string, input: GenerateMaterialRequestInput) {
  const order = await ProductionOrderRepository.findAnyById(actor.companyId, id);
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Production order not found.", { id });

  const requirement = await getMaterialRequirementForOrderLine(actor.companyId, {
    salesOrderItemId: order.salesOrderItemId,
    productId: order.productId,
    quantity: Number(order.plannedQuantity),
  });
  if (!requirement.hasApprovedBom) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      requirement.sampleRequestId
        ? "The linked sample has no materials recorded yet — record its material usage first."
        : "This style has no approved BOM — an unapproved draft can't be used to plan material requirements. Approve a BOM version first.",
      { id }
    );
  }

  if (requirement.materials.length === 0 && requirement.unconvertibleLines.length > 0) {
    const first = requirement.unconvertibleLines[0];
    throw new BusinessRuleError(
      "UOM_CONVERSION_UNAVAILABLE",
      `Cannot calculate the material requirement: ${first.materialName} — ${first.reason}. Fix the unit on the BOM line or the material's base unit.`,
      { unconvertibleLines: requirement.unconvertibleLines }
    );
  }

  // Requests the FULL need minus what this order has already requested
  // (2026-09-29). A Material Request is the internal "production needs this"
  // document — the store then issues it from stock, and only a genuine stock
  // shortage escalates to a Purchase Order. Previously this raised lines only
  // for materials short in stock, so a fully-stocked material could never be
  // requested (and so never issued) — which the lot material gate now needs.
  const alreadyRequested = await sumRequestedByMaterialForOrder(actor.companyId, id, order.salesOrderItemId);
  const lines = requirement.materials
    .map((m) => ({
      materialId: m.materialId,
      uomId: m.uomId,
      requestedQuantity: Math.round((m.neededQuantity - (alreadyRequested.get(m.materialId) ?? 0)) * 10000) / 10000,
    }))
    .filter((l) => l.requestedQuantity > EPSILON);

  if (lines.length === 0) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "Material requests for this production order already cover everything it needs. Issue the requested material from the store.",
      {}
    );
  }

  return createMaterialRequest(actor, {
    requestType: "PRODUCTION_REQUIREMENT",
    warehouseId: input.warehouseId,
    productionOrderId: id,
    // null (never a real Bom row) whenever this requirement was sourced from
    // a linked Sample instead of the Style's own real BOM.
    bomId: requirement.bomId ?? undefined,
    lines,
  });
}

/** Everything already requested for this order (non-cancelled requests), per material, in its base unit. */
async function sumRequestedByMaterialForOrder(companyId: string, productionOrderId: string, salesOrderItemId: string | null) {
  const scope = await materialRequestScopeForOrder(companyId, productionOrderId, salesOrderItemId);
  const lines = await prisma.materialRequestItem.findMany({
    where: { materialRequest: { ...scope, status: { not: "CANCELLED" } } },
    select: {
      materialId: true,
      requestedQuantity: true,
      uom: { select: { id: true, baseUnitId: true, conversionFactor: true } },
      material: { select: { baseUom: { select: { id: true, baseUnitId: true, conversionFactor: true } } } },
    },
  });
  const byMaterial = new Map<string, number>();
  for (const line of lines) {
    const base = line.material.baseUom;
    const qty = base ? convertUomQuantity(Number(line.requestedQuantity), line.uom, base) ?? 0 : Number(line.requestedQuantity);
    byMaterial.set(line.materialId, (byMaterial.get(line.materialId) ?? 0) + qty);
  }
  return byMaterial;
}

export interface ProductionOrderMaterialComparisonRow {
  materialId: string;
  materialName: string;
  materialCode: string;
  uomCode: string;
  /** From this order's own Effective BOM (getMaterialRequirementForOrderLine
   * — already Sales-Order-Line-snapshot-and-override-aware, see
   * bom-mrp/effective-bom.service.ts). Zero for a material that was never
   * planned at all — a substitute issued in place of something else. */
  plannedQuantity: number;
  /** Real, physically-posted InventoryTransaction movement for this exact
   * material against this order's own linked Material Requests — never
   * re-derived from the plan, the actual ledger. */
  issuedQuantity: number;
  /** True when this material never appears in the Effective BOM at all —
   * it only shows up here because it was actually issued (a Material
   * Substitution's own substituteMaterialId). */
  isSubstitute: boolean;
}

/**
 * Production — Planned vs Issued material (2026-09-24, Phase 8). Planned
 * material is this order's own Effective BOM (never the bare Style Master
 * BOM once a Sales Order snapshot/override exists — the same resolver every
 * other planning surface in this app already uses). Issued material is the
 * real InventoryTransaction ledger — summed by productId across every
 * MATERIAL_ISSUE row referencing one of this order's own linked Material
 * Requests, regardless of whether that material was the original planned
 * one or a Material Substitution's own substitute — the InventoryTransaction
 * itself is what actually happened, never re-derived from the plan or from
 * MaterialSubstitution's own audit trail (which is a workflow/traceability
 * pointer to the ledger, not a second ledger). A material appearing here
 * with plannedQuantity 0 is exactly a substitute the Effective BOM never
 * called for — per the spec's own worked example, this view must never
 * silently collapse a substitute's real issued quantity into the original
 * material's row, or pretend the plan changed just because a substitute was
 * physically issued.
 *
 * "Consumed" (a further distinction from "Issued" once unused material is
 * returned to store) is deliberately NOT built in this pass — no
 * return-to-store/consumption-tracking mechanism exists anywhere else in
 * this codebase for material already issued to production (confirmed:
 * InventoryTransactionType has no such value), and inventing one here would
 * be new schema/scope beyond this phase's own literal name ("Production
 * Planned vs Issued material view").
 */
export async function getProductionOrderMaterialComparison(companyId: string, id: string): Promise<ProductionOrderMaterialComparisonRow[]> {
  const order = await ProductionOrderRepository.findAnyById(companyId, id);
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Production order not found.", { id });

  const requirement = await getMaterialRequirementForOrderLine(companyId, {
    salesOrderItemId: order.salesOrderItemId,
    productId: order.productId,
    quantity: Number(order.plannedQuantity),
  });

  const rows = new Map<string, ProductionOrderMaterialComparisonRow>();
  for (const m of requirement.materials) {
    rows.set(m.materialId, {
      materialId: m.materialId,
      materialName: m.materialName,
      materialCode: m.materialCode,
      uomCode: m.uomCode,
      plannedQuantity: m.neededQuantity,
      issuedQuantity: 0,
      isSubstitute: false,
    });
  }

  const linkedRequestItemIds = (
    await prisma.materialRequestItem.findMany({
      where: { materialRequest: await materialRequestScopeForOrder(companyId, id, order.salesOrderItemId) },
      select: { id: true },
    })
  ).map((i) => i.id);

  if (linkedRequestItemIds.length > 0) {
    const issued = await prisma.inventoryTransaction.groupBy({
      by: ["productId"],
      where: { companyId, referenceModule: "MATERIAL_REQUEST", referenceRecordId: { in: linkedRequestItemIds }, transactionType: "MATERIAL_ISSUE" },
      _sum: { quantity: true },
    });

    const issuedMaterialIds = issued.map((i) => i.productId).filter((pid) => !rows.has(pid));
    const missingMaterials =
      issuedMaterialIds.length > 0
        ? await prisma.product.findMany({
            where: { id: { in: issuedMaterialIds } },
            select: { id: true, styleName: true, styleCode: true, baseUom: { select: { code: true } } },
          })
        : [];
    const missingById = new Map(missingMaterials.map((m) => [m.id, m]));

    for (const entry of issued) {
      // MATERIAL_ISSUE is always posted negative — flip to a positive
      // "amount issued" for display, matching how the rest of this view
      // reads (Planned/Issued both non-negative quantities).
      const quantity = -Number(entry._sum.quantity ?? 0);
      const existing = rows.get(entry.productId);
      if (existing) {
        existing.issuedQuantity = quantity;
      } else {
        const material = missingById.get(entry.productId);
        rows.set(entry.productId, {
          materialId: entry.productId,
          materialName: material?.styleName ?? "Unknown material",
          materialCode: material?.styleCode ?? "",
          uomCode: material?.baseUom?.code ?? "",
          plannedQuantity: 0,
          issuedQuantity: quantity,
          isSubstitute: true,
        });
      }
    }
  }

  return [...rows.values()].sort((a, b) => a.materialName.localeCompare(b.materialName));
}

/**
 * The one place plannedQuantity can change after creation — a Production
 * Order's quantity is deliberately editable (up or down, independent of what
 * the linked Sales Order actually ordered), but only before any real
 * production activity exists: once a Lot has been raised, its own quantity
 * and every JobOrder/Material Request already derived from the order's
 * original plannedQuantity would silently go stale against a later change.
 * Same "lock once real activity exists" discipline as assertNoActiveLots
 * above and this project's other real-state guards (Material Request's
 * nothing-issued-yet edit guard, Sales Order's edit-blocked-once-dispatch
 * guard) — checked directly against real Lot rows, never inferred from the
 * order's own status label.
 */
export async function updateProductionOrderQuantity(actor: ActorContext, id: string, plannedQuantity: number) {
  const before = await ProductionOrderRepository.findAnyById(actor.companyId, id);
  if (!before) throw new BusinessRuleError("NOT_FOUND", "Production order not found.", { id });

  if (before.status !== "PLANNED" && before.status !== "MATERIAL_ALLOCATED") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot change quantity — this production order is "${before.status}".`,
      { currentStatus: before.status }
    );
  }

  const lots = await LotRepository.findByProductionOrderId(id);
  if (lots.length > 0) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot change quantity — ${lots.length} lot(s) already exist for this production order.`,
      { lotCount: lots.length }
    );
  }

  const updated = await ProductionOrderRepository.update(id, { plannedQuantity });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "production_orders",
    recordId: id,
    action: "UPDATE",
    oldValues: { plannedQuantity: before.plannedQuantity.toString() },
    newValues: { plannedQuantity },
  });

  return updated;
}

/** The non-cancelled Production Order already raised for a Sales Order line, if any (oldest first). */
export async function findActiveProductionOrderForSalesOrderItem(companyId: string, salesOrderItemId: string) {
  return prisma.productionOrder.findFirst({
    where: { companyId, salesOrderItemId, status: { not: "CANCELLED" } },
    orderBy: { createdAt: "asc" },
    select: { id: true, orderNumber: true, status: true, plannedQuantity: true },
  });
}

/**
 * Extra production (2026-09-29): adds quantity to an order that already has
 * lots, instead of raising a second Production Order for the same Sales
 * Order line. Allowed only once everything already planned has been fully
 * processed — produced + rejected/damaged ≥ planned — so extra is never
 * stacked on top of work still in the pipeline. A CLOSED order is reopened
 * (back to IN_PROGRESS) since new lots are about to be raised on it. Every
 * addition is kept in production_order_quantity_changes.
 */
export async function addExtraProductionQuantity(actor: ActorContext, id: string, input: AddExtraProductionQuantityInput) {
  const order = await ProductionOrderRepository.findAnyById(actor.companyId, id);
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Production order not found.", { id });

  if (order.status === "CANCELLED") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Cannot add extra quantity to a cancelled production order.", {
      currentStatus: order.status,
    });
  }
  if (order.status === "ON_HOLD") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Resume the production order before adding extra quantity.", {
      currentStatus: order.status,
    });
  }

  const progress = await getProductionOrderProgress(actor.companyId, id);
  const assigned = progress.plannedQuantity;
  const processed = progress.producedQuantity + progress.rejectedQuantity;
  if (processed + EPSILON < assigned) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Completed quantity is not equal to assigned quantity. Extra production cannot be created until the assigned quantity is completed. Assigned: ${assigned}, completed: ${progress.producedQuantity}${
        progress.rejectedQuantity > 0 ? `, rejected/damaged: ${progress.rejectedQuantity}` : ""
      }.`,
      { assigned, completed: progress.producedQuantity, rejected: progress.rejectedQuantity }
    );
  }

  const previousQuantity = Number(order.plannedQuantity);
  const newQuantity = previousQuantity + input.extraQuantity;

  const change = await prisma.$transaction(async (tx) => {
    // Guarded on the value just read, so two concurrent "add extra" clicks
    // can't both apply against the same starting quantity.
    const guard = await tx.productionOrder.updateMany({
      where: { id, companyId: actor.companyId, plannedQuantity: order.plannedQuantity },
      data: {
        plannedQuantity: newQuantity,
        ...(order.status === "CLOSED" ? { status: "IN_PROGRESS" as const, actualEndDate: null } : {}),
      },
    });
    if (guard.count === 0) {
      throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This production order was just changed by someone else — reload and try again.", {});
    }
    return tx.productionOrderQuantityChange.create({
      data: {
        companyId: actor.companyId,
        productionOrderId: id,
        changeType: "EXTRA_PRODUCTION",
        previousQuantity,
        addedQuantity: input.extraQuantity,
        newQuantity,
        reason: input.reason || null,
        createdByUserId: actor.userId,
      },
    });
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "production_orders",
    recordId: id,
    action: "UPDATE",
    oldValues: { plannedQuantity: previousQuantity, status: order.status },
    newValues: {
      event: "EXTRA_PRODUCTION_CREATED",
      plannedQuantity: newQuantity,
      extraQuantity: input.extraQuantity,
      reason: input.reason || null,
      ...(order.status === "CLOSED" ? { status: "IN_PROGRESS" } : {}),
    },
  });

  return change;
}

export async function transitionProductionOrderStatus(actor: ActorContext, id: string, targetStatus: ProductionOrderStatus) {
  const before = await ProductionOrderRepository.findAnyById(actor.companyId, id);
  if (!before) throw new BusinessRuleError("NOT_FOUND", "Production order not found.", { id });

  const allowed = ALLOWED_TRANSITIONS[before.status] ?? [];
  if (!allowed.includes(targetStatus)) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot move a production order from "${before.status}" to "${targetStatus}".`,
      { from: before.status, to: targetStatus }
    );
  }

  if (targetStatus === "CANCELLED") {
    await assertNoActiveLots(id, "cancel this production order");
  }

  const data: Prisma.ProductionOrderUncheckedUpdateInput = { status: targetStatus };
  if (targetStatus === "ON_HOLD") data.statusBeforeHold = before.status;

  const updated = await ProductionOrderRepository.update(id, data);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "production_orders",
    recordId: id,
    action: targetStatus === "CANCELLED" ? "CANCEL" : "UPDATE",
    oldValues: { status: before.status },
    newValues: { status: targetStatus },
  });

  return updated;
}

export async function resumeProductionOrderFromHold(actor: ActorContext, id: string) {
  const before = await ProductionOrderRepository.findAnyById(actor.companyId, id);
  if (!before) throw new BusinessRuleError("NOT_FOUND", "Production order not found.", { id });

  if (before.status !== "ON_HOLD" || !before.statusBeforeHold) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This production order isn't on hold.", { currentStatus: before.status });
  }

  const updated = await ProductionOrderRepository.update(id, { status: before.statusBeforeHold, statusBeforeHold: null });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "production_orders",
    recordId: id,
    action: "UPDATE",
    oldValues: { status: "ON_HOLD" },
    newValues: { status: before.statusBeforeHold },
  });

  return updated;
}

/** Only reachable once every lot is COMPLETED or CANCELLED — never through
 * the generic status-change endpoint, same discipline as every other
 * terminal-state action in this project. */
export async function closeProductionOrder(actor: ActorContext, id: string) {
  const order = await ProductionOrderRepository.findAnyById(actor.companyId, id);
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Production order not found.", { id });

  if (order.status === "CLOSED" || order.status === "CANCELLED") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Cannot close a production order in "${order.status}" status.`, {
      currentStatus: order.status,
    });
  }

  const lots = await LotRepository.findByProductionOrderId(id);
  const unfinished = lots.filter((lot) => lot.status !== "COMPLETED" && lot.status !== "CANCELLED");
  if (unfinished.length > 0) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Cannot close — ${unfinished.length} lot(s) are not yet completed.`, {
      unfinishedLotCount: unfinished.length,
    });
  }

  // The filter above is vacuously satisfied when zero lots were ever raised
  // (or when every lot was CANCELLED) — without this check, a production
  // order could be closed having produced nothing at all.
  const completedLots = lots.filter((lot) => lot.status === "COMPLETED");
  if (completedLots.length === 0) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Cannot close: no production has been completed on this order yet.", {
      lotCount: lots.length,
    });
  }

  const updated = await ProductionOrderRepository.update(id, { status: "CLOSED", actualEndDate: new Date() });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "production_orders",
    recordId: id,
    action: "UPDATE",
    oldValues: { status: order.status },
    newValues: { status: "CLOSED" },
  });

  return updated;
}
