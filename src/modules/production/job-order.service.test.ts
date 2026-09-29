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
  jobOrder: { count: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
  lot: { findUniqueOrThrow: vi.fn() },
  user: { findUnique: vi.fn() },
  // Backs getProductionSettings() — every existing test relies on the
  // hardcoded defaults (pieceRateTrackingEnabled/supervisorApprovalRequired
  // both false) by leaving this unmocked (findUnique() then resolves
  // undefined), so none of the new Piece-Rate/approval-gate branches this
  // file's own service now has are ever entered unless a test explicitly
  // stubs a resolved value.
  productionSettings: { findUnique: vi.fn() },
  jobOrderAssignment: { findUnique: vi.fn() },
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
    findByJobOrderAndEmployee: vi.fn(),
  },
  JobOrderProgressEntryRepository: { createInTx: vi.fn() },
  ProductionOrderRepository: { findAnyById: vi.fn() },
  LotRepository: { findAnyById: vi.fn(), updateInTx: vi.fn() },
  ProductionStageTransactionRepository: { createInTx: vi.fn() },
  QcInspectionRepository: { createWithDefectsInTx: vi.fn() },
}));
// Piece-Rate (2026-09-18) — mocked at the module boundary so these tests
// never need to exercise the real rate-resolution/earning-ledger machinery
// (already covered by piece-rate-resolution.service.test.ts and
// piece-rate-earning.service.test.ts of their own) — only whether
// job-order.service.ts calls them correctly when ProductionSettings turns
// the feature on.
vi.mock("./piece-rate-resolution.service", () => ({ resolvePieceRate: vi.fn() }));
// Worker-assignment capacity (2026-09-28) — mocked at the module boundary;
// the real rules are covered by assignment-capacity.test.ts.
vi.mock("./assignment-capacity", () => ({
  computeAvailableToCommit: vi.fn(),
  assertEntryWithinAssignmentInTx: vi.fn(),
  syncAssignmentStatusInTx: vi.fn(),
}));
vi.mock("./piece-rate-earning.service", () => ({
  generateEarningForJobOrderProgress: vi.fn(),
  generateEarningsForQcAcceptance: vi.fn(),
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
const { resolvePieceRate } = await import("./piece-rate-resolution.service");
const { generateEarningForJobOrderProgress, generateEarningsForQcAcceptance } = await import("./piece-rate-earning.service");
const { computeAvailableToCommit, assertEntryWithinAssignmentInTx, syncAssignmentStatusInTx } = await import("./assignment-capacity");
const { computeJobOrderStatus, assignWorker, recordProgressEntry, forwardJobOrder, revertJobOrder, recordQcInspection, recordAdjustmentEntry, getJobOrderById, prepareLotStartAssignments, submitSelfProgressEntry } = await import("./job-order.service");

const actor = { companyId: "co-1", userId: "user-1" };

// Every mocked worker holds the fixture stages, so assignment tests pass the Work Skills check.
const ALL_SKILLS = [{ productionStageId: "stage-1" }, { productionStageId: "stage-cut" }];

function stage(
  overrides: Partial<{ id: string; sequence: number; isActive: boolean; allowRework: boolean; isFinal: boolean; name: string; code: string; allowsExtraQuantity: boolean }> = {}
) {
  return { id: "stage-1", sequence: 1, isActive: true, allowRework: true, isFinal: false, name: "Stage", code: "STG", allowsExtraQuantity: false, ...overrides };
}

const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const assignInput = (overrides: Record<string, unknown> = {}) =>
  ({ employeeId: "emp-1", assignedQuantity: 10, expectedEndAt: FUTURE, ...overrides }) as never;
const progressInput = (overrides: Record<string, unknown> = {}) =>
  ({ jobOrderAssignmentId: "asg-1", completedQuantity: 1, rejectedQuantity: 0, damagedQuantity: 0, extraQuantity: 0, ...overrides }) as never;

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
    extraQuantity: "0",
    forwardedQuantity: "0",
    qcPassedQuantity: "0",
    assignments: [{ id: "asg-1", employeeId: "emp-1", status: "ASSIGNED", assignedQuantity: "50" }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(JobOrderRepository.findAnyById).mockReset();
  vi.mocked(EmployeeRepository.findById).mockReset().mockResolvedValue({ id: "emp-1", workSkills: ALL_SKILLS, fullName: "Asha", isActive: true } as never);
  vi.mocked(computeAvailableToCommit).mockReset().mockResolvedValue({ available: 100, capacity: 100, done: 0, unworkedInternal: 0, pendingExternal: 0 });
  vi.mocked(assertEntryWithinAssignmentInTx).mockReset().mockResolvedValue({ assignment: {} as never, assigned: 50, consumedAfter: 1 });
  vi.mocked(syncAssignmentStatusInTx).mockReset().mockResolvedValue({} as never);
  vi.mocked(JobOrderAssignmentRepository.sumAssignedByJobOrderId).mockReset();
  vi.mocked(JobOrderAssignmentRepository.createInTx).mockReset();
  vi.mocked(JobOrderAssignmentRepository.findAnyById)
    .mockReset()
    .mockResolvedValue({ id: "asg-1", jobOrderId: "jo-1", employeeId: "emp-1", status: "ASSIGNED" } as never);
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
  mockPrismaClient.jobOrder.findMany.mockReset();
  mockPrismaClient.lot.findUniqueOrThrow.mockReset();
  mockPrismaClient.user.findUnique.mockReset();
  mockPrismaClient.productionSettings.findUnique.mockReset();
  mockPrismaClient.jobOrderAssignment.findUnique.mockReset();
  vi.mocked(JobOrderProgressEntryRepository.createInTx).mockReset();
  vi.mocked(resolvePieceRate).mockReset();
  vi.mocked(generateEarningForJobOrderProgress).mockReset();
  vi.mocked(generateEarningsForQcAcceptance).mockReset();
});

/** Sets ProductionSettings for the next call to getProductionSettings() —
 * every other field defaults to this codebase's own hardcoded OFF defaults. */
function stubProductionSettings(overrides: Record<string, unknown> = {}) {
  mockPrismaClient.productionSettings.findUnique.mockResolvedValue({
    supervisorApprovalRequired: false,
    externalEntryBy: "INTERNAL_SUPERVISOR",
    pieceRateTrackingEnabled: false,
    pieceRatePaymentQuantityRule: "QC_ACCEPTED_QTY",
    workersCanViewOwnRate: false,
    ...overrides,
  } as never);
}

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

    await expect(assignWorker(actor, "jo-1", assignInput({ employeeId: "emp-x" }))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(JobOrderAssignmentRepository.createInTx).not.toHaveBeenCalled();
  });

  it("rejects an assignment above the available quantity with the exact message", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder({ plannedQuantity: "100" }) as never);
    vi.mocked(computeAvailableToCommit).mockResolvedValue({ available: 20, capacity: 100, done: 0, unworkedInternal: 80, pendingExternal: 0 });

    await expect(assignWorker(actor, "jo-1", assignInput({ assignedQuantity: 30 }))).rejects.toMatchObject({
      code: "OVER_PRODUCTION_NOT_ALLOWED",
      message: expect.stringContaining("Assigned quantity cannot be greater than available quantity"),
    });
    expect(JobOrderAssignmentRepository.createInTx).not.toHaveBeenCalled();
  });

  it("allows an assignment that exactly fills the available quantity, storing the expected time window", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder({ plannedQuantity: "100" }) as never);
    vi.mocked(computeAvailableToCommit).mockResolvedValue({ available: 20, capacity: 100, done: 0, unworkedInternal: 80, pendingExternal: 0 });
    vi.mocked(JobOrderAssignmentRepository.createInTx).mockResolvedValue({ id: "assignment-1" } as never);

    await assignWorker(actor, "jo-1", assignInput({ assignedQuantity: 20 }));
    expect(JobOrderAssignmentRepository.createInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ assignedQuantity: 20, expectedEndAt: new Date(FUTURE), expectedStartAt: expect.any(Date) })
    );
  });

  it("checks capacity under the job order's row lock (inside the transaction)", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder() as never);
    vi.mocked(JobOrderRepository.findForGuardedUpdateInTx).mockResolvedValue(jobOrder() as never);
    vi.mocked(JobOrderAssignmentRepository.createInTx).mockResolvedValue({ id: "assignment-1" } as never);

    await assignWorker(actor, "jo-1", assignInput());
    expect(JobOrderRepository.findForGuardedUpdateInTx).toHaveBeenCalledWith(expect.anything(), "jo-1");
  });

  it("rejects assigning on a cancelled or on-hold job order", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder({ status: "CANCELLED" }) as never);
    await expect(assignWorker(actor, "jo-1", assignInput())).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder({ status: "ON_HOLD" }) as never);
    await expect(assignWorker(actor, "jo-1", assignInput())).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("rejects an inactive worker", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder() as never);
    vi.mocked(EmployeeRepository.findById).mockResolvedValue({ id: "emp-1", workSkills: ALL_SKILLS, fullName: "Asha", isActive: false } as never);
    await expect(assignWorker(actor, "jo-1", assignInput())).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects an expected completion time in the past or before the expected start", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder() as never);
    const past = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await expect(assignWorker(actor, "jo-1", assignInput({ expectedStartAt: new Date(Date.now() - 3 * 3600_000).toISOString(), expectedEndAt: past }))).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("past"),
    });
    const start = new Date(Date.now() + 48 * 3600_000).toISOString();
    await expect(assignWorker(actor, "jo-1", assignInput({ expectedStartAt: start, expectedEndAt: FUTURE }))).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("after the expected start"),
    });
    expect(JobOrderAssignmentRepository.createInTx).not.toHaveBeenCalled();
  });
});

