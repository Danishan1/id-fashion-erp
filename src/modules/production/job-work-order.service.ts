import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import type { ListQuery } from "@/lib/list-query";
import { convertUomQuantity } from "@/lib/uom-conversion";
import { getAvailableQuantity, recordInventoryTransaction } from "@/modules/inventory/inventory.service";
import { LookupRepository } from "@/modules/lookups/lookup.repository";
import { ProductRepository } from "@/modules/products/product.repository";
import { FabricRollRepository } from "@/modules/purchasing/fabric-roll.repository";
import type { JobWorkOrderStatus, Prisma } from "@prisma/client";
import { applyJobOrderQuantityDelta } from "./job-order.service";
import { JobOrderRepository } from "./production.repository";
import type { CreateJobWorkOrderInput, ReceiveJobWorkInput } from "./job-work-order.schema";
import { JobWorkOrderRepository, JobWorkReceiptRepository } from "./job-work-order.repository";

export interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

const EPSILON = 0.0001;

/**
 * Same shape as PurchaseOrder's own ALLOWED_TRANSITIONS — a small, genuinely
 * fixed status set fits this idiom fine (unlike a Lot's stage position).
 * FULLY_RECEIVED can still go ON_HOLD (matches PurchaseOrder precedent) but
 * CLOSED/CANCELLED are terminal.
 */
const ALLOWED_TRANSITIONS: Record<JobWorkOrderStatus, JobWorkOrderStatus[]> = {
  ISSUED: ["ON_HOLD", "CANCELLED"],
  PARTIALLY_RECEIVED: ["ON_HOLD", "CANCELLED"],
  FULLY_RECEIVED: ["ON_HOLD", "CLOSED"],
  CLOSED: [],
  ON_HOLD: ["CANCELLED"],
  CANCELLED: [],
};

function computeJobWorkOrderStatus(order: {
  status: JobWorkOrderStatus;
  issuedQuantity: Prisma.Decimal | number | string;
  receivedQuantity: Prisma.Decimal | number | string;
  rejectedQuantity: Prisma.Decimal | number | string;
  damagedQuantity: Prisma.Decimal | number | string;
}): JobWorkOrderStatus {
  if (order.status === "CANCELLED" || order.status === "ON_HOLD" || order.status === "CLOSED") return order.status;
  const issued = Number(order.issuedQuantity);
  const done = Number(order.receivedQuantity) + Number(order.rejectedQuantity) + Number(order.damagedQuantity);
  if (done <= 0) return "ISSUED";
  if (done >= issued - EPSILON) return "FULLY_RECEIVED";
  return "PARTIALLY_RECEIVED";
}

/** Derived, never stored — days-elapsed/overdue/pending must never drift
 * from the real quantities/dates, matching this project's repeated
 * "derive, don't duplicate" discipline (Deal.weightedValue, Lead.priority,
 * Material Request's remainingQuantity, all the same precedent). */
export function computeJobWorkOrderMetrics(order: {
  status: JobWorkOrderStatus;
  issuedQuantity: Prisma.Decimal | number | string;
  receivedQuantity: Prisma.Decimal | number | string;
  rejectedQuantity: Prisma.Decimal | number | string;
  damagedQuantity: Prisma.Decimal | number | string;
  issueDate: Date;
  expectedCompletionDate: Date | null;
}) {
  const pendingQuantity = Math.max(
    0,
    Number(order.issuedQuantity) - Number(order.receivedQuantity) - Number(order.rejectedQuantity) - Number(order.damagedQuantity)
  );
  const isDone = order.status === "FULLY_RECEIVED" || order.status === "CLOSED" || order.status === "CANCELLED";
  const daysElapsed = Math.floor((Date.now() - order.issueDate.getTime()) / (24 * 60 * 60 * 1000));
  const isOverdue = !isDone && !!order.expectedCompletionDate && Date.now() > order.expectedCompletionDate.getTime();

  return { pendingQuantity, daysElapsed, isOverdue };
}

