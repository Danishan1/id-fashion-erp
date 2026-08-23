import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import type { Prisma } from "@prisma/client";
import { LotRelationRepository, LotRepository, ProductionOrderRepository } from "./production.repository";
import type { CreateLotInput, MergeLotsInput, SplitLotInput } from "./production.schema";
import type { ActorContext } from "./production-order.service";

const EPSILON = 0.0001;

// Lots that no longer represent "live" quantity against the order's plan —
// a SPLIT lot's quantity now lives entirely in its children, and a MERGED
// lot's quantity now lives entirely in the lot it was merged into. Counting
// either alongside their replacement would double-count the same physical
// pieces.
const SUPERSEDED_LOT_STATUSES = ["CANCELLED", "SPLIT", "MERGED"] as const;

function padLotSuffix(n: number) {
  return String(n).padStart(2, "0");
}

async function claimNextLotNumber(tx: Prisma.TransactionClient, productionOrderId: string, orderNumber: string) {
  const { nextLotSequence } = await ProductionOrderRepository.incrementLotSequenceInTx(tx, productionOrderId);
  return `${orderNumber}-L${padLotSuffix(nextLotSequence - 1)}`;
}

export async function getLotById(companyId: string, id: string) {
  const lot = await LotRepository.findByIdWithDetails(companyId, id);
  if (!lot) throw new BusinessRuleError("NOT_FOUND", "Lot not found.", { id });
  return lot;
}

export async function getLotGenealogy(companyId: string, id: string) {
  const lot = await LotRepository.findAnyById(companyId, id);
  if (!lot) throw new BusinessRuleError("NOT_FOUND", "Lot not found.", { id });
  return LotRelationRepository.findByParentOrChild(id);
}

export async function createLot(actor: ActorContext, productionOrderId: string, input: CreateLotInput) {
  const order = await ProductionOrderRepository.findAnyById(actor.companyId, productionOrderId);
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Production order not found.", { id: productionOrderId });

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

  const lot = await prisma.$transaction(async (tx) => {
    // Claiming the next lot-number suffix is a genuine row UPDATE on the
    // ProductionOrder, which takes a Postgres row lock for the rest of this
    // transaction — that lock is what makes the quantity-cap check below
    // atomic against a concurrent createLot on the same order (the second
    // transaction blocks here until the first commits, then re-reads the
    // now-committed sibling Lots before it sums them).
    const lotNumber = await claimNextLotNumber(tx, order.id, order.orderNumber);

    const existingSum = await tx.lot.aggregate({
      where: { productionOrderId: order.id, status: { notIn: [...SUPERSEDED_LOT_STATUSES] } },
      _sum: { quantity: true },
    });
    const alreadyPlanned = Number(existingSum._sum.quantity ?? 0);
    const plannedQuantity = Number(order.plannedQuantity);
    const newTotal = alreadyPlanned + input.quantity;
    if (newTotal > plannedQuantity + EPSILON) {
      throw new BusinessRuleError(
        "OVER_PRODUCTION_NOT_ALLOWED",
        `Cannot create a lot of ${input.quantity} — existing lots already total ${alreadyPlanned}, and this would bring the total to ${newTotal}, above the production order's planned quantity of ${plannedQuantity}.`,
        { alreadyPlanned, attempted: input.quantity, plannedQuantity }
      );
    }

    const created = await LotRepository.createInTx(tx, {
      companyId: actor.companyId,
      branchId: actor.branchId || null,
      productionOrderId: order.id,
      lotNumber,
      quantity: input.quantity,
      uomId: input.uomId,
      status: "PLANNED",
      createdByUserId: actor.userId,
    });

    // Creating the first lot moves the order forward — a side effect, not a
    // caller-chosen generic status change, mirroring how
    // SalesOrderStatus.IN_PRODUCTION is reserved for exactly this kind of
    // real business action elsewhere in this project.
    if (order.status === "PLANNED" || order.status === "MATERIAL_ALLOCATED") {
      await tx.productionOrder.update({ where: { id: order.id }, data: { status: "IN_PROGRESS" } });
    }

    return created;
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "lots",
    recordId: lot.id,
    action: "CREATE",
    newValues: { lotNumber: lot.lotNumber, quantity: input.quantity },
  });

  return lot;
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