describe("recordProgressEntry", () => {
  // Same class of gap as assignWorker's employeeId check above, fixed the
  // same way in the same file.
  it("rejects an assignment whose worker doesn't belong to this company", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder({ status: "IN_PROGRESS" }) as never);
    vi.mocked(EmployeeRepository.findById).mockResolvedValue(null);

    await expect(recordProgressEntry(actor, "jo-1", progressInput())).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(JobOrderProgressEntryRepository.createInTx).not.toHaveBeenCalled();
  });

  it("blocks logging entirely when no worker has been assigned (even via a direct API call)", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder({ assignments: [] }) as never);

    await expect(recordProgressEntry(actor, "jo-1", progressInput())).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Please assign a worker before logging the production process.",
    });
    expect(JobOrderProgressEntryRepository.createInTx).not.toHaveBeenCalled();
  });

  it("rejects an assignment that belongs to a different job order", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder() as never);
    vi.mocked(JobOrderAssignmentRepository.findAnyById).mockResolvedValue({ id: "asg-9", jobOrderId: "jo-9", employeeId: "emp-9" } as never);

    await expect(recordProgressEntry(actor, "jo-1", progressInput({ jobOrderAssignmentId: "asg-9" }))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects an explicit employeeId that doesn't match the assignment's own worker", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder() as never);
    await expect(recordProgressEntry(actor, "jo-1", progressInput({ employeeId: "emp-2" }))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("always records the assignment's worker and runs the per-assignment cap before applying", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder() as never);
    vi.mocked(JobOrderRepository.findForGuardedUpdateInTx).mockResolvedValue(jobOrder() as never);
    vi.mocked(JobOrderRepository.updateInTx).mockResolvedValue({ id: "jo-1" } as never);
    vi.mocked(JobOrderProgressEntryRepository.createInTx).mockResolvedValue({ id: "entry-1" } as never);

    await recordProgressEntry(actor, "jo-1", progressInput({ completedQuantity: 5 }));

    expect(assertEntryWithinAssignmentInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ assignmentId: "asg-1", entry: { completed: 5, rejected: 0, damaged: 0, extra: 0 } })
    );
    expect(JobOrderProgressEntryRepository.createInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ employeeId: "emp-1", jobOrderAssignmentId: "asg-1" })
    );
    expect(syncAssignmentStatusInTx).toHaveBeenCalledWith(expect.anything(), "asg-1");
  });

  it("does not write anything when the per-assignment cap rejects the entry", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder() as never);
    vi.mocked(assertEntryWithinAssignmentInTx).mockRejectedValue(
      Object.assign(new Error("Completed + Rejected + Damage cannot exceed Asha's assigned pieces."), { code: "OVER_PRODUCTION_NOT_ALLOWED" })
    );
    await expect(recordProgressEntry(actor, "jo-1", progressInput({ completedQuantity: 999 }))).rejects.toMatchObject({
      code: "OVER_PRODUCTION_NOT_ALLOWED",
    });
    expect(JobOrderRepository.updateInTx).not.toHaveBeenCalled();
    expect(JobOrderProgressEntryRepository.createInTx).not.toHaveBeenCalled();
  });

  it("widens the job order's capacity by explicitly-recorded extra pieces (Cutting)", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(
      jobOrder({ productionStage: stage({ allowsExtraQuantity: true, name: "Cutting" }) }) as never
    );
    vi.mocked(JobOrderRepository.findForGuardedUpdateInTx).mockResolvedValue(
      jobOrder({ plannedQuantity: "100", completedQuantity: "0" }) as never
    );
    vi.mocked(JobOrderRepository.updateInTx).mockResolvedValue({ id: "jo-1" } as never);
    vi.mocked(JobOrderProgressEntryRepository.createInTx).mockResolvedValue({ id: "entry-1" } as never);

    await recordProgressEntry(actor, "jo-1", progressInput({ completedQuantity: 105, extraQuantity: 5 }));

    expect(JobOrderRepository.updateInTx).toHaveBeenCalledWith(
      expect.anything(),
      "jo-1",
      expect.objectContaining({ completedQuantity: 105, extraQuantity: 5 })
    );
  });

  it("still rejects an over-count with no extra recorded (never silently added)", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder() as never);
    vi.mocked(JobOrderRepository.findForGuardedUpdateInTx).mockResolvedValue(
      jobOrder({ plannedQuantity: "100", completedQuantity: "0" }) as never
    );
    await expect(recordProgressEntry(actor, "jo-1", progressInput({ completedQuantity: 105 }))).rejects.toMatchObject({
      code: "OVER_PRODUCTION_NOT_ALLOWED",
    });
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

    await recordProgressEntry(actor, "jo-1", progressInput({ completedQuantity: 15 }));

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
    mockPrismaClient.lot.findUniqueOrThrow.mockResolvedValue({ quantity: "10" } as never);
    mockPrismaClient.jobOrder.findMany.mockResolvedValue([
      { completedQuantity: "10", rejectedQuantity: "0", damagedQuantity: "0", productionStage: { isFinal: true } },
    ] as never);

    const result = await forwardJobOrder(actor, "jo-1", { quantity: 10, finishedGoodsWarehouseId: "wh-1" });

    expect(JobOrderRepository.findAnyById).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ id: "jo-2", status: "COMPLETED", completedQuantity: "10" });
    expect(LotRepository.updateInTx).toHaveBeenCalledWith(expect.anything(), "lot-1", { status: "COMPLETED" });
  });

  // Regression test for the bug this session found live: PROD-2026-00008-L01
  // (lot quantity 22) had a 1-pc rework batch reach Packing (isFinal) while
  // 20 pcs still sat completed-but-unforwarded at Finishing. The old code
  // set Lot.status to COMPLETED on ANY final-stage arrival, regardless of
  // how much of the lot's total quantity that batch represented — which then
  // made canAct (PLANNED/IN_PROGRESS only) hide Forward on every other
  // JobOrder for the lot, stranding the remaining 20 pcs with no way to
  // reach Packing at all.
  it("does not complete the Lot when a partial batch reaches a final stage while the rest of the lot is still mid-pipeline", async () => {
    vi.mocked(JobOrderRepository.findAnyById)
      .mockResolvedValueOnce(jobOrder({ id: "jo-1", completedQuantity: "1", forwardedQuantity: "0", plannedQuantity: "1" }) as never)
      .mockResolvedValueOnce({ id: "jo-2", status: "COMPLETED", completedQuantity: "1" } as never);
    vi.mocked(prisma.productionStage.findFirst).mockResolvedValue(stage({ id: "stage-2", sequence: 2, isFinal: true, name: "Packing", code: "PAK" }) as never);
    vi.mocked(ProductionOrderRepository.findAnyById).mockResolvedValue({ id: "po-1", productId: "prod-1" } as never);
    vi.mocked(prisma.jobOrder.count).mockResolvedValue(0);
    vi.mocked(prisma.jobOrder.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(JobOrderRepository.createInTx).mockResolvedValue({ id: "jo-2", status: "PENDING", completedQuantity: "0" } as never);
    vi.mocked(ProductionStageTransactionRepository.createInTx).mockResolvedValue({ id: "txn-1" } as never);
    vi.mocked(LotRepository.updateInTx).mockResolvedValue({} as never);
    // Lot quantity 22 — this batch only accounts for 1 pc at the final stage,
    // 20 more sit completed-but-unforwarded at a non-final "Finishing" stage.
    mockPrismaClient.lot.findUniqueOrThrow.mockResolvedValue({ quantity: "22" } as never);
    mockPrismaClient.jobOrder.findMany.mockResolvedValue([
      { completedQuantity: "20", rejectedQuantity: "0", damagedQuantity: "0", productionStage: { isFinal: false } }, // Finishing, stuck
      { completedQuantity: "1", rejectedQuantity: "0", damagedQuantity: "0", productionStage: { isFinal: true } }, // this Packing batch
    ] as never);

    await forwardJobOrder(actor, "jo-1", { quantity: 1, finishedGoodsWarehouseId: "wh-1" });

    // postStageTransactionInTx always bumps currentStageId/IN_PROGRESS on
    // every forward — the regression under test is that nothing separately
    // calls it again with status COMPLETED for this still-in-flight lot.
    expect(LotRepository.updateInTx).not.toHaveBeenCalledWith(expect.anything(), "lot-1", { status: "COMPLETED" });
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

describe("assignWorker — Piece-Rate rate snapshot (2026-09-18)", () => {
  it("behaves exactly as before when ProductionSettings.pieceRateTrackingEnabled is off (the default)", async () => {
    stubProductionSettings({ pieceRateTrackingEnabled: false });
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder({ plannedQuantity: "100" }) as never);
    vi.mocked(EmployeeRepository.findById).mockResolvedValue({ id: "emp-1", workSkills: ALL_SKILLS, payType: "PIECE_RATE", isActive: true } as never);
    vi.mocked(JobOrderAssignmentRepository.sumAssignedByJobOrderId).mockResolvedValue(0);
    vi.mocked(JobOrderAssignmentRepository.createInTx).mockResolvedValue({ id: "assignment-1" } as never);

    await assignWorker(actor, "jo-1", assignInput());

    expect(resolvePieceRate).not.toHaveBeenCalled();
    expect(JobOrderAssignmentRepository.createInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.objectContaining({ resolvedRate: expect.anything() })
    );
  });

  it("blocks the assignment when tracking is on, the employee is PIECE_RATE, and no rate resolves — never a silent 0", async () => {
    stubProductionSettings({ pieceRateTrackingEnabled: true });
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder({ plannedQuantity: "100" }) as never);
    vi.mocked(EmployeeRepository.findById).mockResolvedValue({ id: "emp-1", workSkills: ALL_SKILLS, payType: "PIECE_RATE", isActive: true } as never);
    vi.mocked(JobOrderAssignmentRepository.sumAssignedByJobOrderId).mockResolvedValue(0);
    vi.mocked(ProductionOrderRepository.findAnyById).mockResolvedValue({ id: "po-1", productId: "prod-1" } as never);
    vi.mocked(resolvePieceRate).mockResolvedValue({ resolved: false });

    await expect(
      assignWorker(actor, "jo-1", assignInput({ productionOperationId: "op-1" }))
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(JobOrderAssignmentRepository.createInTx).not.toHaveBeenCalled();
  });

  it("snapshots the resolved rate onto the assignment when tracking is on and a rate resolves", async () => {
    stubProductionSettings({ pieceRateTrackingEnabled: true });
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder({ plannedQuantity: "100" }) as never);
    vi.mocked(EmployeeRepository.findById).mockResolvedValue({ id: "emp-1", workSkills: ALL_SKILLS, payType: "PIECE_RATE", isActive: true } as never);
    vi.mocked(JobOrderAssignmentRepository.sumAssignedByJobOrderId).mockResolvedValue(0);
    vi.mocked(ProductionOrderRepository.findAnyById).mockResolvedValue({ id: "po-1", productId: "prod-1" } as never);
    vi.mocked(resolvePieceRate).mockResolvedValue({ resolved: true, rate: 2.5, source: "STYLE_OPERATION_DEFAULT", rateCardId: "card-1" });
    vi.mocked(JobOrderAssignmentRepository.createInTx).mockResolvedValue({ id: "assignment-1" } as never);

    await assignWorker(actor, "jo-1", assignInput({ productionOperationId: "op-1" }));

    expect(JobOrderAssignmentRepository.createInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ resolvedRate: 2.5, resolvedRateSource: "STYLE_OPERATION_DEFAULT", resolvedRateCardId: "card-1", rateOverridden: false })
    );
  });

  it("requires piece_rate.override permission when an authorized override rate is supplied", async () => {
    stubProductionSettings({ pieceRateTrackingEnabled: true });
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder({ plannedQuantity: "100" }) as never);
    vi.mocked(EmployeeRepository.findById).mockResolvedValue({ id: "emp-1", workSkills: ALL_SKILLS, payType: "PIECE_RATE", isActive: true } as never);
    vi.mocked(JobOrderAssignmentRepository.sumAssignedByJobOrderId).mockResolvedValue(0);
    vi.mocked(ProductionOrderRepository.findAnyById).mockResolvedValue({ id: "po-1", productId: "prod-1" } as never);
    vi.mocked(resolvePieceRate).mockResolvedValue({ resolved: false });
    vi.mocked(JobOrderAssignmentRepository.createInTx).mockResolvedValue({ id: "assignment-1" } as never);

    await assignWorker(actor, "jo-1", assignInput({ productionOperationId: "op-1", overriddenRate: 3, overrideReason: "Negotiated rate" }));

    expect(PermissionService.assert).toHaveBeenCalledWith(actor.userId, "piece_rate", "override");
    expect(JobOrderAssignmentRepository.createInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ rateOverridden: true, overriddenRate: 3, overrideReason: "Negotiated rate" })
    );
  });
});