export async function listJobWorkOrders(companyId: string, query: ListQuery & { supplierId?: string; overdueOnly?: boolean }) {
  const where: Prisma.JobWorkOrderWhereInput = {
    companyId,
    ...(query.search ? { jobWorkNumber: { contains: query.search, mode: "insensitive" as const } } : {}),
    ...(query.supplierId ? { supplierId: query.supplierId } : {}),
  };

  const [data, totalCount] = await Promise.all([
    JobWorkOrderRepository.findMany(where, { orderBy: { [query.sortBy]: query.sortOrder }, skip: query.skip, take: query.take }),
    JobWorkOrderRepository.count(where),
  ]);

  const decorated = data.map((o) => ({ ...o, metrics: computeJobWorkOrderMetrics(o) }));
  const filtered = query.overdueOnly ? decorated.filter((o) => o.metrics.isOverdue) : decorated;

  return { data: filtered, totalCount: query.overdueOnly ? filtered.length : totalCount };
}

export async function getJobWorkOrderById(companyId: string, id: string) {
  const order = await JobWorkOrderRepository.findAnyById(companyId, id);
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Job-work order not found.", { id });
  return { ...order, metrics: computeJobWorkOrderMetrics(order) };
}

/**
 * Converts each raw-material line into its own material's base UOM, and
 * checks it against real warehouse stock — before this fix, a job-work-order
 * material line posted its raw as-entered quantity straight to the ledger
 * with zero stock check for a non-roll material (a single ordinary request
 * could drive stock arbitrarily negative, no concurrency needed) and with no
 * UOM conversion at all (a non-base unit would silently corrupt the shared
 * ledger). Returns the converted quantities in the same order as `materials`.
 */
async function convertMaterialsToBaseUomAndCheckStock(
  companyId: string,
  materials: CreateJobWorkOrderInput["materials"]
): Promise<number[]> {
  const baseQuantities: number[] = [];
  for (const material of materials) {
    const product = await ProductRepository.findMaterialById(companyId, material.productId);
    if (!product) throw new BusinessRuleError("NOT_FOUND", "Material not found.", { id: material.productId });
    if (!product.baseUom) {
      throw new BusinessRuleError(
        "UOM_CONVERSION_UNAVAILABLE",
        `"${product.styleName}" has no base unit configured — cannot record stock for it.`,
        { productId: material.productId }
      );
    }

    let baseQuantity: number;
    if (material.uomId === product.baseUom.id) {
      baseQuantity = material.quantity;
    } else {
      const chosenUom = await LookupRepository.unit.findUnique({ where: { id: material.uomId } });
      if (!chosenUom) throw new BusinessRuleError("NOT_FOUND", "Unit not found.", { id: material.uomId });
      const converted = convertUomQuantity(material.quantity, chosenUom, product.baseUom);
      if (converted === null) {
        throw new BusinessRuleError(
          "UOM_CONVERSION_UNAVAILABLE",
          `"${chosenUom.name}" has no fixed conversion to "${product.styleName}"'s base unit ("${product.baseUom.name}") — pick a convertible unit.`,
          { productId: material.productId, uomId: material.uomId }
        );
      }
      baseQuantity = converted;
    }

    const available = await getAvailableQuantity(companyId, material.productId, material.warehouseId);
    if (baseQuantity > available + EPSILON) {
      throw new BusinessRuleError(
        "INSUFFICIENT_RAW_MATERIAL_STOCK",
        `Cannot issue ${baseQuantity} of "${product.styleName}" to job-work — only ${available} is available at the selected warehouse.`,
        { productId: material.productId, warehouseId: material.warehouseId, available, requested: baseQuantity }
      );
    }

    baseQuantities.push(baseQuantity);
  }
  return baseQuantities;
}

/**
 * issuedQuantity draws down the parent JobOrder's "remaining/unprocessed"
 * pool (plannedQuantity - completed - rejected - damaged), minus whatever's
 * already pending on this JobOrder's other active job-work orders — the
 * same pool internal Assign+Progress draws from. Recomputed server-side,
 * never trusted from the client.
 */
