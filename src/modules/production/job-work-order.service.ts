import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getProductionSettings } from "@/core/production-settings/ProductionSettingsService";
import type { ListQuery } from "@/lib/list-query";
import { convertUomQuantity } from "@/lib/uom-conversion";
import { getAvailableQuantity, recordInventoryTransaction } from "@/modules/inventory/inventory.service";
import { LookupRepository } from "@/modules/lookups/lookup.repository";
import { ProductRepository } from "@/modules/products/product.repository";
import { FabricRollRepository } from "@/modules/purchasing/fabric-roll.repository";
import { SupplierRepository } from "@/modules/suppliers/supplier.repository";
import { JobWorkOrderStatus, type Prisma } from "@prisma/client";
import { applyJobOrderQuantityDelta, assertStageAccess } from "./job-order.service";
import { resolveSupplierPieceRate } from "./piece-rate-resolution.service";
import { generateEarningForJobWorkReceipt } from "./piece-rate-earning.service";
import { JobOrderRepository, ProductionOrderRepository } from "./production.repository";
import type { CreateJobWorkOrderInput, ReceiveJobWorkInput } from "./job-work-order.schema";
import { JobWorkOrderRepository, JobWorkReceiptRepository } from "./job-work-order.repository";

export interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

const EPSILON = 0.0001;

/**
 * External Unit User (2026-09-18) — deny-as-NOT_FOUND, the same convention
 * already established by getAllowedBranchIds/getAllowedProductionStageIds
 * (never reveal a record exists to someone who can't see it). `null` from
 * PermissionService.getAllowedSupplierId means an ordinary internal user
 * with no restriction — this is a no-op for every pre-existing caller.
 */
async function assertJobWorkOrderSupplierAccess(actor: { userId: string }, order: { supplierId: string }) {
  const allowedSupplierId = await PermissionService.getAllowedSupplierId(actor.userId);
  if (allowedSupplierId !== null && order.supplierId !== allowedSupplierId) {
    throw new BusinessRuleError("NOT_FOUND", "Job-work order not found.", {});
  }
}

/** Blocks an action outright for an external-unit login — issuing WIP,
 * cancelling/holding/closing an order, or reversing a receipt are internal
 * business decisions a vendor's own account must never be able to make. */
async function assertInternalUser(actor: { userId: string }) {
  const allowedSupplierId = await PermissionService.getAllowedSupplierId(actor.userId);
  if (allowedSupplierId !== null) {
    throw new BusinessRuleError("PERMISSION_DENIED", "This action is not available to an external unit account.", {});
  }
}

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
  // A CANCELLED order (only reachable with zero receipts against it, and its
  // issued material is now reversed back to stock — see
  // reverseIssuedMaterialsInTx) has nothing genuinely outstanding with the
  // contractor, regardless of what the raw issued/received/rejected/damaged
  // arithmetic below would otherwise suggest.
  const pendingQuantity =
    order.status === "CANCELLED"
      ? 0
      : Math.max(
          0,
          Number(order.issuedQuantity) - Number(order.receivedQuantity) - Number(order.rejectedQuantity) - Number(order.damagedQuantity)
        );
  const isDone = order.status === "FULLY_RECEIVED" || order.status === "CLOSED" || order.status === "CANCELLED";
  const daysElapsed = Math.floor((Date.now() - order.issueDate.getTime()) / (24 * 60 * 60 * 1000));
  const isOverdue = !isDone && !!order.expectedCompletionDate && Date.now() > order.expectedCompletionDate.getTime();

  return { pendingQuantity, daysElapsed, isOverdue };
}

const VALID_JOB_WORK_ORDER_STATUSES = new Set<string>(Object.values(JobWorkOrderStatus));