describe("recordProgressEntry — company-wide supervisor-approval-required setting (2026-09-18)", () => {
  it("routes through the PENDING+approve queue instead of applying immediately when the setting is on", async () => {
    stubProductionSettings({ supervisorApprovalRequired: true });
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder({ status: "IN_PROGRESS" }) as never);
    vi.mocked(EmployeeRepository.findById).mockResolvedValue({ id: "emp-1", workSkills: ALL_SKILLS } as never);
    vi.mocked(JobOrderProgressEntryRepository.createInTx).mockResolvedValue({ id: "entry-1", approvalStatus: "PENDING" } as never);

    const result = await recordProgressEntry(actor, "jo-1", progressInput({ completedQuantity: 10 }));

    expect(result).toEqual({ status: "PENDING", entry: { id: "entry-1", approvalStatus: "PENDING" } });
    expect(JobOrderRepository.updateInTx).not.toHaveBeenCalled();
    // A pending claim is still capped against the assignment, but never
    // closes the assignment until it is actually approved.
    expect(assertEntryWithinAssignmentInTx).toHaveBeenCalled();
    expect(syncAssignmentStatusInTx).not.toHaveBeenCalled();
    expect(JobOrderProgressEntryRepository.createInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ enteredBy: "SUPERVISOR", approvalStatus: "PENDING", jobOrderAssignmentId: "asg-1" })
    );
  });

  it("applies immediately (unchanged, pre-existing behavior) when the setting is off", async () => {
    stubProductionSettings({ supervisorApprovalRequired: false });
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder({ status: "IN_PROGRESS" }) as never);
    vi.mocked(EmployeeRepository.findById).mockResolvedValue({ id: "emp-1", workSkills: ALL_SKILLS } as never);
    vi.mocked(JobOrderRepository.findForGuardedUpdateInTx).mockResolvedValue(
      jobOrder({ status: "IN_PROGRESS", plannedQuantity: "40", completedQuantity: "25", rejectedQuantity: "0", damagedQuantity: "0" }) as never
    );
    vi.mocked(JobOrderRepository.updateInTx).mockResolvedValue({ id: "jo-1", status: "IN_PROGRESS" } as never);

    const result = await recordProgressEntry(actor, "jo-1", progressInput({ completedQuantity: 15 }));

    expect(result.status).toBe("APPLIED");
    expect(JobOrderRepository.updateInTx).toHaveBeenCalled();
  });
});