export async function createJobWorkOrder(actor: ActorContext, input: CreateJobWorkOrderInput) {
  const jobOrder = await JobOrderRepository.findAnyById(actor.companyId, input.jobOrderId);
  if (!jobOrder) throw new BusinessRuleError("NOT_FOUND", "Job order not found.", { id: input.jobOrderId });
  if (jobOrder.status === "CANCELLED") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Cannot send a cancelled job order to job-work.", {});
  }

  const unprocessed =
    Number(jobOrder.plannedQuantity) - Number(jobOrder.completedQuantity) - Number(jobOrder.rejectedQuantity) - Number(jobOrder.damagedQuantity);
  const alreadyPendingElsewhere = await JobWorkOrderRepository.sumPendingByJobOrderId(input.jobOrderId);
  const availableToIssue = unprocessed - alreadyPendingElsewhere;

  if (input.issuedQuantity > availableToIssue + EPSILON) {
    throw new BusinessRuleError(
      "OVER_PRODUCTION_NOT_ALLOWED",
      `Cannot issue ${input.issuedQuantity} to job-work — only ${availableToIssue} of this job order's work is still unprocessed and not already committed to another job-work order.`,
      { availableToIssue }
    );
  }

  for (const material of input.materials) {
    if (material.fabricRollId) {
      const roll = await FabricRollRepository.findByIdWithContext(actor.companyId, material.fabricRollId);
      if (!roll) throw new BusinessRuleError("NOT_FOUND", "Fabric roll not found.", { id: material.fabricRollId });
    }
  }

  // Convert every raw-material line to its material's base UOM and check it
  // against real warehouse stock, up front, before any write.
  const materialBaseQuantities = await convertMaterialsToBaseUomAndCheckStock(actor.companyId, input.materials);

  const jobWorkNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    documentType: "JOB_WORK_ORDER",
  });

  const created = await prisma.$transaction(async (tx) => {
    const order = await JobWorkOrderRepository.createWithMaterialsInTx(
      tx,
      {
        companyId: actor.companyId,
        branchId: actor.branchId || null,
        jobWorkNumber,
        supplierId: input.supplierId,
        jobOrderId: input.jobOrderId,
        issuedQuantity: input.issuedQuantity,
        uomId: input.uomId,
        issueDate: new Date(input.issueDate),
        expectedCompletionDate: input.expectedCompletionDate ? new Date(input.expectedCompletionDate) : null,
        remarks: input.remarks || null,
        requestedByUserId: actor.userId,
      },
      input.materials.map((m) => ({
        productId: m.productId,
        quantity: m.quantity,
        uomId: m.uomId,
        warehouseId: m.warehouseId,
        fabricRollId: m.fabricRollId || null,
        notes: m.notes || null,
      }))
    );

    // The WIP quantity itself never posts to the ledger — it has no
    // StockBalance row to decrement (WIP location is tracked structurally
    // via the JobOrder/stage graph, not the inventory ledger). Only the
    // optional raw-material lines are real stock leaving a real warehouse,
    // posted in their material's base UOM (materialBaseQuantities), not the
    // as-entered quantity.
    for (let i = 0; i < input.materials.length; i++) {
      const material = input.materials[i];
      const baseQuantity = materialBaseQuantities[i];
      await recordInventoryTransaction(tx, actor, {
        productId: material.productId,
        warehouseId: material.warehouseId,
        transactionType: "JOB_WORK_ISSUE",
        quantity: -baseQuantity,
        referenceModule: "JOB_WORK_ORDER",
        referenceRecordId: order.id,
        fabricRollId: material.fabricRollId || null,
      });

      if (material.fabricRollId) {
        const guard = await FabricRollRepository.guardedDecrementRemaining(tx, material.fabricRollId, baseQuantity);
        if (guard.count === 0) {
          throw new BusinessRuleError("INSUFFICIENT_RAW_MATERIAL_STOCK", "Not enough remaining quantity on the selected fabric roll.", {
            fabricRollId: material.fabricRollId,
          });
        }
      }
    }

    return order;
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "job_work_orders",
    recordId: created.id,
    action: "CREATE",
    newValues: { jobWorkNumber, supplierId: input.supplierId, jobOrderId: input.jobOrderId, issuedQuantity: input.issuedQuantity },
  });

  return created;
}

