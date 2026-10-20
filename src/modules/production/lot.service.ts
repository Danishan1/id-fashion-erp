import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { logger } from "@/core/logging/logger";
import { registerProductionLotBarcode } from "@/core/barcode/barcode.service";
import type { Prisma } from "@prisma/client";
import { LotRelationRepository, LotRepository, ProductionOrderRepository } from "./production.repository";
import type { CreateLotInput, MergeLotsInput, SplitLotInput } from "./production.schema";
import type { ActorContext } from "./production-order.service";
import { computeAvailableToCommit, sumAssignmentConsumed } from "./assignment-capacity";
import { assertLotMaterialReady } from "./lot-readiness.service";
import { assertProductionBranchScope } from "./production-scope";
import {
  assertStageAccess,
  findFirstActiveStage,
  prepareLotStartAssignments,
  startLotAtStageInTx,
  writeLotStartAuditLogs,
} from "./job-order.service";

const EPSILON = 0.0001;

function padLotSuffix(n: number) {
  return String(n).padStart(2, "0");
}

async function claimNextLotNumber(tx: Prisma.TransactionClient, productionOrderId: string, orderNumber: string) {
  const { nextLotSequence } = await ProductionOrderRepository.incrementLotSequenceInTx(tx, productionOrderId);
  return `${orderNumber}-L${padLotSuffix(nextLotSequence - 1)}`;
}

/**
 * Job orders sitting at a stage outside the viewer's allowed set (see
 * PermissionService.getAllowedProductionStageIds()) are dropped from the
 * response entirely — a restricted "Cutting Supervisor" role shouldn't see
 * Stitching's job orders/action buttons on a lot's own detail page any more
 * than they can act on them (job-order.service.ts's assertStageAccess()
 * enforces the write side). The Lot itself always renders — a lot spans
 * every stage over its life, restricting the whole record would hide the
 * viewer's own stage's work too whenever another stage happens to also have
 * an open job order on it.
 */
export async function getLotById(companyId: string, id: string, userId: string) {
  const lot = await LotRepository.findByIdWithDetails(companyId, id);
  if (!lot) throw new BusinessRuleError("NOT_FOUND", "Lot not found.", { id });

  // A branch-restricted user gets NOT_FOUND for a lot outside their allowed
  // branches — same "deny as not-found" convention used across this app.
  const allowedBranchIds = await PermissionService.getAllowedBranchIds(userId);
  if (allowedBranchIds !== null && (!lot.branchId || !allowedBranchIds.has(lot.branchId))) {
    throw new BusinessRuleError("NOT_FOUND", "Lot not found.", { id });
  }

  const allowedStageIds = await PermissionService.getAllowedProductionStageIds(userId);
  const visibleJobOrders =
    allowedStageIds === null ? lot.jobOrders : lot.jobOrders.filter((jo) => allowedStageIds.has(jo.productionStage.id));

  // Worker-assignment figures for the Assign Worker / Log Process screens,
  // computed with the exact same helpers the write paths enforce — so a UI
  // hint can never disagree with what the API will actually accept.
  const jobOrders = await Promise.all(
    visibleJobOrders.map(async (jo) => {
      const { available } = await computeAvailableToCommit(prisma, jo);
      const assignments = await Promise.all(
        jo.assignments.map(async (a) => {
          const logged = await sumAssignmentConsumed(prisma, a.id, { includePending: true });
          return {
            ...a,
            loggedQuantity: logged,
            remainingQuantity: Math.max(0, Number(a.assignedQuantity) - logged),
          };
        }),
      );
      return { ...jo, availableToAssign: available, assignments };
    }),
  );

  return { ...lot, jobOrders };
}

export async function getLotGenealogy(companyId: string, id: string) {
  const lot = await LotRepository.findAnyById(companyId, id);
  if (!lot) throw new BusinessRuleError("NOT_FOUND", "Lot not found.", { id });
  return LotRelationRepository.findByParentOrChild(id);
}

/**
 * Creates a production lot and starts it at the first stage (Cutting) with
 * its cutting worker(s), all in one transaction (2026-09-29). Blocked unless:
 *  1. at least one cutting worker is assigned (pieces > 0, total ≤ lot qty),
 *  2. a material request exists for this production order, and
 *  3. material ISSUED so far covers every counted lot's pieces (this one
 *     included) × the Effective-BOM per-piece consumption.
 * Every rule is enforced here, server-side — the Add Lot modal only previews.
 */