export async function listJobWorkOrders(
  companyId: string,
  query: ListQuery & { supplierId?: string; overdueOnly?: boolean },
  userId?: string
) {
  // External Unit User (2026-09-18) — an external login's own supplierId
  // always wins over any client-supplied ?supplierId= filter, never the
  // other way around (a client-supplied value must never WIDEN what an
  // external user can see).
  const allowedSupplierId = userId ? await PermissionService.getAllowedSupplierId(userId) : null;

  const where: Prisma.JobWorkOrderWhereInput = {
    companyId,
    ...(query.search ? { jobWorkNumber: { contains: query.search, mode: "insensitive" as const } } : {}),
    ...(allowedSupplierId ? { supplierId: allowedSupplierId } : query.supplierId ? { supplierId: query.supplierId } : {}),
    ...(query.status && VALID_JOB_WORK_ORDER_STATUSES.has(query.status)
      ? { status: query.status as JobWorkOrderStatus }
      : {}),
  };

  const [data, totalCount] = await Promise.all([
    JobWorkOrderRepository.findMany(where, { orderBy: { [query.sortBy]: query.sortOrder }, skip: query.skip, take: query.take }),
    JobWorkOrderRepository.count(where),
  ]);

  const decorated = data.map((o) => ({ ...o, metrics: computeJobWorkOrderMetrics(o) }));
  const filtered = query.overdueOnly ? decorated.filter((o) => o.metrics.isOverdue) : decorated;

  return { data: filtered, totalCount: query.overdueOnly ? filtered.length : totalCount };
}

/** Backs the Supervisor-facing "Pending External Receipts" queue. */
export async function listPendingJobWorkReceipts(actor: ActorContext) {
  await PermissionService.assert(actor.userId, "production", "approve");
  return JobWorkReceiptRepository.findPendingForCompany(actor.companyId);
}

