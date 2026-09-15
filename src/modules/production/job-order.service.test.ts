import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: { assert: vi.fn(), getAllowedProductionStageIds: vi.fn(), getAllowedBranchIds: vi.fn() },
}));
vi.mock("@/modules/inventory/inventory.service", () => ({ recordInventoryTransaction: vi.fn() }));
vi.mock("@/modules/employees/employee.repository", () => ({
  EmployeeRepository: { findById: vi.fn() },
}));

const mockPrismaClient = vi.hoisted(() => ({
  productionStage: { findFirst: vi.fn() },
  jobOrder: { count: vi.fn(), updateMany: vi.fn() },
  user: { findUnique: vi.fn() },
}));

vi.mock("@/core/db/client", () => ({
  prisma: {
    ...mockPrismaClient,
    // The transaction callback receives the same mocked client as its `tx`
    // — the guarded-update helpers under test only ever call
    // tx.jobOrder.count/updateMany, both stubbed above.
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(mockPrismaClient)),
  },
}));
vi.mock("./production.repository", () => ({
  JobOrderRepository: {
    findAnyById: vi.fn(),
    findForGuardedUpdateInTx: vi.fn(),
    updateInTx: vi.fn(),
    createInTx: vi.fn(),
  },
  JobOrderAssignmentRepository: {
    sumAssignedByJobOrderId: vi.fn(),
    createInTx: vi.fn(),
    findAnyById: vi.fn(),
  },
  JobOrderProgressEntryRepository: { createInTx: vi.fn() },
  ProductionOrderRepository: { findAnyById: vi.fn() },
  LotRepository: { findAnyById: vi.fn(), updateInTx: vi.fn() },
  ProductionStageTransactionRepository: { createInTx: vi.fn() },
  QcInspectionRepository: { createWithDefectsInTx: vi.fn() },
}));

const { prisma } = await import("@/core/db/client");
const { PermissionService } = await import("@/core/rbac/PermissionService");
const { EmployeeRepository } = await import("@/modules/employees/employee.repository");
const {
  JobOrderRepository,
  JobOrderAssignmentRepository,
  JobOrderProgressEntryRepository,
  ProductionOrderRepository,
  ProductionStageTransactionRepository,
  LotRepository,
  QcInspectionRepository,
} = await import("./production.repository");
const { computeJobOrderStatus, assignWorker, recordProgressEntry, forwardJobOrder, revertJobOrder, recordQcInspection, recordAdjustmentEntry, getJobOrderById } = await import("./job-order.service");

const actor = { companyId: "co-1", userId: "user-1" };

function stage(overrides: Partial<{ id: string; sequence: number; isActive: boolean; allowRework: boolean; isFinal: boolean; name: string; code: string }> = {}) {
  return { id: "stage-1", sequence: 1, isActive: true, allowRework: true, isFinal: false, name: "Stage", code: "STG", ...overrides };
}

function jobOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "jo-1",
    companyId: "co-1",
    productionOrderId: "po-1",
    lotId: "lot-1",
    lot: { id: "lot-1", lotNumber: "PROD-1-L01", productionOrderId: "po-1" },
    productionStageId: "stage-1",
    productionStage: stage(),
    status: "IN_PROGRESS",
    plannedQuantity: "100",
    completedQuantity: "40",
    rejectedQuantity: "0",
    damagedQuantity: "0",
    forwardedQuantity: "0",
    qcPassedQuantity: "0",
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(JobOrderRepository.findAnyById).mockReset();
  vi.mocked(EmployeeRepository.findById).mockReset().mockResolvedValue({ id: "emp-1" } as never);
  vi.mocked(JobOrderAssignmentRepository.sumAssignedByJobOrderId).mockReset();
  vi.mocked(JobOrderAssignmentRepository.createInTx).mockReset();
  vi.mocked(ProductionOrderRepository.findAnyById).mockReset();
  vi.mocked(PermissionService.assert).mockReset().mockResolvedValue(undefined);
  vi.mocked(PermissionService.getAllowedProductionStageIds).mockReset().mockResolvedValue(null);
  vi.mocked(PermissionService.getAllowedBranchIds).mockReset().mockResolvedValue(null);
  vi.mocked(JobOrderRepository.findForGuardedUpdateInTx).mockReset();
  vi.mocked(JobOrderRepository.updateInTx).mockReset();
  vi.mocked(JobOrderRepository.createInTx).mockReset();
  vi.mocked(ProductionStageTransactionRepository.createInTx).mockReset();
  vi.mocked(LotRepository.updateInTx).mockReset();
  vi.mocked(QcInspectionRepository.createWithDefectsInTx).mockReset();
  mockPrismaClient.productionStage.findFirst.mockReset();
  mockPrismaClient.jobOrder.count.mockReset();
  mockPrismaClient.jobOrder.updateMany.mockReset();
  mockPrismaClient.user.findUnique.mockReset();
  vi.mocked(JobOrderProgressEntryRepository.createInTx).mockReset();
});