export async function createLot(actor: ActorContext, productionOrderId: string, input: CreateLotInput) {
  const order = await ProductionOrderRepository.findAnyById(actor.companyId, productionOrderId);
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Production order not found.", { id: productionOrderId });
  await assertProductionBranchScope(actor, order.branchId, { label: "Production order", id: productionOrderId });

  if (order.status === "CANCELLED" || order.status === "CLOSED") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Cannot create a lot on a production order in "${order.status}" status.`, {
      currentStatus: order.status,
    });
  }
  if (order.status === "ON_HOLD") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Resume the production order before starting new work on it.", {
      currentStatus: order.status,
    });
  }

  if (input.variantBreakdown && input.variantBreakdown.length > 0) {
    const sum = input.variantBreakdown.reduce((s, r) => s + r.quantity, 0);
    if (Math.abs(sum - input.quantity) > EPSILON) {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        `The size/color breakdown (${sum}) must add up to the lot quantity (${input.quantity}).`,
        { breakdownSum: sum, quantity: input.quantity }
      );
    }
    const variantIds = input.variantBreakdown.map((r) => r.productVariantId);
    const validCount = await prisma.productVariant.count({ where: { id: { in: variantIds }, productId: order.productId } });
    if (validCount !== variantIds.length) {
      throw new BusinessRuleError("VALIDATION_ERROR", "One or more selected variants do not belong to this production order's own style.", {});
    }
  }

  const stage = await findFirstActiveStage(actor.companyId);
  await assertStageAccess(actor, stage.id);
  await assertLotMaterialReady(actor.companyId, order.id, { newLotPieces: input.quantity });
  const prepared = await prepareLotStartAssignments(
    actor,
    { productId: order.productId, lotQuantity: input.quantity, stage },
    input.cuttingAssignments ?? []
  );

  const { lot, started } = await prisma.$transaction(async (tx) => {
    // Claiming the next lot-number suffix is a genuine row UPDATE on the
    // ProductionOrder, which takes a Postgres row lock for the rest of this
    // transaction — so two Add Lots on the same order serialize here.
    const lotNumber = await claimNextLotNumber(tx, order.id, order.orderNumber);

    // Deliberately NOT capped against the Production Order's own
    // plannedQuantity — over-production is a real, allowed business outcome
    // (future demand, replacements), and the material gate above already
    // requires issued material to cover it.
    const created = await LotRepository.createInTx(tx, {
      companyId: actor.companyId,
      branchId: actor.branchId || null,
      productionOrderId: order.id,
      lotNumber,
      quantity: input.quantity,
      uomId: input.uomId,
      status: "PLANNED",
      createdByUserId: actor.userId,
      ...(input.variantBreakdown && input.variantBreakdown.length > 0
        ? { variantBreakdown: { create: input.variantBreakdown.map((r) => ({ productVariantId: r.productVariantId, quantity: r.quantity })) } }
        : {}),
    });

    // Creating the first lot moves the order forward — a side effect, not a
    // caller-chosen generic status change.
    if (order.status === "PLANNED" || order.status === "MATERIAL_ALLOCATED") {
      await tx.productionOrder.update({ where: { id: order.id }, data: { status: "IN_PROGRESS" } });
    }

    const startedAtStage = await startLotAtStageInTx(tx, actor, {
      productionOrderId: order.id,
      lot: created,
      stage,
      assignments: prepared,
    });

    return { lot: created, started: startedAtStage };
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "lots",
    recordId: lot.id,
    action: "CREATE",
    newValues: { lotNumber: lot.lotNumber, quantity: input.quantity, startedAtStage: stage.code },
  });
  await writeLotStartAuditLogs(
    actor,
    { lotId: lot.id, stageId: stage.id, quantity: lot.quantity, jobOrderId: started.jobOrder.id },
    started.assignments,
    prepared
  );

  // Best-effort, post-commit: register this lot's own PRODUCTION_LOT barcode
  // (reusing lotNumber verbatim — no minting needed). Never allowed to fail
  // lot creation itself — see registerProductionLotBarcode's own doc
  // comment and mintFabricRollBarcode's identical reasoning in
  // goods-receipt.service.ts.
  try {
    await registerProductionLotBarcode({ companyId: actor.companyId, userId: actor.userId }, lot.id, lot.lotNumber);
  } catch (err) {
    logger.error("Failed to register Production Lot barcode after Lot creation", { error: err, lotId: lot.id });
  }

  return { ...lot, status: "IN_PROGRESS" as const, currentStageId: stage.id, firstJobOrderId: started.jobOrder.id };
}

export interface VariantBreakdownSuggestionRow {
  productVariantId: string;
  colorName: string;
  sizeName: string;
  skuCode: string;
  /** null for a Make-to-Stock order (no linked Sales Order line to source a
   * real ordered quantity from) — the variant is still listed for manual
   * entry, just with no suggested starting quantity. */
  orderedQuantity: number | null;
  /** Already assigned to this variant across every other Lot on this same
   * Production Order — subtracted from orderedQuantity to suggest what's
   * actually left to put into a new lot. */
  alreadyInLots: number;
  remaining: number | null;
}

/**
 * Feeds the Add Lot modal's size/color picker. When the order is linked to a
 * real Sales Order line, suggests from that line's own real
 * SalesOrderItemBreakdown (never re-typed/duplicated data) minus whatever
 * other lots on this order already claimed; for Make-to-Stock, lists the
 * style's own active variants with no suggested quantity — purely for manual
 * entry. Read-only, informational — never caps what createLot() will accept.
 */
export async function getVariantBreakdownSuggestions(companyId: string, productionOrderId: string): Promise<VariantBreakdownSuggestionRow[]> {
  const order = await ProductionOrderRepository.findAnyById(companyId, productionOrderId);
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Production order not found.", { id: productionOrderId });

  const alreadyRows = await prisma.lotVariantBreakdown.groupBy({
    by: ["productVariantId"],
    where: { lot: { productionOrderId } },
    _sum: { quantity: true },
  });
  const alreadyMap = new Map(alreadyRows.map((r) => [r.productVariantId, Number(r._sum.quantity ?? 0)]));

  if (order.salesOrderItemId) {
    const item = await prisma.salesOrderItem.findFirst({
      where: { id: order.salesOrderItemId },
      include: { breakdown: { include: { productVariant: { include: { color: true, size: true } } } } },
    });
    if (!item) throw new BusinessRuleError("NOT_FOUND", "Sales order line not found.", { id: order.salesOrderItemId });

    return item.breakdown.map((b) => {
      const already = alreadyMap.get(b.productVariantId) ?? 0;
      return {
        productVariantId: b.productVariantId,
        colorName: b.productVariant.color.name,
        sizeName: b.productVariant.size.name,
        skuCode: b.productVariant.skuCode,
        orderedQuantity: b.orderedQuantity,
        alreadyInLots: already,
        remaining: b.orderedQuantity - already,
      };
    });
  }

  const variants = await prisma.productVariant.findMany({
    where: { productId: order.productId, isActive: true },
    include: { color: true, size: true },
    orderBy: [{ color: { name: "asc" } }, { size: { sortOrder: "asc" } }],
  });
  return variants.map((v) => ({
    productVariantId: v.id,
    colorName: v.color.name,
    sizeName: v.size.name,
    skuCode: v.skuCode,
    orderedQuantity: null,
    alreadyInLots: alreadyMap.get(v.id) ?? 0,
    remaining: null,
  }));
}

async function assertLotAtRest(lotId: string, action: string) {
  const openCount = await LotRepository.countOpenJobOrders(lotId);
  if (openCount > 0) {
    throw new BusinessRuleError("LOT_GENEALOGY_INVALID", `Cannot ${action} — this lot has an in-progress job order. It must be "at rest" between stages first.`, {
      openJobOrderCount: openCount,
    });
  }
}

/**
 * All-or-nothing in V1: the sum of child quantities must exactly equal the
 * parent's quantity in one operation. A partial split (some of the parent's
 * quantity carved out, the remainder still active under the original lot)
 * is not supported — see PRODUCTION_MODULE_DESIGN.md §8.
 */
export async function splitLot(actor: ActorContext, parentLotId: string, input: SplitLotInput) {
  const parent = await LotRepository.findAnyById(actor.companyId, parentLotId);
  if (!parent) throw new BusinessRuleError("NOT_FOUND", "Lot not found.", { id: parentLotId });
  await assertProductionBranchScope(actor, parent.branchId, { label: "Lot", id: parentLotId });

  if (parent.status !== "PLANNED" && parent.status !== "IN_PROGRESS") {
    throw new BusinessRuleError("LOT_GENEALOGY_INVALID", `Cannot split a lot in "${parent.status}" status.`, { currentStatus: parent.status });
  }
  await assertLotAtRest(parentLotId, "split this lot");

  const childrenSum = input.children.reduce((sum, c) => sum + c.quantity, 0);
  const parentQuantity = Number(parent.quantity);
  if (Math.abs(childrenSum - parentQuantity) > 0.0001) {
    throw new BusinessRuleError(
      "LOT_GENEALOGY_INVALID",
      `Split quantities must sum to exactly ${parentQuantity} (the parent lot's quantity) — got ${childrenSum}.`,
      { parentQuantity, childrenSum }
    );
  }

  const order = await ProductionOrderRepository.findAnyById(actor.companyId, parent.productionOrderId);
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Production order not found.", { id: parent.productionOrderId });

  const children = await prisma.$transaction(async (tx) => {
    const createdChildren = [];
    for (const childInput of input.children) {
      const lotNumber = await claimNextLotNumber(tx, order.id, order.orderNumber);
      const child = await LotRepository.createInTx(tx, {
        companyId: actor.companyId,
        branchId: actor.branchId || null,
        productionOrderId: order.id,
        lotNumber,
        quantity: childInput.quantity,
        uomId: parent.uomId,
        status: "PLANNED",
        createdByUserId: actor.userId,
      });
      createdChildren.push(child);
    }

    await LotRelationRepository.createManyInTx(
      tx,
      createdChildren.map((child, i) => ({
        companyId: actor.companyId,
        parentLotId,
        childLotId: child.id,
        relationType: "SPLIT" as const,
        quantity: input.children[i].quantity,
        reason: input.reason || null,
        performedByUserId: actor.userId,
      }))
    );

    await LotRepository.updateInTx(tx, parentLotId, { status: "SPLIT" });

    return createdChildren;
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "lot_relations",
    recordId: parentLotId,
    action: "UPDATE",
    oldValues: { status: parent.status },
    newValues: { status: "SPLIT", childLotNumbers: children.map((c) => c.lotNumber) },
  });

  return children;
}