export async function getJobWorkOrderById(companyId: string, id: string, userId?: string) {
  const order = await JobWorkOrderRepository.findAnyById(companyId, id);
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Job-work order not found.", { id });
  if (userId) await assertJobWorkOrderSupplierAccess({ userId }, order);
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
 * Returns every issued raw-material line back to stock — called only when
 * cancelling a Job Work Order with zero receipts against it (the caller
 * already verified this via countActiveReceipts). Recomputes each line's
 * base-UOM quantity the same way createJobWorkOrder() did at issuance time
 * (the converted amount itself is never stored on JobWorkOrderMaterial, only
 * the as-entered quantity/unit) — if a unit's conversion path no longer
 * exists, cancellation is blocked rather than silently leaving stock
 * un-reversed, matching this project's "never fail-soft on a real stock
 * correction" stance.
 */
async function reverseIssuedMaterialsInTx(
  tx: Prisma.TransactionClient,
  actor: ActorContext,
  order: {
    id: string;
    materials: Array<{
      productId: string;
      quantity: Prisma.Decimal | number;
      uomId: string;
      warehouseId: string;
      fabricRollId: string | null;
    }>;
  }
) {
  for (const material of order.materials) {
    const product = await ProductRepository.findMaterialById(actor.companyId, material.productId);
    if (!product || !product.baseUom) {
      throw new BusinessRuleError(
        "UOM_CONVERSION_UNAVAILABLE",
        "Cannot reverse issued material — its base unit configuration is missing.",
        { productId: material.productId }
      );
    }

    const quantity = Number(material.quantity);
    let baseQuantity: number;
    if (material.uomId === product.baseUom.id) {
      baseQuantity = quantity;
    } else {
      const chosenUom = await LookupRepository.unit.findUnique({ where: { id: material.uomId } });
      if (!chosenUom) throw new BusinessRuleError("NOT_FOUND", "Unit not found.", { id: material.uomId });
      const converted = convertUomQuantity(quantity, chosenUom, product.baseUom);
      if (converted === null) {
        throw new BusinessRuleError(
          "UOM_CONVERSION_UNAVAILABLE",
          `"${chosenUom.name}" no longer has a fixed conversion to "${product.styleName}"'s base unit — cannot reverse this line automatically.`,
          { productId: material.productId, uomId: material.uomId }
        );
      }
      baseQuantity = converted;
    }

    await recordInventoryTransaction(tx, actor, {
      productId: material.productId,
      warehouseId: material.warehouseId,
      transactionType: "JOB_WORK_ISSUE_REVERSAL",
      quantity: baseQuantity,
      referenceModule: "JOB_WORK_ORDER",
      referenceRecordId: order.id,
      fabricRollId: material.fabricRollId || null,
    });

    if (material.fabricRollId) {
      await FabricRollRepository.incrementRemaining(tx, material.fabricRollId, baseQuantity);
    }
  }
}

/**
 * issuedQuantity draws down the parent JobOrder's "remaining/unprocessed"
 * pool (plannedQuantity - completed - rejected - damaged), minus whatever's
 * already pending on this JobOrder's other active job-work orders — the
 * same pool internal Assign+Progress draws from. Recomputed server-side,
 * never trusted from the client.
 */
export async function createJobWorkOrder(actor: ActorContext, input: CreateJobWorkOrderInput) {
  await assertInternalUser(actor);

  const jobOrder = await JobOrderRepository.findAnyById(actor.companyId, input.jobOrderId);
  if (!jobOrder) throw new BusinessRuleError("NOT_FOUND", "Job order not found.", { id: input.jobOrderId });
  if (jobOrder.status === "CANCELLED") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Cannot send a cancelled job order to job-work.", {});
  }
  await assertStageAccess(actor, jobOrder.productionStageId);

  // Tenant-scoped — a supplierId from another company would otherwise sit
  // unvalidated on the record and be embedded in every subsequent read.
  const supplier = await SupplierRepository.findById(actor.companyId, input.supplierId);
  if (!supplier) throw new BusinessRuleError("NOT_FOUND", "Contractor/supplier not found.", { id: input.supplierId });

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

  // Piece-Rate external costing (2026-09-18) — resolved and snapshotted once
  // at issuance, plugging into the SAME generalized Rate Card table internal
  // piece-rate assignments use (dimensioned by supplierId here instead of
  // employeeId). An unresolved rate never blocks issuance — business
  // continuity — it just flags UNRESOLVED for later correction.
  let resolvedRate: number | null = null;
  let rateResolutionStatus: "RESOLVED" | "UNRESOLVED" = "UNRESOLVED";
  let rateSourceId: string | null = null;
  if (input.productionOperationId) {
    const settings = await getProductionSettings(actor.companyId);
    if (settings.pieceRateTrackingEnabled) {
      const order = await ProductionOrderRepository.findAnyById(actor.companyId, jobOrder.productionOrderId);
      const resolution = await resolveSupplierPieceRate({
        companyId: actor.companyId,
        productId: order?.productId ?? null,
        productionOperationId: input.productionOperationId,
        supplierId: input.supplierId,
        asOfDate: new Date(input.issueDate),
      });
      if (resolution.resolved) {
        resolvedRate = resolution.rate;
        rateResolutionStatus = "RESOLVED";
        rateSourceId = resolution.rateCardId;
      }
    }
  }

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
        productionOperationId: input.productionOperationId || null,
        resolvedRate,
        rateResolutionStatus,
        rateSourceId,
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
  // CF-5: checked before anything else, including drawing a document number.
  if (input.idempotencyKey) {
    const existing = await JobWorkReceiptRepository.findByIdempotencyKey(actor.companyId, input.idempotencyKey);
    if (existing) return existing;
  }

  const order = await JobWorkOrderRepository.findAnyById(actor.companyId, jobWorkOrderId);
  if (!order) throw new BusinessRuleError("NOT_FOUND", "Job-work order not found.", { id: jobWorkOrderId });

  // External Unit User (2026-09-18) — an external login may only report
  // against its own supplier's order, and only when the company's own
  // ProductionSettings.externalEntryBy actually allows it. A submission that
  // passes both checks is held PENDING with zero quantity applied — the same
  // "a worker's own unverified claim must never count as real production
  // before someone checks it" discipline as the internal self-entry flow.
  const allowedSupplierId = await PermissionService.getAllowedSupplierId(actor.userId);
  const isExternalSubmission = allowedSupplierId !== null;
  if (isExternalSubmission) {
    await assertJobWorkOrderSupplierAccess(actor, order);
    const settings = await getProductionSettings(actor.companyId);
    if (settings.externalEntryBy === "INTERNAL_SUPERVISOR") {
      throw new BusinessRuleError(
        "PERMISSION_DENIED",
        "This company requires an internal Supervisor to record job-work receipts on your behalf.",
        {}
      );
    }
  }

  if (order.status === "CANCELLED" || order.status === "CLOSED") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Cannot receive against a job-work order in "${order.status}" status.`, {
      currentStatus: order.status,
    });
  }

  const totalReceiving = input.receivedQuantity + input.rejectedQuantity + input.damagedQuantity;
  if (totalReceiving <= 0) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Enter at least one non-zero quantity to receive.", {});
  }

  // Drawn via the existing atomic document-number counter (document_sequences,
  // UPDATE...RETURNING) — replaces the previous count()-then-use scheme,
  // which raced under concurrent receipts against the same job-work order
  // (two receipts arriving together could both read the same count and both
  // build the identical "<jobWorkNumber>-R<n>" suffix).
  const receiptNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    documentType: "JOB_WORK_RECEIPT",
  });

  // An external submission never touches the JobWorkOrder's own accumulators
  // or the parent JobOrder's quantities — only a PENDING receipt row, applied
  // for real only once approveJobWorkReceipt() runs.
  if (isExternalSubmission) {
    const receipt = await JobWorkReceiptRepository.createInTx(prisma, {
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
      submittedBySource: "EXTERNAL_UNIT_USER",
      approvalStatus: "PENDING",
      submittedByUserId: actor.userId,
      idempotencyKey: input.idempotencyKey ?? null,
    });

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "job_work_receipts",
      recordId: receipt.id,
      action: "CREATE",
      newValues: { jobWorkOrderId, submittedBySource: "EXTERNAL_UNIT_USER", approvalStatus: "PENDING" },
    });

    return receipt;
  }

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
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
        idempotencyKey: input.idempotencyKey ?? null,
      });

      // Reuse the existing, untouched guard — this is the integration point.
      await applyJobOrderQuantityDelta(tx, order.jobOrderId, {
        completed: input.receivedQuantity,
        rejected: input.rejectedQuantity,
        damaged: input.damagedQuantity,
      });

      // Piece-Rate (2026-09-18) — the external "worker" here is the
      // Supplier; only genuinely received quantity is ever paid, never
      // rejected/damaged. No-op when the order has no resolved rate.
      if (current.resolvedRate !== null && current.resolvedRate !== undefined) {
        await generateEarningForJobWorkReceipt(tx, {
          companyId: actor.companyId,
          jobOrderId: order.jobOrderId,
          jobWorkOrderId,
          jobWorkReceiptId: receipt.id,
          supplierId: current.supplierId,
          productionOperationId: current.productionOperationId,
          resolvedRate: Number(current.resolvedRate),
          receivedQuantityDelta: input.receivedQuantity,
        });
      }

      return receipt;
    });
  } catch (err) {
    // A genuine concurrent replay — see createGoodsReceipt's identical fallback.
    if (input.idempotencyKey && err && typeof err === "object" && "code" in err && err.code === "P2002") {
      const existing = await JobWorkReceiptRepository.findByIdempotencyKey(actor.companyId, input.idempotencyKey);
      if (existing) return existing;
    }
    throw err;
  }

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

/** A Supervisor approves an external unit's PENDING receipt — this is where
 * the vendor's own claimed quantities finally become real, applied via the
 * exact same accumulator/applyJobOrderQuantityDelta path an internal receipt
 * already uses. Self-approval-guarded — the external submitter cannot
 * approve their own submission. */
export async function approveJobWorkReceipt(actor: ActorContext, receiptId: string) {
  await assertInternalUser(actor);
  const receipt = await JobWorkReceiptRepository.findAnyById(actor.companyId, receiptId);
  if (!receipt) throw new BusinessRuleError("NOT_FOUND", "Job-work receipt not found.", { id: receiptId });
  if (receipt.approvalStatus !== "PENDING") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Cannot approve a receipt in "${receipt.approvalStatus}" status.`, {
      currentStatus: receipt.approvalStatus,
    });
  }
  await PermissionService.assert(actor.userId, "production", "approve", { createdBy: receipt.submittedByUserId ?? undefined });

  const updated = await prisma.$transaction(async (tx) => {
    const guard = await JobWorkReceiptRepository.updateApprovalStatusConditionalInTx(tx, receiptId, "PENDING", {
      approvalStatus: "APPROVED",
      approvedByUserId: actor.userId,
      approvedAt: new Date(),
      receivedByUserId: actor.userId,
    });
    if (guard.count === 0) {
      throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This receipt was already decided.", {});
    }

    const current = await JobWorkOrderRepository.findForGuardedUpdateInTx(tx, receipt.jobWorkOrderId);
    const issued = Number(current.issuedQuantity);
    const newReceived = Number(current.receivedQuantity) + Number(receipt.receivedQuantity);
    const newRejected = Number(current.rejectedQuantity) + Number(receipt.rejectedQuantity);
    const newDamaged = Number(current.damagedQuantity) + Number(receipt.damagedQuantity);
    const total = newReceived + newRejected + newDamaged;
    if (total > issued + EPSILON) {
      throw new BusinessRuleError(
        "OVER_RECEIPT_NOT_ALLOWED",
        `Approving this receipt would bring the total received+rejected+damaged (${total}) above the issued quantity (${issued}).`,
        { issued, attempted: total }
      );
    }

    await JobWorkOrderRepository.updateInTx(tx, receipt.jobWorkOrderId, {
      receivedQuantity: newReceived,
      rejectedQuantity: newRejected,
      damagedQuantity: newDamaged,
      status: computeJobWorkOrderStatus({ ...current, receivedQuantity: newReceived, rejectedQuantity: newRejected, damagedQuantity: newDamaged }),
    });

    await applyJobOrderQuantityDelta(tx, current.jobOrderId, {
      completed: Number(receipt.receivedQuantity),
      rejected: Number(receipt.rejectedQuantity),
      damaged: Number(receipt.damagedQuantity),
    });

    if (current.resolvedRate !== null && current.resolvedRate !== undefined) {
      await generateEarningForJobWorkReceipt(tx, {
        companyId: actor.companyId,
        jobOrderId: current.jobOrderId,
        jobWorkOrderId: receipt.jobWorkOrderId,
        jobWorkReceiptId: receipt.id,
        supplierId: current.supplierId,
        productionOperationId: current.productionOperationId,
        resolvedRate: Number(current.resolvedRate),
        receivedQuantityDelta: Number(receipt.receivedQuantity),
      });
    }

    return tx.jobWorkReceipt.findUniqueOrThrow({ where: { id: receiptId } });
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "job_work_receipts",
    recordId: receiptId,
    action: "APPROVE",
    oldValues: { approvalStatus: "PENDING" },
    newValues: { approvalStatus: "APPROVED" },
  });

  return updated;
}