describe("computeJobOrderStatus", () => {
  const base = { plannedQuantity: 100, completedQuantity: 0, rejectedQuantity: 0, damagedQuantity: 0 };

  it("stays PENDING when nothing has happened yet", () => {
    expect(computeJobOrderStatus({ status: "PENDING", ...base })).toBe("PENDING");
  });

  it("is IN_PROGRESS once some quantity is accounted for, but not all", () => {
    expect(computeJobOrderStatus({ status: "IN_PROGRESS", ...base, completedQuantity: 40 })).toBe("IN_PROGRESS");
  });

  it("is COMPLETED once completed+rejected+damaged reaches the planned quantity", () => {
    expect(computeJobOrderStatus({ status: "IN_PROGRESS", ...base, completedQuantity: 70, rejectedQuantity: 20, damagedQuantity: 10 })).toBe(
      "COMPLETED"
    );
  });

  it("never overwrites a manually-set CANCELLED or ON_HOLD status", () => {
    expect(computeJobOrderStatus({ status: "CANCELLED", ...base, completedQuantity: 100 })).toBe("CANCELLED");
    expect(computeJobOrderStatus({ status: "ON_HOLD", ...base })).toBe("ON_HOLD");
  });
});

describe("assignWorker", () => {
  // employeeId was previously written straight from client input with zero
  // ownership check — a direct API call with another tenant's employeeId
  // would succeed (confirmed cross-tenant disclosure risk, fixed).
  it("rejects an employeeId belonging to another company", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder({ plannedQuantity: "100" }) as never);
    vi.mocked(EmployeeRepository.findById).mockResolvedValue(null);

    await expect(assignWorker(actor, "jo-1", { employeeId: "emp-x", assignedQuantity: 10 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(JobOrderAssignmentRepository.createInTx).not.toHaveBeenCalled();
  });

  it("rejects an assignment that would push total assigned quantity past the planned quantity", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder({ plannedQuantity: "100" }) as never);
    vi.mocked(JobOrderAssignmentRepository.sumAssignedByJobOrderId).mockResolvedValue(80);

    await expect(assignWorker(actor, "jo-1", { employeeId: "emp-1", assignedQuantity: 30 })).rejects.toMatchObject({
      code: "OVER_PRODUCTION_NOT_ALLOWED",
    });
    expect(JobOrderAssignmentRepository.createInTx).not.toHaveBeenCalled();
  });

  it("allows an assignment that exactly fills the remaining planned quantity", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder({ plannedQuantity: "100" }) as never);
    vi.mocked(JobOrderAssignmentRepository.sumAssignedByJobOrderId).mockResolvedValue(80);
    vi.mocked(JobOrderAssignmentRepository.createInTx).mockResolvedValue({ id: "assignment-1" } as never);

    await assignWorker(actor, "jo-1", { employeeId: "emp-1", assignedQuantity: 20 });
    expect(JobOrderAssignmentRepository.createInTx).toHaveBeenCalled();
  });
});