/**
 * Every named parent is fully consumed — there is no separate "partial
 * merge" concept; a user who wants to merge only part of a lot splits it
 * first, then merges the resulting piece (one mechanism, not two). Merge is
 * intra-order only in V1 (all parents must share the same Production
 * Order) — a cross-order merge raises an unresolved "which order does the
 * result belong to" question that isn't worth the complexity yet.
 */
export async function mergeLots(actor: ActorContext, input: MergeLotsInput) {
  const parents = await Promise.all(input.parentLotIds.map((id) => LotRepository.findAnyById(actor.companyId, id)));
  const missingIndex = parents.findIndex((p) => !p);
  if (missingIndex !== -1) {
    throw new BusinessRuleError("NOT_FOUND", "Lot not found.", { id: input.parentLotIds[missingIndex] });
  }
  const validParents = parents as NonNullable<(typeof parents)[number]>[];
  for (const p of validParents) {
    await assertProductionBranchScope(actor, p.branchId, { label: "Lot", id: p.id });
  }

  const firstOrderId = validParents[0].productionOrderId;
  const firstUomId = validParents[0].uomId;
  if (validParents.some((p) => p.productionOrderId !== firstOrderId)) {
    throw new BusinessRuleError("LOT_GENEALOGY_INVALID", "All lots being merged must belong to the same production order.", {});
  }
  if (validParents.some((p) => p.uomId !== firstUomId)) {
    throw new BusinessRuleError("LOT_GENEALOGY_INVALID", "All lots being merged must share the same unit of measure.", {});
  }
  for (const parent of validParents) {
    if (parent.status !== "PLANNED" && parent.status !== "IN_PROGRESS") {
      throw new BusinessRuleError("LOT_GENEALOGY_INVALID", `Cannot merge lot ${parent.lotNumber} — it is in "${parent.status}" status.`, {
        lotId: parent.id,
        currentStatus: parent.status,
      });
    }
    await assertLotAtRest(parent.id, `merge lot ${parent.lotNumber}`);
  }

  const order = await ProductionOrderRepository.findAnyById(actor.companyId, firstOrderId);
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Production order not found.", { id: firstOrderId });

  const childQuantity = validParents.reduce((sum, p) => sum + Number(p.quantity), 0);

  const child = await prisma.$transaction(async (tx) => {
    const lotNumber = await claimNextLotNumber(tx, order.id, order.orderNumber);
    const created = await LotRepository.createInTx(tx, {
      companyId: actor.companyId,
      branchId: actor.branchId || null,
      productionOrderId: order.id,
      lotNumber,
      quantity: childQuantity,
      uomId: firstUomId,
      status: "PLANNED",
      createdByUserId: actor.userId,
    });

    await LotRelationRepository.createManyInTx(
      tx,
      validParents.map((parent) => ({
        companyId: actor.companyId,
        parentLotId: parent.id,
        childLotId: created.id,
        relationType: "MERGE" as const,
        quantity: parent.quantity,
        reason: input.reason || null,
        performedByUserId: actor.userId,
      }))
    );

    for (const parent of validParents) {
      await LotRepository.updateInTx(tx, parent.id, { status: "MERGED" });
    }

    return created;
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "lot_relations",
    recordId: child.id,
    action: "CREATE",
    newValues: { childLotNumber: child.lotNumber, parentLotIds: input.parentLotIds },
  });

  return child;
}