describe("recordQcInspection — Piece-Rate earning trigger (2026-09-18)", () => {
  function stubQcAcceptPath() {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(
      jobOrder({ completedQuantity: "100", qcPassedQuantity: "0", forwardedQuantity: "0", productionStage: stage({ sequence: 1 }) }) as never
    );
    mockPrismaClient.productionStage.findFirst.mockResolvedValue(stage({ id: "stage-2", sequence: 2 }) as never); // findImmediateNextStage
    mockPrismaClient.jobOrder.updateMany.mockResolvedValue({ count: 1 } as never); // guardedIncrementQcPassed / guardedIncrementForwarded
    mockPrismaClient.jobOrder.count.mockResolvedValue(0); // postStageTransactionInTx's priorAtStage count
    vi.mocked(ProductionOrderRepository.findAnyById).mockResolvedValue({ id: "po-1", productId: "prod-1" } as never);
    vi.mocked(JobOrderRepository.createInTx).mockResolvedValue({ id: "jo-next" } as never);
    vi.mocked(ProductionStageTransactionRepository.createInTx).mockResolvedValue({ id: "txn-1" } as never);
    vi.mocked(LotRepository.updateInTx).mockResolvedValue({} as never);
    vi.mocked(QcInspectionRepository.createWithDefectsInTx).mockResolvedValue({ id: "qc-1" } as never);
  }

  it("calls generateEarningsForQcAcceptance when tracking is enabled and some quantity was accepted", async () => {
    stubProductionSettings({ pieceRateTrackingEnabled: true });
    stubQcAcceptPath();

    await recordQcInspection(actor, "jo-1", {
      inspectedQuantity: 80,
      acceptedQuantity: 80,
      rejectedQuantity: 0,
      damagedQuantity: 0,
      result: "PASS",
      defects: [],
    } as never);

    expect(generateEarningsForQcAcceptance).toHaveBeenCalledWith(
      mockPrismaClient,
      expect.objectContaining({ companyId: "co-1", jobOrderId: "jo-1", generatedFromQcInspectionId: "qc-1" })
    );
  });

  it("never calls generateEarningsForQcAcceptance when tracking is disabled (the default)", async () => {
    stubProductionSettings({ pieceRateTrackingEnabled: false });
    stubQcAcceptPath();

    await recordQcInspection(actor, "jo-1", {
      inspectedQuantity: 80,
      acceptedQuantity: 80,
      rejectedQuantity: 0,
      damagedQuantity: 0,
      result: "PASS",
      defects: [],
    } as never);

    expect(generateEarningsForQcAcceptance).not.toHaveBeenCalled();
  });
});