describe("recordProgressEntry", () => {
  // Same class of gap as assignWorker's employeeId check above, fixed the
  // same way in the same file.
  it("rejects an employeeId belonging to another company", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder({ status: "IN_PROGRESS" }) as never);
    vi.mocked(EmployeeRepository.findById).mockResolvedValue(null);

    await expect(
      recordProgressEntry(actor, "jo-1", { employeeId: "emp-x", completedQuantity: 1, rejectedQuantity: 0, damagedQuantity: 0 } as never)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(JobOrderProgressEntryRepository.createInTx).not.toHaveBeenCalled();
  });

  // Regression test for ERP-BUG-Q10-0001 (P0): logging progress that brings
  // completed+rejected+damaged to exactly plannedQuantity at an ORDINARY
  // (non-final) stage must never persist raw status "COMPLETED" — that value
  // is reserved exclusively for completeAtFinalStageInTx (see forwardJobOrder's
  // and recordQcInspection's own guards on it). Before this fix,
  // applyJobOrderQuantityDelta wrote computeJobOrderStatus()'s result
  // (which returns "COMPLETED" purely from the quantities, with no idea
  // whether the stage is final) straight to the column, making a
  // fully-processed-but-never-forwarded job order indistinguishable from one
  // that had already posted to Finished Goods — permanently blocking both
  // Forward and QC Inspection with no recovery path.
  it("keeps a fully-processed job order's status IN_PROGRESS (never COMPLETED) when the stage isn't final", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder({ status: "IN_PROGRESS" }) as never);
    vi.mocked(JobOrderRepository.findForGuardedUpdateInTx).mockResolvedValue(
      jobOrder({ status: "IN_PROGRESS", plannedQuantity: "40", completedQuantity: "25", rejectedQuantity: "0", damagedQuantity: "0" }) as never
    );
    vi.mocked(JobOrderRepository.updateInTx).mockResolvedValue({ id: "jo-1", status: "IN_PROGRESS" } as never);

    await recordProgressEntry(actor, "jo-1", { employeeId: "emp-1", completedQuantity: 15, rejectedQuantity: 0, damagedQuantity: 0 } as never);

    expect(JobOrderRepository.updateInTx).toHaveBeenCalledWith(
      expect.anything(),
      "jo-1",
      expect.objectContaining({ completedQuantity: 40, status: "IN_PROGRESS" })
    );
  });
});

