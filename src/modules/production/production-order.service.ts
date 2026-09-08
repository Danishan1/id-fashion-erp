import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import type { ListQuery } from "@/lib/list-query";
import { BomRepository } from "@/modules/bom-mrp/bom.repository";
import { getStyleMaterialRequirement } from "@/modules/bom-mrp/mrp.service";
import { createMaterialRequest } from "@/modules/inventory/material-request.service";
import { ProductRepository } from "@/modules/products/product.repository";
import type { Prisma, ProductionOrderStatus } from "@prisma/client";
import { LotRepository, ProductionOrderRepository } from "./production.repository";
import { getProductionOrderProgress } from "./production-progress.service";
import type { CreateProductionOrderInput, GenerateMaterialRequestInput } from "./production.schema";

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

  const salesOrderContext = order.salesOrderItemId
    ? await getSalesOrderLineCommitment(companyId, order.salesOrderItemId, id)
    : null;
  const progress = await getProductionOrderProgress(companyId, id);

  return { ...order, salesOrderContext, progress };
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
 * Explodes this order's BOM (quantityPerUnit * (1 + wastage%) * plannedQuantity
 * per material, converted to each material's own base UOM) and raises a real
 * MaterialRequest for whatever's short — reuses createMaterialRequest()
 * unchanged, exactly the pattern BOM/MRP's own "Generate Material Request"
 * button already established. Reuses getStyleMaterialRequirement (the same
 * calculation the create/edit form's live preview uses) rather than a second,
 * ad hoc calc — that former inline version never converted to base UOM
 * before comparing against available stock, a real unit-mismatch bug
 * whenever a BOM line's own unit differed from the material's base unit,
 * fixed here by construction rather than patched separately. A BomItem's
 * colorId is informational only here (Production Order carries no
 * color/size breakdown of its own) — every line applies to the full
 * plannedQuantity regardless of colorId, a deliberate V1 simplification.
 */
export async function generateMaterialRequestForOrder(actor: ActorContext, id: string, input: GenerateMaterialRequestInput) {
  const order = await ProductionOrderRepository.findAnyById(actor.companyId, id);
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Production order not found.", { id });

  const requirement = await getStyleMaterialRequirement(actor.companyId, order.productId, Number(order.plannedQuantity));
  if (!requirement.hasApprovedBom) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "This style has no approved BOM — an unapproved draft can't be used to plan material requirements. Approve a BOM version first.",
      { id }
    );
  }

  const lines = requirement.materials
    .filter((m) => m.shortfallQuantity > 0)
    .map((m) => ({ materialId: m.materialId, uomId: m.uomId, requestedQuantity: m.shortfallQuantity }));

  if (lines.length === 0) {
    throw new BusinessRuleError("VALIDATION_ERROR", "No shortfall — every required material is already available in stock.", {});
  }

  return createMaterialRequest(actor, {
    requestType: "PRODUCTION_REQUIREMENT",
    warehouseId: input.warehouseId,
    productionOrderId: id,
    bomId: requirement.bomId!,
    lines,
  });
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