/**
 * Each receipt (a) increments this JobWorkOrder's own guarded received/
 * rejected/damaged accumulators (capped at issuedQuantity), and (b) applies
 * the exact same delta onto the parent JobOrder via the existing, untouched
 * applyJobOrderQuantityDelta() — the "integrate, don't parallel" requirement:
 * once this lands on JobOrder.completedQuantity, the already-built
 * forwardJobOrder()/recordQcInspection() become usable on it for free.
 */
export async function receiveJobWork(actor: ActorContext, jobWorkOrderId: string, input: ReceiveJobWorkInput) {
  const order = await JobWorkOrderRepository.findAnyById(actor.companyId, jobWorkOrderId);
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Job-work order not found.", { id: jobWorkOrderId });

  if (order.status === "CANCELLED" || order.status === "CLOSED") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Cannot receive against a job-work order in "${order.status}" status.`, {
      currentStatus: order.status,
    });
  }

  const totalReceiving = input.receivedQuantity + input.rejectedQuantity + input.damagedQuantity;
  if (totalReceiving <= 0) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Enter at least one non-zero quantity to receive.", {});
  }

  const receiptCount = await JobWorkReceiptRepository.countByJobWorkOrderId(jobWorkOrderId);
  const receiptNumber = `${order.jobWorkNumber}-R${receiptCount + 1}`;

  const result = await prisma.$transaction(async (tx) => {
    const current = await JobWorkOrderRepository.findForGuardedUpdateInTx(tx, jobWorkOrderId);
    const issued = Number(current.issuedQuantity);
    const newReceived = Number(current.receivedQuantity) + input.receivedQuantity;
    const newRejected = Number(current.rejectedQuantity) + input.rejectedQuantity;
    const newDamaged = Number(current.damagedQuantity) + input.damagedQuantity;
    const total = newReceived + newRejected + newDamaged;

    if (total > issued + EPSILON) {
      throw new BusinessRuleError(
        "OVER_RECEIPT_NOT_ALLOWED",
        `Receiving this quantity (${totalReceiving}) would bring the total received+rejected+damaged (${total}) above the issued quantity (${issued}).`,
        { issued, attempted: total }
      );
    }

    await JobWorkOrderRepository.updateInTx(tx, jobWorkOrderId, {
      receivedQuantity: newReceived,
      rejectedQuantity: newRejected,
      damagedQuantity: newDamaged,
      status: computeJobWorkOrderStatus({ ...current, receivedQuantity: newReceived, rejectedQuantity: newRejected, damagedQuantity: newDamaged }),
    });

    const receipt = await JobWorkReceiptRepository.createInTx(tx, {
      companyId: actor.companyId,
      jobWorkOrderId,
      receiptNumber,
      receivedDate: new Date(input.receivedDate),
      receivedQuantity: input.receivedQuantity,
      rejectedQuantity: input.rejectedQuantity,
      damagedQuantity: input.damagedQuantity,
      status: "COMPLETED",
      remarks: input.remarks || null,
      receivedByUserId: actor.userId,
    });

    // Reuse the existing, untouched guard — this is the integration point.
    await applyJobOrderQuantityDelta(tx, order.jobOrderId, {
      completed: input.receivedQuantity,
      rejected: input.rejectedQuantity,
      damaged: input.damagedQuantity,
    });

    return receipt;
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "job_work_receipts",
    recordId: result.id,
    action: "CREATE",
    newValues: { jobWorkOrderId, receivedQuantity: input.receivedQuantity, rejectedQuantity: input.rejectedQuantity, damagedQuantity: input.damagedQuantity },
  });

  return result;
}

/** Mirrors reverseGoodsReceiptLine() — decrements both this JobWorkOrder's
 * own accumulators and the parent JobOrder's, symmetrically undoing what
 * the original receipt applied. No delete — a compensating state change on
 * the same row, matching this project's "no delete on transactional
 * documents" convention. */
export async function reverseJobWorkReceipt(actor: ActorContext, receiptId: string, reason: string) {
  const receipt = await JobWorkReceiptRepository.findAnyById(actor.companyId, receiptId);
  if (!receipt) throw new BusinessRuleError("NOT_FOUND", "Job-work receipt not found.", { id: receiptId });
  if (receipt.status !== "COMPLETED") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Cannot reverse a receipt in "${receipt.status}" status.`, {});
  }

  await prisma.$transaction(async (tx) => {
    const order = await JobWorkOrderRepository.findForGuardedUpdateInTx(tx, receipt.jobWorkOrderId);
    const newReceived = Number(order.receivedQuantity) - Number(receipt.receivedQuantity);
    const newRejected = Number(order.rejectedQuantity) - Number(receipt.rejectedQuantity);
    const newDamaged = Number(order.damagedQuantity) - Number(receipt.damagedQuantity);

    await JobWorkOrderRepository.updateInTx(tx, receipt.jobWorkOrderId, {
      receivedQuantity: Math.max(0, newReceived),
      rejectedQuantity: Math.max(0, newRejected),
      damagedQuantity: Math.max(0, newDamaged),
      status: computeJobWorkOrderStatus({
        ...order,
        receivedQuantity: Math.max(0, newReceived),
        rejectedQuantity: Math.max(0, newRejected),
        damagedQuantity: Math.max(0, newDamaged),
      }),
    });

    await JobWorkReceiptRepository.updateInTx(tx, receiptId, { status: "CANCELLED", remarks: `${receipt.remarks ?? ""}\nReversed: ${reason}`.trim() });

    await applyJobOrderQuantityDelta(tx, order.jobOrderId, {
      completed: -Number(receipt.receivedQuantity),
      rejected: -Number(receipt.rejectedQuantity),
      damaged: -Number(receipt.damagedQuantity),
    });
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "job_work_receipts",
    recordId: receiptId,
    action: "CANCEL",
    newValues: { reason },
  });
}

