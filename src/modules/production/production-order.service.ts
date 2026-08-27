import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import type { ListQuery } from "@/lib/list-query";
import { BomRepository } from "@/modules/bom-mrp/bom.repository";
import { sumAvailableByProductIds } from "@/modules/inventory/inventory.service";
import { createMaterialRequest } from "@/modules/inventory/material-request.service";
import { ProductRepository } from "@/modules/products/product.repository";
import type { Prisma, ProductionOrderStatus } from "@prisma/client";
import { LotRepository, ProductionOrderRepository } from "./production.repository";
import type { CreateProductionOrderInput, GenerateMaterialRequestInput } from "./production.schema";

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

export async function listProductionOrders(companyId: string, query: ListQuery) {
  const where: Prisma.ProductionOrderWhereInput = {
    companyId,
    ...(query.search ? { orderNumber: { contains: query.search, mode: "insensitive" as const } } : {}),
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

export async function getProductionOrderById(companyId: string, id: string) {
  const order = await ProductionOrderRepository.findByIdWithDetails(companyId, id);
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Production order not found.", { id });
  return order;
}

export async function createProductionOrder(actor: ActorContext, input: CreateProductionOrderInput) {
  const product = await ProductRepository.findStyleById(actor.companyId, input.productId);
  if (!product) throw new BusinessRuleError("NOT_FOUND", "Style not found.", { id: input.productId });

  if (input.salesOrderItemId) {
    const item = await prisma.salesOrderItem.findFirst({
      where: { id: input.salesOrderItemId, salesOrder: { companyId: actor.companyId } },
      include: { breakdown: true },
    });
    if (!item) throw new BusinessRuleError("NOT_FOUND", "Sales order line not found.", { id: input.salesOrderItemId });

    // Cap planned quantity against what the customer actually ordered on
    // this line — previously nothing checked this at all, so a Production
    // Order could plan arbitrarily more than the order (tying up material/
    // capacity for stock nobody ordered), and multiple Production Orders
    // could silently attach to the same line with no cross-check between
    // them. `committed` sums every other non-cancelled Production Order
    // already linked to this exact line.
    const orderedTotal = item.breakdown.reduce((sum, b) => sum + b.orderedQuantity, 0);
    const committedAgg = await prisma.productionOrder.aggregate({
      where: { salesOrderItemId: input.salesOrderItemId, status: { not: "CANCELLED" } },
      _sum: { plannedQuantity: true },
    });
    const committed = Number(committedAgg._sum.plannedQuantity ?? 0);
    const remaining = orderedTotal - committed;
    if (input.plannedQuantity > remaining + EPSILON) {
      throw new BusinessRuleError(
        "OVER_PRODUCTION_NOT_ALLOWED",
        `Cannot plan ${input.plannedQuantity} — only ${remaining} of the ${orderedTotal} ordered units on this Sales Order line remain unplanned (${committed} already committed to other Production Order(s)).`,
        { orderedTotal, committed, remaining }
      );
    }
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

  return order;
}

/**
 * Explodes this order's BOM (quantityPerUnit * (1 + wastage%) * plannedQuantity
 * per material) and raises a real MaterialRequest for whatever's short —
 * reuses createMaterialRequest() unchanged, exactly the pattern BOM/MRP's own
 * "Generate Material Request" button already established. A BomItem's
 * colorId is informational only here (Production Order carries no
 * color/size breakdown of its own) — every line applies to the full
 * plannedQuantity regardless of colorId, a deliberate V1 simplification.
 */
export async function generateMaterialRequestForOrder(actor: ActorContext, id: string, input: GenerateMaterialRequestInput) {
  const order = await ProductionOrderRepository.findAnyById(actor.companyId, id);
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Production order not found.", { id });

  const bom = await BomRepository.findByProductId(actor.companyId, order.productId);
  if (!bom?.approvedVersion || bom.approvedVersion.items.length === 0) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "This style has no approved BOM — an unapproved draft can't be used to plan material requirements. Approve a BOM version first.",
      { id }
    );
  }
  const approvedItems = bom.approvedVersion.items;

  const plannedQuantity = Number(order.plannedQuantity);
  const neededByMaterial = new Map<string, { uomId: string; needed: number }>();
  for (const item of approvedItems) {
    const effectiveQtyPerUnit = Number(item.quantityPerUnit) * (1 + Number(item.wastagePercentage) / 100);
    const needed = effectiveQtyPerUnit * plannedQuantity;
    const existing = neededByMaterial.get(item.materialId);
    if (existing) existing.needed += needed;
    else neededByMaterial.set(item.materialId, { uomId: item.uomId, needed });
  }

  const availableMap = await sumAvailableByProductIds(actor.companyId, [...neededByMaterial.keys()]);
  const lines = [...neededByMaterial.entries()]
    .map(([materialId, { uomId, needed }]) => ({
      materialId,
      uomId,
      requestedQuantity: Math.max(0, needed - (availableMap.get(materialId) ?? 0)),
    }))
    .filter((line) => line.requestedQuantity > 0);

  if (lines.length === 0) {
    throw new BusinessRuleError("VALIDATION_ERROR", "No shortfall — every required material is already available in stock.", {});
  }

  return createMaterialRequest(actor, {
    requestType: "PRODUCTION_REQUIREMENT",
    warehouseId: input.warehouseId,
    productionOrderId: id,
    bomId: bom.id,
    lines,
  });
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