describe("forwardJobOrder", () => {
  // Regression test for the original P0 fix: a job order genuinely AT a
  // final stage with raw `status` "COMPLETED" only ever got there via
  // completeAtFinalStageInTx (its quantity already posted to Finished
  // Goods) — forwarding it again used to double-post stock and silently
  // un-complete its Lot, since completeAtFinalStageInTx never bumps
  // forwardedQuantity, leaving the notYetForwarded check wide open.
  it("rejects forwarding a job order that already completed at a final stage", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(
      jobOrder({
        status: "COMPLETED",
        completedQuantity: "10",
        forwardedQuantity: "0",
        productionStage: stage({ isFinal: true }),
      }) as never
    );

    await expect(forwardJobOrder(actor, "jo-1", { quantity: 10 })).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(mockPrismaClient.productionStage.findFirst).not.toHaveBeenCalled();
  });

  // Regression test for the SECOND bug this same guard used to cause: the
  // status "COMPLETED" is also reached by ordinary progress logging the
  // moment completed+rejected+damaged hits plannedQuantity, at ANY stage —
  // not just a final one. Logging "100 of 100" in one entry at Cutting
  // (stage 1 of 6, non-final, nothing forwarded yet) used to make this
  // guard refuse to forward it at all, permanently, with a message claiming
  // it had "already reached Finished Goods" — which was false. This proves
  // a COMPLETED job order at a non-final stage can still be forwarded.
  it("still allows forwarding a job order that is COMPLETED (100% logged) at a non-final stage", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(
      jobOrder({
        status: "COMPLETED",
        completedQuantity: "100",
        plannedQuantity: "100",
        forwardedQuantity: "0",
        productionStage: stage({ isFinal: false }),
      }) as never
    );
    vi.mocked(prisma.productionStage.findFirst).mockResolvedValueOnce(
      stage({ id: "stage-2", sequence: 2, name: "Stitching", code: "SEW" }) as never
    );
    vi.mocked(ProductionOrderRepository.findAnyById).mockResolvedValue({ id: "po-1", productId: "prod-1" } as never);
    vi.mocked(prisma.jobOrder.count).mockResolvedValue(0);
    vi.mocked(prisma.jobOrder.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(JobOrderRepository.createInTx).mockResolvedValue({ id: "jo-2" } as never);
    vi.mocked(ProductionStageTransactionRepository.createInTx).mockResolvedValue({ id: "txn-1" } as never);
    vi.mocked(LotRepository.updateInTx).mockResolvedValue({} as never);

    await expect(forwardJobOrder(actor, "jo-1", { quantity: 100 })).resolves.toBeDefined();
  });

  it("rejects forwarding more than the completed-and-not-yet-forwarded quantity", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(
      jobOrder({ completedQuantity: "40", forwardedQuantity: "10" }) as never
    );

    await expect(forwardJobOrder(actor, "jo-1", { quantity: 100 })).rejects.toMatchObject({ code: "OVER_PRODUCTION_NOT_ALLOWED" });
  });

  it("requires production.approve when the target stage skips ahead of the immediate next stage", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder({ completedQuantity: "40", forwardedQuantity: "0" }) as never);
    // findImmediateNextStage is called first, then findActiveStageById(target) —
    // the immediate next stage (sequence 2) exists, but the caller targets
    // sequence 3, a skip.
    vi.mocked(prisma.productionStage.findFirst)
      .mockResolvedValueOnce(stage({ id: "stage-2", sequence: 2, name: "Sewing", code: "SEW" }) as never) // findImmediateNextStage
      .mockResolvedValueOnce(stage({ id: "stage-3", sequence: 3, name: "Finishing", code: "FIN" }) as never); // findActiveStageById(target)
    vi.mocked(PermissionService.assert).mockRejectedValue(
      Object.assign(new Error("denied"), { code: "PERMISSION_DENIED" })
    );

    await expect(forwardJobOrder(actor, "jo-1", { quantity: 20, targetStageId: "stage-3" })).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    expect(PermissionService.assert).toHaveBeenCalledWith(actor.userId, "production", "approve");
  });

  it("does not require production.approve when the target is exactly the immediate next stage", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder({ completedQuantity: "40", forwardedQuantity: "0" }) as never);
    vi.mocked(prisma.productionStage.findFirst)
      .mockResolvedValueOnce(stage({ id: "stage-2", sequence: 2, name: "Sewing", code: "SEW" }) as never)
      .mockResolvedValueOnce(stage({ id: "stage-2", sequence: 2, name: "Sewing", code: "SEW" }) as never);
    vi.mocked(ProductionOrderRepository.findAnyById).mockResolvedValue({ id: "po-1", productId: "prod-1" } as never);
    vi.mocked(prisma.jobOrder.count).mockResolvedValue(0);
    vi.mocked(prisma.jobOrder.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(JobOrderRepository.createInTx).mockResolvedValue({ id: "jo-2" } as never);
    const { ProductionStageTransactionRepository, LotRepository } = await import("./production.repository");
    vi.mocked(ProductionStageTransactionRepository.createInTx).mockResolvedValue({ id: "txn-1" } as never);
    vi.mocked(LotRepository.updateInTx).mockResolvedValue({} as never);

    await forwardJobOrder(actor, "jo-1", { quantity: 20, targetStageId: "stage-2" });
    expect(PermissionService.assert).not.toHaveBeenCalled();
  });

  // Regression test for the P3 fix: landing on a final stage returns the
  // freshly-completed job order (status COMPLETED, completedQuantity set),
  // not the pre-mutation object postStageTransactionInTx originally created
  // it as (status PENDING, completedQuantity 0).
  it("returns the freshly-completed job order, not the stale pre-mutation object, when the target stage is final", async () => {
    vi.mocked(JobOrderRepository.findAnyById)
      .mockResolvedValueOnce(jobOrder({ completedQuantity: "10", forwardedQuantity: "0" }) as never) // the job order being forwarded
      .mockResolvedValueOnce({ id: "jo-2", status: "COMPLETED", completedQuantity: "10" } as never); // the post-completion re-fetch
    vi.mocked(prisma.productionStage.findFirst).mockResolvedValue(stage({ id: "stage-2", sequence: 2, isFinal: true, name: "Packing", code: "PAK" }) as never);
    vi.mocked(ProductionOrderRepository.findAnyById).mockResolvedValue({ id: "po-1", productId: "prod-1" } as never);
    vi.mocked(prisma.jobOrder.count).mockResolvedValue(0);
    vi.mocked(prisma.jobOrder.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(JobOrderRepository.createInTx).mockResolvedValue({ id: "jo-2", status: "PENDING", completedQuantity: "0" } as never);
    vi.mocked(ProductionStageTransactionRepository.createInTx).mockResolvedValue({ id: "txn-1" } as never);
    vi.mocked(LotRepository.updateInTx).mockResolvedValue({} as never);

    const result = await forwardJobOrder(actor, "jo-1", { quantity: 10, finishedGoodsWarehouseId: "wh-1" });

    expect(JobOrderRepository.findAnyById).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ id: "jo-2", status: "COMPLETED", completedQuantity: "10" });
  });
});