describe("prepareLotStartAssignments — no lot starts without a worker (2026-09-29)", () => {
  it("refuses a lot with no worker at all", async () => {
    await expect(prepareLotStartAssignments(actor, { productId: "prod-1", lotQuantity: 10, stage: { id: "stage-cut", name: "Cutting" } }, [])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("Cutting worker assignment, material request and material issue are required"),
    });
  });

  it("refuses assigning more pieces than the lot holds", async () => {
    await expect(
      prepareLotStartAssignments(actor, { productId: "prod-1", lotQuantity: 10, stage: { id: "stage-cut", name: "Cutting" } }, [assignInput({ assignedQuantity: 6 }), assignInput({ employeeId: "emp-2", assignedQuantity: 5 })])
    ).rejects.toMatchObject({ code: "OVER_PRODUCTION_NOT_ALLOWED" });
  });
});

describe("Work Skills — a worker can only be assigned to a stage they are skilled for (2026-09-29)", () => {
  it("assignWorker rejects a worker whose Work Skills don't include the job order's stage", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder({ plannedQuantity: "100" }) as never);
    vi.mocked(EmployeeRepository.findById).mockResolvedValue({
      id: "emp-1", fullName: "Asha", isActive: true, workSkills: [{ productionStageId: "stage-other" }],
    } as never);

    await expect(assignWorker(actor, "jo-1", assignInput())).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining('Asha does not have "Stage" in their Work Skills'),
    });
    expect(JobOrderAssignmentRepository.createInTx).not.toHaveBeenCalled();
  });

  it("assignWorker rejects a worker with no Work Skills at all", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder({ plannedQuantity: "100" }) as never);
    vi.mocked(EmployeeRepository.findById).mockResolvedValue({ id: "emp-1", fullName: "Asha", isActive: true, workSkills: [] } as never);

    await expect(assignWorker(actor, "jo-1", assignInput())).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("lot start rejects a cutting worker who lacks the Cutting skill", async () => {
    vi.mocked(EmployeeRepository.findById).mockResolvedValue({
      id: "emp-1", fullName: "Asha", isActive: true, workSkills: [{ productionStageId: "stage-1" }],
    } as never);

    await expect(
      prepareLotStartAssignments(actor, { productId: "prod-1", lotQuantity: 10, stage: { id: "stage-cut", name: "Cutting" } }, [assignInput({ assignedQuantity: 5 })])
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", message: expect.stringContaining('"Cutting" in their Work Skills') });
  });
});