/** Rejects an external unit's PENDING receipt — a remark is required,
 * mirroring rejectProgressEntry's own precedent. No quantity change of any
 * kind. */
export async function rejectJobWorkReceipt(actor: ActorContext, receiptId: string, approvalRemark: string) {
  await assertInternalUser(actor);
  const receipt = await JobWorkReceiptRepository.findAnyById(actor.companyId, receiptId);
  if (!receipt) throw new BusinessRuleError("NOT_FOUND", "Job-work receipt not found.", { id: receiptId });
  await PermissionService.assert(actor.userId, "production", "approve");

  const guard = await JobWorkReceiptRepository.updateApprovalStatusConditional(actor.companyId, receiptId, "PENDING", {
    approvalStatus: "REJECTED",
    approvedByUserId: actor.userId,
    approvedAt: new Date(),
    approvalRemark,
    status: "CANCELLED",
  });
  if (guard.count === 0) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Cannot reject a receipt in "${receipt.approvalStatus}" status.`, {
      currentStatus: receipt.approvalStatus,
    });
  }

  const updated = await JobWorkReceiptRepository.findAnyById(actor.companyId, receiptId);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "job_work_receipts",
    recordId: receiptId,
    action: "REJECT",
    oldValues: { approvalStatus: "PENDING" },
    newValues: { approvalStatus: "REJECTED", approvalRemark },
  });

  return updated;
}

/** Mirrors reverseGoodsReceiptLine() — decrements both this JobWorkOrder's
 * own accumulators and the parent JobOrder's, symmetrically undoing what
 * the original receipt applied. No delete — a compensating state change on
 * the same row, matching this project's "no delete on transactional
 * documents" convention. */
export async function reverseJobWorkReceipt(actor: ActorContext, receiptId: string, reason: string) {
  await assertInternalUser(actor);
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
  await assertInternalUser(actor);
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

  await prisma.$transaction(async (tx) => {
    // Nothing has physically left for the contractor's own books yet
    // (guarded above via countActiveReceipts) — the raw material issued
    // against this job-work order is still rightfully ours, so cancelling
    // returns it to the warehouse it came from rather than leaving it
    // permanently unaccounted for.
    if (targetStatus === "CANCELLED") {
      await reverseIssuedMaterialsInTx(tx, actor, before);
    }
    await JobWorkOrderRepository.updateInTx(tx, id, data);
  });

  const updated = await JobWorkOrderRepository.findAnyById(actor.companyId, id);
  if (!updated) throw new BusinessRuleError("NOT_FOUND", "Job-work order not found.", { id });

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
  await assertInternalUser(actor);
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