describe("revertJobOrder", () => {
  it("rejects a target stage that isn't earlier than the current stage", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder({ productionStage: stage({ sequence: 2 }) }) as never);
    vi.mocked(prisma.productionStage.findFirst).mockResolvedValue(stage({ id: "stage-2", sequence: 2 }) as never);

    await expect(revertJobOrder(actor, "jo-1", { targetStageId: "stage-2", quantity: 10, reason: "test" })).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
    });
  });

  it("rejects reverting into a stage with allowRework=false", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder({ productionStage: stage({ sequence: 3 }) }) as never);
    vi.mocked(prisma.productionStage.findFirst).mockResolvedValue(stage({ id: "stage-1", sequence: 1, allowRework: false }) as never);

    await expect(revertJobOrder(actor, "jo-1", { targetStageId: "stage-1", quantity: 10, reason: "test" })).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
    });
  });

  it("rejects reverting more than the unprocessed remaining quantity", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(
      jobOrder({ productionStage: stage({ sequence: 3 }), plannedQuantity: "100", completedQuantity: "90" }) as never
    );
    vi.mocked(prisma.productionStage.findFirst).mockResolvedValue(stage({ id: "stage-1", sequence: 1 }) as never);

    await expect(revertJobOrder(actor, "jo-1", { targetStageId: "stage-1", quantity: 50, reason: "test" })).rejects.toMatchObject({
      code: "OVER_PRODUCTION_NOT_ALLOWED",
    });
  });
});