describe("submitSelfProgressEntry — My Work is authorized by the Work Skill, not Production create (2026-09-29)", () => {
  const selfInput = { completedQuantity: 1, rejectedQuantity: 0, damagedQuantity: 0, extraQuantity: 0 } as never;

  beforeEach(() => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder() as never);
    mockPrismaClient.user.findUnique.mockResolvedValue({ employeeId: "emp-1" });
    vi.mocked(JobOrderAssignmentRepository.findByJobOrderAndEmployee).mockReset().mockResolvedValue({ id: "asg-1" } as never);
    vi.mocked(JobOrderProgressEntryRepository.createInTx).mockReset().mockResolvedValue({ id: "entry-1" } as never);
  });

  it("lets a self-entry worker with the stage's Work Skill submit a pending entry", async () => {
    vi.mocked(EmployeeRepository.findById).mockResolvedValue({
      id: "emp-1", fullName: "Satya", isActive: true, selfEntryEnabled: true, workSkills: [{ productionStageId: "stage-1" }],
    } as never);

    await submitSelfProgressEntry(actor, "jo-1", selfInput);

    expect(JobOrderProgressEntryRepository.createInTx).toHaveBeenCalledWith(
      mockPrismaClient,
      expect.objectContaining({ employeeId: "emp-1", enteredBy: "SELF", approvalStatus: "PENDING" })
    );
  });

  it("refuses a worker who lacks the stage's Work Skill, even when assigned", async () => {
    vi.mocked(EmployeeRepository.findById).mockResolvedValue({
      id: "emp-1", fullName: "Satya", isActive: true, selfEntryEnabled: true, workSkills: [{ productionStageId: "stage-other" }],
    } as never);

    await expect(submitSelfProgressEntry(actor, "jo-1", selfInput)).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      message: expect.stringContaining('"Stage" in your Work Skills'),
    });
    expect(JobOrderProgressEntryRepository.createInTx).not.toHaveBeenCalled();
  });
});