export async function transitionJobWorkOrderStatus(actor: ActorContext, id: string, targetStatus: JobWorkOrderStatus) {
  const before = await JobWorkOrderRepository.findAnyById(actor.companyId, id);
  if (!before) throw new BusinessRuleError("NOT_FOUND", "Job-work order not found.", { id });

  const allowed = ALLOWED_TRANSITIONS[before.status] ?? [];
  if (!allowed.includes(targetStatus)) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Cannot move a job-work order from "${before.status}" to "${targetStatus}".`,
      { from: before.status, to: targetStatus }
    );
  }

  if (targetStatus === "CANCELLED") {
    // Never inferred from the status label alone — checked by a real query,
    // the same lesson this project has learned repeatedly (Sampling's
    // Hold/Resume bug, Purchasing's cancel-from-ON_HOLD bug).
    const activeReceipts = await JobWorkOrderRepository.countActiveReceipts(id);
    if (activeReceipts > 0) {
      throw new BusinessRuleError(
        "INVALID_STATE_TRANSITION",
        `Cannot cancel — ${activeReceipts} receipt(s) already exist against this job-work order.`,
        { activeReceipts }
      );
    }
  }

  const data: Prisma.JobWorkOrderUncheckedUpdateInput = { status: targetStatus };
  if (targetStatus === "ON_HOLD") data.statusBeforeHold = before.status;

  const updated = await JobWorkOrderRepository.update(id, data);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "job_work_orders",
    recordId: id,
    action: targetStatus === "CANCELLED" ? "CANCEL" : "UPDATE",
    oldValues: { status: before.status },
    newValues: { status: targetStatus },
  });

  return updated;
}

/** Restores the exact status the order was held from — no caller-chosen
 * target, same reasoning as every other resume function in this project. */
export async function resumeJobWorkOrderFromHold(actor: ActorContext, id: string) {
  const before = await JobWorkOrderRepository.findAnyById(actor.companyId, id);
  if (!before) throw new BusinessRuleError("NOT_FOUND", "Job-work order not found.", { id });
  if (before.status !== "ON_HOLD" || !before.statusBeforeHold) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This job-work order isn't on hold.", { currentStatus: before.status });
  }

  const updated = await JobWorkOrderRepository.update(id, { status: before.statusBeforeHold, statusBeforeHold: null });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "job_work_orders",
    recordId: id,
    action: "UPDATE",
    oldValues: { status: "ON_HOLD" },
    newValues: { status: before.statusBeforeHold },
  });

  return updated;
}