describe("recordQcInspection", () => {
  // Same original P0 fix as forwardJobOrder — a job order genuinely AT a
  // final stage, already completed there, must not be inspectable again
  // (it already reached Finished Goods; re-inspecting it previously
  // desynced the FG/WIP ledgers).
  it("rejects inspecting a job order that already completed at a final stage", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(
      jobOrder({
        status: "COMPLETED",
        completedQuantity: "10",
        forwardedQuantity: "0",
        qcPassedQuantity: "0",
        productionStage: stage({ isFinal: true }),
      }) as never
    );

    await expect(
      recordQcInspection(actor, "jo-1", {
        inspectedQuantity: 5,
        acceptedQuantity: 0,
        rejectedQuantity: 0,
        damagedQuantity: 5,
        result: "FAIL",
        damageWarehouseId: "wh-1",
        defects: [],
      } as never)
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });

    expect(QcInspectionRepository.createWithDefectsInTx).not.toHaveBeenCalled();
  });

  // Regression test for the SECOND false-positive this same guard caused —
  // see the matching test on forwardJobOrder. A job order 100% logged at a
  // non-final stage is genuinely COMPLETED but has real, un-inspected work
  // still sitting there; QC must still be able to act on it.
  it("still allows inspecting a job order that is COMPLETED (100% logged) at a non-final stage", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(
      jobOrder({
        status: "COMPLETED",
        completedQuantity: "10",
        plannedQuantity: "10",
        forwardedQuantity: "0",
        qcPassedQuantity: "0",
        productionStage: stage({ isFinal: false }),
      }) as never
    );
    vi.mocked(ProductionOrderRepository.findAnyById).mockResolvedValue({ id: "po-1", productId: "prod-1" } as never);
    mockPrismaClient.jobOrder.updateMany.mockResolvedValue({ count: 1 } as never);
    vi.mocked(QcInspectionRepository.createWithDefectsInTx).mockResolvedValue({ id: "qc-1" } as never);

    await expect(
      recordQcInspection(actor, "jo-1", {
        inspectedQuantity: 10,
        acceptedQuantity: 0,
        rejectedQuantity: 0,
        damagedQuantity: 0,
        result: "PASS",
        defects: [],
      } as never)
    ).resolves.toBeDefined();
    expect(QcInspectionRepository.createWithDefectsInTx).toHaveBeenCalled();
  });

  // Regression test for ERP-BUG-0001: accepting at QC after the same
  // completed quantity was already sent on via a manual Forward previously
  // created a second, phantom downstream job order and double-posted
  // Finished-Goods stock. Must now be rejected up front, before any write.
  it("rejects inspecting quantity that has already been forwarded to the next stage", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(
      jobOrder({ completedQuantity: "5", forwardedQuantity: "5", qcPassedQuantity: "0" }) as never
    );

    await expect(
      recordQcInspection(actor, "jo-1", {
        inspectedQuantity: 5,
        acceptedQuantity: 5,
        rejectedQuantity: 0,
        damagedQuantity: 0,
        result: "PASS",
        defects: [],
      } as never)
    ).rejects.toMatchObject({ code: "OVER_PRODUCTION_NOT_ALLOWED" });

    expect(mockPrismaClient.productionStage.findFirst).not.toHaveBeenCalled();
    expect(QcInspectionRepository.createWithDefectsInTx).not.toHaveBeenCalled();
  });

  // Regression test for ERP-BUG-0002: recording a rejected/damaged QC
  // disposition against a fully-completed job order (completed === planned,
  // the normal precondition for running QC) used to crash on the
  // job_orders_quantity_consistency_check CHECK constraint because it tried
  // to shrink plannedQuantity while completedQuantity stayed fixed. It must
  // now succeed by reclassifying quantity out of completed and into
  // rejected, leaving completed+rejected+damaged (and therefore the CHECK
  // constraint) unchanged.
  it("reclassifies rejected quantity out of completed instead of shrinking planned, on an already fully-completed job order", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(
      jobOrder({
        plannedQuantity: "100",
        completedQuantity: "100",
        rejectedQuantity: "0",
        damagedQuantity: "0",
        forwardedQuantity: "0",
        qcPassedQuantity: "0",
        productionStage: stage({ sequence: 3 }),
      }) as never
    );
    mockPrismaClient.productionStage.findFirst.mockResolvedValueOnce(stage({ id: "stage-1", sequence: 1, name: "Cutting" }) as never); // reworkTargetStage lookup
    mockPrismaClient.jobOrder.updateMany.mockResolvedValue({ count: 1 } as never); // guardedIncrementQcPassed
    mockPrismaClient.jobOrder.count.mockResolvedValue(0); // postStageTransactionInTx's priorAtStage count
    vi.mocked(JobOrderRepository.createInTx).mockResolvedValue({ id: "jo-rework-1" } as never);
    vi.mocked(ProductionStageTransactionRepository.createInTx).mockResolvedValue({ id: "txn-1" } as never);
    vi.mocked(LotRepository.updateInTx).mockResolvedValue({} as never);
    vi.mocked(JobOrderRepository.findForGuardedUpdateInTx).mockResolvedValue(
      jobOrder({ plannedQuantity: "100", completedQuantity: "100", rejectedQuantity: "0", damagedQuantity: "0" }) as never
    );
    vi.mocked(JobOrderRepository.updateInTx).mockResolvedValue({} as never);
    vi.mocked(ProductionOrderRepository.findAnyById).mockResolvedValue({ id: "po-1", productId: "prod-1" } as never);
    vi.mocked(QcInspectionRepository.createWithDefectsInTx).mockResolvedValue({ id: "qc-1" } as never);

    await recordQcInspection(actor, "jo-1", {
      inspectedQuantity: 20,
      acceptedQuantity: 0,
      rejectedQuantity: 20,
      damagedQuantity: 0,
      result: "FAIL",
      reworkTargetStageId: "stage-1",
      defects: [],
    } as never);

    expect(JobOrderRepository.updateInTx).toHaveBeenCalledWith(
      expect.anything(),
      "jo-1",
      expect.objectContaining({ completedQuantity: 80, rejectedQuantity: 20, damagedQuantity: 0 })
    );
    // plannedQuantity must never be touched by this path — that's the exact
    // mutation that violated the CHECK constraint.
    expect(JobOrderRepository.updateInTx).not.toHaveBeenCalledWith(
      expect.anything(),
      "jo-1",
      expect.objectContaining({ plannedQuantity: expect.anything() })
    );
    // Regression test for ERP-BUG-Q10-0001 (P0): completed+rejected+damaged
    // still totals plannedQuantity (80+20+0=100) after this disposition, so
    // computeJobOrderStatus alone would say "COMPLETED" — but this is a QC
    // disposition on a non-final rework stage (sequence 3, not final), not a
    // final-stage completion, so the raw status column must stay IN_PROGRESS.
    expect(JobOrderRepository.updateInTx).toHaveBeenCalledWith(
      expect.anything(),
      "jo-1",
      expect.objectContaining({ status: "IN_PROGRESS" })
    );
  });
});

