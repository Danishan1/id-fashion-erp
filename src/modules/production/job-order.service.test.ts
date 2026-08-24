import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { assert: vi.fn() } }));
vi.mock("@/modules/inventory/inventory.service", () => ({ recordInventoryTransaction: vi.fn() }));

const mockPrismaClient = vi.hoisted(() => ({
  productionStage: { findFirst: vi.fn() },
  jobOrder: { count: vi.fn(), updateMany: vi.fn() },
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
const { JobOrderRepository, JobOrderAssignmentRepository, ProductionOrderRepository, ProductionStageTransactionRepository, LotRepository, QcInspectionRepository } =
  await import("./production.repository");
const { computeJobOrderStatus, assignWorker, forwardJobOrder, revertJobOrder, recordQcInspection } = await import("./job-order.service");

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
  vi.mocked(JobOrderAssignmentRepository.sumAssignedByJobOrderId).mockReset();
  vi.mocked(JobOrderAssignmentRepository.createInTx).mockReset();
  vi.mocked(ProductionOrderRepository.findAnyById).mockReset();
  vi.mocked(PermissionService.assert).mockReset().mockResolvedValue(undefined);
  vi.mocked(JobOrderRepository.findForGuardedUpdateInTx).mockReset();
  vi.mocked(JobOrderRepository.updateInTx).mockReset();
  vi.mocked(JobOrderRepository.createInTx).mockReset();
  vi.mocked(ProductionStageTransactionRepository.createInTx).mockReset();
  vi.mocked(LotRepository.updateInTx).mockReset();
  vi.mocked(QcInspectionRepository.createWithDefectsInTx).mockReset();
  mockPrismaClient.productionStage.findFirst.mockReset();
  mockPrismaClient.jobOrder.count.mockReset();
  mockPrismaClient.jobOrder.updateMany.mockReset();
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

describe("forwardJobOrder", () => {
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
  });
});