describe("recordAdjustmentEntry", () => {
  // Regression test for the P1 fix: this used to pass actor.userId (a User
  // id) straight through as employeeId (a required FK to Employee), which
  // failed the job_order_progress_entries_employee_id_fkey constraint on
  // every single call unless a User happened to share a UUID with an
  // Employee row. It must now resolve the acting user's own linked Employee
  // via User.employeeId instead.
  it("resolves employeeId from the acting user's linked Employee, not the raw user id", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder({ plannedQuantity: "100" }) as never);
    mockPrismaClient.user.findUnique.mockResolvedValue({ employeeId: "emp-42" } as never);
    vi.mocked(JobOrderRepository.findForGuardedUpdateInTx).mockResolvedValue(
      jobOrder({ plannedQuantity: "100", completedQuantity: "40" }) as never
    );
    vi.mocked(JobOrderRepository.updateInTx).mockResolvedValue({} as never);

    await recordAdjustmentEntry(actor, "jo-1", { completedQuantity: 5, rejectedQuantity: 0, damagedQuantity: 0, remarks: "correction" });

    expect(mockPrismaClient.user.findUnique).toHaveBeenCalledWith({ where: { id: actor.userId }, select: { employeeId: true } });
    expect(JobOrderProgressEntryRepository.createInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ employeeId: "emp-42", recordedByUserId: actor.userId, isAdjustment: true })
    );
  });

  it("records employeeId as null rather than crashing when the acting user has no linked Employee", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder({ plannedQuantity: "100" }) as never);
    mockPrismaClient.user.findUnique.mockResolvedValue({ employeeId: null } as never);
    vi.mocked(JobOrderRepository.findForGuardedUpdateInTx).mockResolvedValue(
      jobOrder({ plannedQuantity: "100", completedQuantity: "40" }) as never
    );
    vi.mocked(JobOrderRepository.updateInTx).mockResolvedValue({} as never);

    await recordAdjustmentEntry(actor, "jo-1", { completedQuantity: 5, rejectedQuantity: 0, damagedQuantity: 0, remarks: "correction" });

    expect(JobOrderProgressEntryRepository.createInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ employeeId: null })
    );
  });
});

describe("getJobOrderById — branch access enforcement (2026-09-15)", () => {
  it("succeeds for a job order whose lot is inside the user's allowed branches", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(
      jobOrder({ lot: { id: "lot-1", lotNumber: "L-1", productionOrderId: "po-1", branchId: "branch-1" } }) as never
    );
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(new Set(["branch-1"]));

    const result = await getJobOrderById("co-1", "jo-1", "user-1");
    expect(result.id).toBe("jo-1");
  });

  it("throws NOT_FOUND for a job order whose lot is outside the user's allowed branches", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(
      jobOrder({ lot: { id: "lot-1", lotNumber: "L-1", productionOrderId: "po-1", branchId: "branch-2" } }) as never
    );
    vi.mocked(PermissionService.getAllowedBranchIds).mockResolvedValue(new Set(["branch-1"]));

    await expect(getJobOrderById("co-1", "jo-1", "user-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("skips the branch check entirely when no userId is supplied (an internal caller)", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(
      jobOrder({ lot: { id: "lot-1", lotNumber: "L-1", productionOrderId: "po-1", branchId: "branch-2" } }) as never
    );

    const result = await getJobOrderById("co-1", "jo-1");
    expect(result.id).toBe("jo-1");
    expect(PermissionService.getAllowedBranchIds).not.toHaveBeenCalled();
  });
});
