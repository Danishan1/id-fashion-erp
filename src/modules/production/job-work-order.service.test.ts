import { beforeEach, describe, expect, it, vi } from "vitest";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ generateDocumentNumber: vi.fn() }));
// External Unit User (2026-09-18) — every existing test in this file
// exercises the INTERNAL path, so getAllowedContractorId defaults to null
// (unrestricted/internal) unless a test explicitly overrides it.
vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: { getAllowedContractorId: vi.fn().mockResolvedValue(null), assert: vi.fn(), can: vi.fn().mockResolvedValue(true) },
}));
vi.mock("@/core/production-settings/ProductionSettingsService", () => ({
  getProductionSettings: vi.fn().mockResolvedValue({
    supervisorApprovalRequired: false,
    externalEntryBy: "INTERNAL_SUPERVISOR",
    pieceRateTrackingEnabled: false,
    pieceRatePaymentQuantityRule: "QC_ACCEPTED_QTY",
    workersCanViewOwnRate: false,
  }),
}));
vi.mock("./piece-rate-resolution.service", () => ({ resolveContractorPieceRate: vi.fn() }));
vi.mock("./piece-rate-earning.service", () => ({ generateEarningForJobWorkReceipt: vi.fn() }));
vi.mock("@/modules/inventory/inventory.service", () => ({ recordInventoryTransaction: vi.fn(), getAvailableQuantity: vi.fn() }));
vi.mock("@/modules/products/product.repository", () => ({
  ProductRepository: { findMaterialById: vi.fn() },
}));
vi.mock("@/modules/lookups/lookup.repository", () => ({
  LookupRepository: { unit: { findUnique: vi.fn() } },
}));
vi.mock("@/modules/purchasing/fabric-roll.repository", () => ({
  FabricRollRepository: { findByIdWithContext: vi.fn(), guardedDecrementRemaining: vi.fn(), incrementRemaining: vi.fn() },
}));
vi.mock("@/modules/contractors/contractor.repository", () => ({
  ContractorRepository: { findById: vi.fn() },
}));
vi.mock("./job-order.service", () => ({
  applyJobOrderQuantityDelta: vi.fn(),
  assertJobOrderScope: vi.fn(),
  cascadeReceivedThroughStagesInTx: vi.fn(),
}));
// Shared worker/contractor capacity pool — real rules in assignment-capacity.test.ts.
vi.mock("./assignment-capacity", () => ({ computeAvailableToCommit: vi.fn() }));
// Stage-wise costing — the real resolver is covered by stage-cost.service.test.ts;
// here every covered stage resolves to a ₹5 Style default unless a test overrides it.
vi.mock("@/modules/stage-costs/stage-cost.service", () => ({
  resolveCostContextForProductionOrder: vi.fn(),
  resolveEffectiveStageCosts: vi.fn(),
  round2: (v: number) => Math.round(v * 100) / 100,
}));
vi.mock("./production.repository", () => ({
  JobOrderRepository: { findAnyById: vi.fn(), findForGuardedUpdateInTx: vi.fn() },
  ProductionOrderRepository: { findAnyById: vi.fn() },
}));
vi.mock("./job-work-order.repository", () => ({
  JobWorkOrderRepository: {
    findMany: vi.fn(),
    count: vi.fn(),
    findAnyById: vi.fn(),
    createWithMaterialsInTx: vi.fn(),
    update: vi.fn(),
    updateInTx: vi.fn(),
    findForGuardedUpdateInTx: vi.fn(),
    sumPendingByJobOrderId: vi.fn(),
    countActiveReceipts: vi.fn(),
  },
  JobWorkReceiptRepository: {
    createInTx: vi.fn(),
    findAnyById: vi.fn(),
    findByIdempotencyKey: vi.fn(),
    updateInTx: vi.fn(),
    findPendingForCompany: vi.fn(),
    updateApprovalStatusConditionalInTx: vi.fn(),
  },
}));

// jobWorkReceipt.findUniqueOrThrow backs approveJobWorkReceipt()'s own final
// return value -- the one spot in this module that reads straight off `tx`
// rather than through a mocked repository method (see its own describe
// block below).
const mockTx = { jobWorkOrder: {}, jobWorkReceipt: { findUniqueOrThrow: vi.fn() } };
const mockPrisma = vi.hoisted(() => ({
  productionStage: { findMany: vi.fn() },
  warehouse: { findFirst: vi.fn() },
}));
vi.mock("@/core/db/client", () => ({
  prisma: { ...mockPrisma, $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(mockTx)) },
}));

const { generateDocumentNumber } = await import("@/core/numbering/DocumentNumberingService");
const { recordInventoryTransaction, getAvailableQuantity } = await import("@/modules/inventory/inventory.service");
const { ProductRepository } = await import("@/modules/products/product.repository");
const { LookupRepository } = await import("@/modules/lookups/lookup.repository");
const { FabricRollRepository } = await import("@/modules/purchasing/fabric-roll.repository");
const { ContractorRepository } = await import("@/modules/contractors/contractor.repository");
const { applyJobOrderQuantityDelta, assertJobOrderScope, cascadeReceivedThroughStagesInTx } = await import("./job-order.service");
const { computeAvailableToCommit } = await import("./assignment-capacity");
const { resolveCostContextForProductionOrder, resolveEffectiveStageCosts } = await import("@/modules/stage-costs/stage-cost.service");
const { JobOrderRepository, ProductionOrderRepository } = await import("./production.repository");
const { JobWorkOrderRepository, JobWorkReceiptRepository } = await import("./job-work-order.repository");
const { PermissionService } = await import("@/core/rbac/PermissionService");
const { getProductionSettings } = await import("@/core/production-settings/ProductionSettingsService");
const { resolveContractorPieceRate } = await import("./piece-rate-resolution.service");
const { generateEarningForJobWorkReceipt } = await import("./piece-rate-earning.service");
const {
  createJobWorkOrder,
  receiveJobWork,
  approveJobWorkReceipt,
  reverseJobWorkReceipt,
  transitionJobWorkOrderStatus,
  resumeJobWorkOrderFromHold,
  computeJobWorkOrderMetrics,
  listPendingJobWorkReceipts,
  listJobWorkOrders,
} = await import("./job-work-order.service");

const actor = { companyId: "co-1", userId: "user-1" };

const STAGES = [
  { id: "stage-sew", code: "SEW", name: "Stitching", sequence: 2, isFinal: false, isActive: true },
  { id: "stage-fin", code: "FIN", name: "Finishing", sequence: 4, isFinal: false, isActive: true },
  { id: "stage-pak", code: "PAK", name: "Packing", sequence: 6, isFinal: true, isActive: true },
];

function jobOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "jo-1",
    companyId: "co-1",
    productionOrderId: "po-1",
    productionStageId: "stage-sew",
    productionStage: { id: "stage-sew", sequence: 2, name: "Stitching" },
    status: "IN_PROGRESS",
    plannedQuantity: 100,
    completedQuantity: 0,
    rejectedQuantity: 0,
    damagedQuantity: 0,
    ...overrides,
  };
}

function jobWorkOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "jwo-1",
    companyId: "co-1",
    jobWorkNumber: "JWO-2026-00001",
    jobOrderId: "jo-1",
    status: "ISSUED",
    issuedQuantity: 50,
    receivedQuantity: 0,
    rejectedQuantity: 0,
    damagedQuantity: 0,
    statusBeforeHold: null,
    materials: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(generateDocumentNumber).mockReset().mockResolvedValue("JWO-2026-00001");
  vi.mocked(ContractorRepository.findById).mockReset().mockResolvedValue({ id: "con-1", name: "HP Cotton", isActive: true, stages: [] } as never);
  vi.mocked(computeAvailableToCommit).mockReset().mockResolvedValue({ available: 100, capacity: 100, done: 0, unworkedInternal: 0, pendingExternal: 0 });
  vi.mocked(cascadeReceivedThroughStagesInTx).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(resolveCostContextForProductionOrder)
    .mockReset()
    .mockResolvedValue({ productId: "style-1", styleName: "Kurta", styleCode: "ST-1", sampleRequestId: null, designLabel: null });
  vi.mocked(resolveEffectiveStageCosts)
    .mockReset()
    .mockImplementation(async (_c, _co, params) => new Map(params.stageIds.map((id) => [id, { productionStageId: id, rate: 5, source: "STYLE_DEFAULT" as const }])));
  mockPrisma.productionStage.findMany.mockReset().mockResolvedValue(STAGES);
  mockPrisma.warehouse.findFirst.mockReset().mockResolvedValue({ id: "wh-fg" });
  vi.mocked(recordInventoryTransaction).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(getAvailableQuantity).mockReset().mockResolvedValue(1000);
  // Every existing test's material line uses uomId "uom-2" — set here to
  // match the material's own base UOM (the "no conversion needed" branch)
  // so pre-existing tests keep asserting the same as-entered quantities.
  // UOM conversion itself is covered by its own dedicated test below.
  vi.mocked(ProductRepository.findMaterialById)
    .mockReset()
    .mockResolvedValue({ id: "prod-1", styleName: "Test Material", baseUom: { id: "uom-2", baseUnitId: null, conversionFactor: 1 } } as never);
  vi.mocked(LookupRepository.unit.findUnique).mockReset();
  vi.mocked(FabricRollRepository.findByIdWithContext).mockReset();
  vi.mocked(FabricRollRepository.guardedDecrementRemaining).mockReset().mockResolvedValue({ count: 1 } as never);
  vi.mocked(FabricRollRepository.incrementRemaining).mockReset();
  vi.mocked(applyJobOrderQuantityDelta).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(assertJobOrderScope).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(JobOrderRepository.findAnyById).mockReset();
  vi.mocked(JobOrderRepository.findForGuardedUpdateInTx).mockReset().mockResolvedValue(jobOrder() as never);
  vi.mocked(JobWorkOrderRepository.findAnyById).mockReset();
  vi.mocked(JobWorkOrderRepository.createWithMaterialsInTx).mockReset();
  vi.mocked(JobWorkOrderRepository.update).mockReset();
  vi.mocked(JobWorkOrderRepository.updateInTx).mockReset();
  vi.mocked(JobWorkOrderRepository.findForGuardedUpdateInTx).mockReset();
  vi.mocked(JobWorkOrderRepository.sumPendingByJobOrderId).mockReset().mockResolvedValue(0);
  vi.mocked(JobWorkOrderRepository.countActiveReceipts).mockReset().mockResolvedValue(0);
  vi.mocked(JobWorkReceiptRepository.createInTx).mockReset();
  vi.mocked(JobWorkReceiptRepository.findByIdempotencyKey).mockReset().mockResolvedValue(null);
  vi.mocked(JobWorkReceiptRepository.findAnyById).mockReset();
  vi.mocked(JobWorkReceiptRepository.updateInTx).mockReset();
  vi.mocked(JobWorkReceiptRepository.findPendingForCompany).mockReset().mockResolvedValue([]);
  vi.mocked(PermissionService.getAllowedContractorId).mockReset().mockResolvedValue(null);
  vi.mocked(PermissionService.assert).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(getProductionSettings).mockReset().mockResolvedValue({
    supervisorApprovalRequired: false,
    externalEntryBy: "INTERNAL_SUPERVISOR",
    pieceRateTrackingEnabled: false,
    pieceRatePaymentQuantityRule: "QC_ACCEPTED_QTY",
    workersCanViewOwnRate: false,
  } as never);
  vi.mocked(ProductionOrderRepository.findAnyById).mockReset();
  vi.mocked(resolveContractorPieceRate).mockReset();
  vi.mocked(generateEarningForJobWorkReceipt).mockReset();
});

describe("createJobWorkOrder", () => {
  // contractorId was previously written straight from client input with zero
  // ownership check — a direct API call with another tenant's contractorId
  // would succeed and embed that tenant's name/code in every subsequent
  // read (confirmed cross-tenant disclosure risk, fixed).
  it("rejects a contractorId belonging to another company", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder({ plannedQuantity: 100 }) as never);
    vi.mocked(ContractorRepository.findById).mockResolvedValue(null);

    await expect(
      createJobWorkOrder(actor, { stageCosts: [], extraCharges: [],
        jobOrderId: "jo-1",
        contractorId: "con-x",
        issuedQuantity: 5,
        uomId: "uom-1",
        issueDate: "2026-08-24",
        expectedCompletionDate: "",
        remarks: "",
        materials: [],
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(JobWorkOrderRepository.createWithMaterialsInTx).not.toHaveBeenCalled();
  });

  it("issues against the job order's unprocessed pool and posts one JOB_WORK_ISSUE ledger entry per material line", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder({ plannedQuantity: 100, completedQuantity: 20 }) as never);
    vi.mocked(JobWorkOrderRepository.createWithMaterialsInTx).mockResolvedValue(jobWorkOrder() as never);

    await createJobWorkOrder(actor, { stageCosts: [], extraCharges: [],
      jobOrderId: "jo-1",
      contractorId: "con-1",
      issuedQuantity: 50,
      uomId: "uom-1",
      issueDate: "2026-08-24",
      expectedCompletionDate: "",
      remarks: "",
      materials: [{ productId: "prod-1", quantity: 10, uomId: "uom-2", warehouseId: "wh-1", fabricRollId: "", notes: "" }],
    });

    expect(recordInventoryTransaction).toHaveBeenCalledTimes(1);
    expect(recordInventoryTransaction).toHaveBeenCalledWith(
      mockTx,
      actor,
      expect.objectContaining({ transactionType: "JOB_WORK_ISSUE", quantity: -10, productId: "prod-1", warehouseId: "wh-1" })
    );
  });

  it("rejects issuing more than the job order's unprocessed-and-uncommitted pool", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder({ plannedQuantity: 100, completedQuantity: 60 }) as never);
    // Shared pool with internal assignments: only 10 still free.
    vi.mocked(computeAvailableToCommit).mockResolvedValue({ available: 10, capacity: 100, done: 60, unworkedInternal: 0, pendingExternal: 30 });

    await expect(
      createJobWorkOrder(actor, { stageCosts: [], extraCharges: [],
        jobOrderId: "jo-1",
        contractorId: "con-1",
        issuedQuantity: 20,
        uomId: "uom-1",
        issueDate: "2026-08-24",
        expectedCompletionDate: "",
        remarks: "",
        materials: [],
      })
    ).rejects.toThrow(BusinessRuleError);
    expect(JobWorkOrderRepository.createWithMaterialsInTx).not.toHaveBeenCalled();
  });

  it("rejects sending a cancelled job order to job-work", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder({ status: "CANCELLED" }) as never);

    await expect(
      createJobWorkOrder(actor, { stageCosts: [], extraCharges: [], jobOrderId: "jo-1", contractorId: "con-1", issuedQuantity: 5, uomId: "uom-1", issueDate: "2026-08-24", expectedCompletionDate: "", remarks: "", materials: [] })
    ).rejects.toThrow(BusinessRuleError);
  });

  it("decrements the specified FabricRoll and rejects if the roll doesn't have enough remaining", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder({ plannedQuantity: 100 }) as never);
    vi.mocked(FabricRollRepository.findByIdWithContext).mockResolvedValue({ id: "roll-1" } as never);
    vi.mocked(FabricRollRepository.guardedDecrementRemaining).mockResolvedValue({ count: 0 } as never);
    vi.mocked(JobWorkOrderRepository.createWithMaterialsInTx).mockResolvedValue(jobWorkOrder() as never);

    await expect(
      createJobWorkOrder(actor, { stageCosts: [], extraCharges: [],
        jobOrderId: "jo-1",
        contractorId: "con-1",
        issuedQuantity: 5,
        uomId: "uom-1",
        issueDate: "2026-08-24",
        expectedCompletionDate: "",
        remarks: "",
        materials: [{ productId: "prod-1", quantity: 10, uomId: "uom-2", warehouseId: "wh-1", fabricRollId: "roll-1", notes: "" }],
      })
    ).rejects.toThrow(BusinessRuleError);
  });

  it("rejects issuing a raw-material line with no fabric roll when the warehouse doesn't have enough stock", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder({ plannedQuantity: 100 }) as never);
    vi.mocked(getAvailableQuantity).mockResolvedValue(3);

    await expect(
      createJobWorkOrder(actor, { stageCosts: [], extraCharges: [],
        jobOrderId: "jo-1",
        contractorId: "con-1",
        issuedQuantity: 5,
        uomId: "uom-1",
        issueDate: "2026-08-24",
        expectedCompletionDate: "",
        remarks: "",
        materials: [{ productId: "prod-1", quantity: 10, uomId: "uom-2", warehouseId: "wh-1", fabricRollId: "", notes: "" }],
      })
    ).rejects.toMatchObject({ code: "INSUFFICIENT_RAW_MATERIAL_STOCK" });

    expect(recordInventoryTransaction).not.toHaveBeenCalled();
    expect(JobWorkOrderRepository.createWithMaterialsInTx).not.toHaveBeenCalled();
  });

  it("converts a material line's quantity into its base UOM before checking stock and posting to the ledger", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder({ plannedQuantity: 100 }) as never);
    vi.mocked(JobWorkOrderRepository.createWithMaterialsInTx).mockResolvedValue(jobWorkOrder() as never);
    vi.mocked(ProductRepository.findMaterialById).mockResolvedValue({
      id: "prod-1",
      styleName: "Test Material",
      baseUom: { id: "uom-base", baseUnitId: null, conversionFactor: 1 },
    } as never);
    vi.mocked(LookupRepository.unit.findUnique).mockResolvedValue({
      id: "uom-dzn",
      name: "Dozen",
      baseUnitId: "uom-base",
      conversionFactor: 12,
    } as never);
    vi.mocked(getAvailableQuantity).mockResolvedValue(1000);

    await createJobWorkOrder(actor, { stageCosts: [], extraCharges: [],
      jobOrderId: "jo-1",
      contractorId: "con-1",
      issuedQuantity: 5,
      uomId: "uom-1",
      issueDate: "2026-08-24",
      expectedCompletionDate: "",
      remarks: "",
      materials: [{ productId: "prod-1", quantity: 2, uomId: "uom-dzn", warehouseId: "wh-1", fabricRollId: "", notes: "" }],
    });

    // 2 DZN -> 24 (the material's base unit).
    expect(getAvailableQuantity).toHaveBeenCalledWith("co-1", "prod-1", "wh-1");
    expect(recordInventoryTransaction).toHaveBeenCalledWith(
      mockTx,
      actor,
      expect.objectContaining({ transactionType: "JOB_WORK_ISSUE", quantity: -24 })
    );
  });
});

describe("receiveJobWork", () => {
  it("increments both the JobWorkOrder's own accumulators and the parent JobOrder's, via the reused guard", async () => {
    vi.mocked(JobWorkOrderRepository.findAnyById).mockResolvedValue(jobWorkOrder({ issuedQuantity: 50 }) as never);
    vi.mocked(JobWorkOrderRepository.findForGuardedUpdateInTx).mockResolvedValue(jobWorkOrder({ issuedQuantity: 50 }) as never);
    vi.mocked(JobWorkReceiptRepository.createInTx).mockResolvedValue({ id: "receipt-1" } as never);

    await receiveJobWork(actor, "jwo-1", { receivedDate: "2026-08-24", receivedQuantity: 30, rejectedQuantity: 0, damagedQuantity: 0, remarks: "" });

    expect(applyJobOrderQuantityDelta).toHaveBeenCalledWith(mockTx, "jo-1", { completed: 30, rejected: 0, damaged: 0 });
    expect(JobWorkOrderRepository.updateInTx).toHaveBeenCalledWith(mockTx, "jwo-1", expect.objectContaining({ receivedQuantity: 30, status: "PARTIALLY_RECEIVED" }));
  });

  it("rejects an over-receipt before either accumulator changes", async () => {
    vi.mocked(JobWorkOrderRepository.findAnyById).mockResolvedValue(jobWorkOrder({ issuedQuantity: 50, receivedQuantity: 40 }) as never);
    vi.mocked(JobWorkOrderRepository.findForGuardedUpdateInTx).mockResolvedValue(jobWorkOrder({ issuedQuantity: 50, receivedQuantity: 40 }) as never);

    await expect(
      receiveJobWork(actor, "jwo-1", { receivedDate: "2026-08-24", receivedQuantity: 20, rejectedQuantity: 0, damagedQuantity: 0, remarks: "" })
    ).rejects.toThrow(BusinessRuleError);

    expect(JobWorkOrderRepository.updateInTx).not.toHaveBeenCalled();
    expect(applyJobOrderQuantityDelta).not.toHaveBeenCalled();
  });

  it("refuses to receive against a cancelled or closed job-work order", async () => {
    vi.mocked(JobWorkOrderRepository.findAnyById).mockResolvedValue(jobWorkOrder({ status: "CANCELLED" }) as never);

    await expect(
      receiveJobWork(actor, "jwo-1", { receivedDate: "2026-08-24", receivedQuantity: 10, rejectedQuantity: 0, damagedQuantity: 0, remarks: "" })
    ).rejects.toThrow(BusinessRuleError);
  });

  it("marks the job-work order FULLY_RECEIVED once received+rejected+damaged reaches issuedQuantity", async () => {
    vi.mocked(JobWorkOrderRepository.findAnyById).mockResolvedValue(jobWorkOrder({ issuedQuantity: 50, receivedQuantity: 40 }) as never);
    vi.mocked(JobWorkOrderRepository.findForGuardedUpdateInTx).mockResolvedValue(jobWorkOrder({ issuedQuantity: 50, receivedQuantity: 40 }) as never);
    vi.mocked(JobWorkReceiptRepository.createInTx).mockResolvedValue({ id: "receipt-2" } as never);

    await receiveJobWork(actor, "jwo-1", { receivedDate: "2026-08-24", receivedQuantity: 10, rejectedQuantity: 0, damagedQuantity: 0, remarks: "" });

    expect(JobWorkOrderRepository.updateInTx).toHaveBeenCalledWith(mockTx, "jwo-1", expect.objectContaining({ status: "FULLY_RECEIVED" }));
  });

  it("regression: draws the receipt number via the atomic document-number counter, not the old count()+1 scheme", async () => {
    vi.mocked(JobWorkOrderRepository.findAnyById).mockResolvedValue(jobWorkOrder({ issuedQuantity: 50 }) as never);
    vi.mocked(JobWorkOrderRepository.findForGuardedUpdateInTx).mockResolvedValue(jobWorkOrder({ issuedQuantity: 50 }) as never);
    vi.mocked(JobWorkReceiptRepository.createInTx).mockResolvedValue({ id: "receipt-1" } as never);

    await receiveJobWork(actor, "jwo-1", { receivedDate: "2026-08-24", receivedQuantity: 30, rejectedQuantity: 0, damagedQuantity: 0, remarks: "" });

    expect(generateDocumentNumber).toHaveBeenCalledWith(expect.objectContaining({ documentType: "JOB_WORK_RECEIPT" }));
    expect(JobWorkReceiptRepository.createInTx).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({ receiptNumber: "JWO-2026-00001" })
    );
  });

  describe("idempotency (CF-5)", () => {
    const existingReceipt = { id: "receipt-existing" };
    const validInput = { receivedDate: "2026-08-24", receivedQuantity: 30, rejectedQuantity: 0, damagedQuantity: 0, remarks: "" };

    it("returns the original receipt unchanged when the same idempotencyKey is replayed, without even looking up the job-work order", async () => {
      vi.mocked(JobWorkReceiptRepository.findByIdempotencyKey).mockResolvedValue(existingReceipt as never);

      const result = await receiveJobWork(actor, "jwo-1", { ...validInput, idempotencyKey: "retry-key-1" });

      expect(result).toBe(existingReceipt);
      expect(JobWorkOrderRepository.findAnyById).not.toHaveBeenCalled();
      expect(JobWorkReceiptRepository.createInTx).not.toHaveBeenCalled();
    });

    it("proceeds normally the first time a key is used", async () => {
      vi.mocked(JobWorkOrderRepository.findAnyById).mockResolvedValue(jobWorkOrder({ issuedQuantity: 50 }) as never);
      vi.mocked(JobWorkOrderRepository.findForGuardedUpdateInTx).mockResolvedValue(jobWorkOrder({ issuedQuantity: 50 }) as never);
      vi.mocked(JobWorkReceiptRepository.createInTx).mockResolvedValue({ id: "receipt-1" } as never);

      const result = await receiveJobWork(actor, "jwo-1", { ...validInput, idempotencyKey: "fresh-key-1" });

      expect(JobWorkReceiptRepository.findByIdempotencyKey).toHaveBeenCalledWith("co-1", "fresh-key-1");
      expect(JobWorkReceiptRepository.createInTx).toHaveBeenCalledWith(mockTx, expect.objectContaining({ idempotencyKey: "fresh-key-1" }));
      expect((result as { id: string }).id).toBe("receipt-1");
    });

    it("does not check idempotency at all when no key is supplied", async () => {
      vi.mocked(JobWorkOrderRepository.findAnyById).mockResolvedValue(jobWorkOrder({ issuedQuantity: 50 }) as never);
      vi.mocked(JobWorkOrderRepository.findForGuardedUpdateInTx).mockResolvedValue(jobWorkOrder({ issuedQuantity: 50 }) as never);
      vi.mocked(JobWorkReceiptRepository.createInTx).mockResolvedValue({ id: "receipt-1" } as never);

      await receiveJobWork(actor, "jwo-1", validInput);

      expect(JobWorkReceiptRepository.findByIdempotencyKey).not.toHaveBeenCalled();
      expect(JobWorkReceiptRepository.createInTx).toHaveBeenCalledWith(mockTx, expect.objectContaining({ idempotencyKey: null }));
    });

    it("regression: a genuine concurrent replay transparently returns the winner's receipt instead of throwing", async () => {
      vi.mocked(JobWorkOrderRepository.findAnyById).mockResolvedValue(jobWorkOrder({ issuedQuantity: 50 }) as never);
      vi.mocked(JobWorkOrderRepository.findForGuardedUpdateInTx).mockResolvedValue(jobWorkOrder({ issuedQuantity: 50 }) as never);
      const p2002 = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      vi.mocked(JobWorkReceiptRepository.createInTx).mockRejectedValue(p2002);
      vi.mocked(JobWorkReceiptRepository.findByIdempotencyKey)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(existingReceipt as never);

      const result = await receiveJobWork(actor, "jwo-1", { ...validInput, idempotencyKey: "racing-key" });

      expect(result).toBe(existingReceipt);
    });

    it("still throws a genuine P2002 with no idempotencyKey supplied", async () => {
      vi.mocked(JobWorkOrderRepository.findAnyById).mockResolvedValue(jobWorkOrder({ issuedQuantity: 50 }) as never);
      vi.mocked(JobWorkOrderRepository.findForGuardedUpdateInTx).mockResolvedValue(jobWorkOrder({ issuedQuantity: 50 }) as never);
      const p2002 = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      vi.mocked(JobWorkReceiptRepository.createInTx).mockRejectedValue(p2002);

      await expect(receiveJobWork(actor, "jwo-1", validInput)).rejects.toBe(p2002);
    });
  });
});

describe("reverseJobWorkReceipt", () => {
  it("symmetrically decrements both the JobWorkOrder and the parent JobOrder", async () => {
    vi.mocked(JobWorkReceiptRepository.findAnyById).mockResolvedValue({ id: "receipt-1", jobWorkOrderId: "jwo-1", status: "COMPLETED", receivedQuantity: 30, rejectedQuantity: 0, damagedQuantity: 0, remarks: null } as never);
    vi.mocked(JobWorkOrderRepository.findForGuardedUpdateInTx).mockResolvedValue(jobWorkOrder({ issuedQuantity: 50, receivedQuantity: 30, jobOrderId: "jo-1" }) as never);

    await reverseJobWorkReceipt(actor, "receipt-1", "Wrong quantity recorded");

    expect(JobWorkOrderRepository.updateInTx).toHaveBeenCalledWith(mockTx, "jwo-1", expect.objectContaining({ receivedQuantity: 0 }));
    expect(applyJobOrderQuantityDelta).toHaveBeenCalledWith(mockTx, "jo-1", { completed: -30, rejected: -0, damaged: -0 });
    expect(JobWorkReceiptRepository.updateInTx).toHaveBeenCalledWith(mockTx, "receipt-1", expect.objectContaining({ status: "CANCELLED" }));
  });

  it("refuses to reverse an already-reversed receipt", async () => {
    vi.mocked(JobWorkReceiptRepository.findAnyById).mockResolvedValue({ id: "receipt-1", status: "CANCELLED" } as never);
    await expect(reverseJobWorkReceipt(actor, "receipt-1", "reason")).rejects.toThrow(BusinessRuleError);
  });
});

describe("transitionJobWorkOrderStatus", () => {
  it("blocks cancellation once a real receipt exists, not inferred from the status label", async () => {
    vi.mocked(JobWorkOrderRepository.findAnyById).mockResolvedValue(jobWorkOrder({ status: "PARTIALLY_RECEIVED" }) as never);
    vi.mocked(JobWorkOrderRepository.countActiveReceipts).mockResolvedValue(1);

    await expect(transitionJobWorkOrderStatus(actor, "jwo-1", "CANCELLED")).rejects.toThrow(BusinessRuleError);
    expect(JobWorkOrderRepository.update).not.toHaveBeenCalled();
  });

  it("allows cancellation when no receipt exists", async () => {
    vi.mocked(JobWorkOrderRepository.findAnyById).mockResolvedValue(jobWorkOrder({ status: "ISSUED" }) as never);
    vi.mocked(JobWorkOrderRepository.countActiveReceipts).mockResolvedValue(0);

    await transitionJobWorkOrderStatus(actor, "jwo-1", "CANCELLED");
    expect(JobWorkOrderRepository.updateInTx).toHaveBeenCalledWith(mockTx, "jwo-1", { status: "CANCELLED" });
  });

  it("reverses every issued raw-material line back to stock on cancellation", async () => {
    vi.mocked(JobWorkOrderRepository.findAnyById).mockResolvedValue(
      jobWorkOrder({
        status: "ISSUED",
        materials: [
          { productId: "prod-1", quantity: 10, uomId: "uom-2", warehouseId: "wh-1", fabricRollId: null },
          { productId: "prod-1", quantity: 4, uomId: "uom-2", warehouseId: "wh-1", fabricRollId: "roll-1" },
        ],
      }) as never
    );
    vi.mocked(JobWorkOrderRepository.countActiveReceipts).mockResolvedValue(0);

    await transitionJobWorkOrderStatus(actor, "jwo-1", "CANCELLED");

    expect(recordInventoryTransaction).toHaveBeenCalledTimes(2);
    expect(recordInventoryTransaction).toHaveBeenCalledWith(
      mockTx,
      actor,
      expect.objectContaining({ transactionType: "JOB_WORK_ISSUE_REVERSAL", quantity: 10, productId: "prod-1", warehouseId: "wh-1" })
    );
    expect(recordInventoryTransaction).toHaveBeenCalledWith(
      mockTx,
      actor,
      expect.objectContaining({ transactionType: "JOB_WORK_ISSUE_REVERSAL", quantity: 4, fabricRollId: "roll-1" })
    );
    expect(FabricRollRepository.incrementRemaining).toHaveBeenCalledWith(mockTx, "roll-1", 4);
    expect(JobWorkOrderRepository.updateInTx).toHaveBeenCalledWith(mockTx, "jwo-1", { status: "CANCELLED" });
  });

  it("captures statusBeforeHold when moving to ON_HOLD", async () => {
    vi.mocked(JobWorkOrderRepository.findAnyById).mockResolvedValue(jobWorkOrder({ status: "PARTIALLY_RECEIVED" }) as never);

    await transitionJobWorkOrderStatus(actor, "jwo-1", "ON_HOLD");
    expect(JobWorkOrderRepository.updateInTx).toHaveBeenCalledWith(mockTx, "jwo-1", { status: "ON_HOLD", statusBeforeHold: "PARTIALLY_RECEIVED" });
    expect(recordInventoryTransaction).not.toHaveBeenCalled();
  });

  it("rejects an illegal transition", async () => {
    vi.mocked(JobWorkOrderRepository.findAnyById).mockResolvedValue(jobWorkOrder({ status: "CLOSED" }) as never);
    await expect(transitionJobWorkOrderStatus(actor, "jwo-1", "CANCELLED")).rejects.toThrow(BusinessRuleError);
  });
});

describe("resumeJobWorkOrderFromHold", () => {
  it("restores the exact prior status", async () => {
    vi.mocked(JobWorkOrderRepository.findAnyById).mockResolvedValue(jobWorkOrder({ status: "ON_HOLD", statusBeforeHold: "PARTIALLY_RECEIVED" }) as never);
    vi.mocked(JobWorkOrderRepository.update).mockResolvedValue(jobWorkOrder({ status: "PARTIALLY_RECEIVED" }) as never);

    await resumeJobWorkOrderFromHold(actor, "jwo-1");
    expect(JobWorkOrderRepository.update).toHaveBeenCalledWith("jwo-1", { status: "PARTIALLY_RECEIVED", statusBeforeHold: null });
  });

  it("rejects resuming an order that isn't on hold", async () => {
    vi.mocked(JobWorkOrderRepository.findAnyById).mockResolvedValue(jobWorkOrder({ status: "ISSUED", statusBeforeHold: null }) as never);
    await expect(resumeJobWorkOrderFromHold(actor, "jwo-1")).rejects.toThrow(BusinessRuleError);
  });
});

describe("listPendingJobWorkReceipts", () => {
  // RBAC audit (2026-09-24): this was the one function in the file with no
  // identity-level contractor/internal check at all — added assertInternalUser()
  // as defense-in-depth, since it previously relied solely on the seeded
  // EXTERNAL_UNIT_USER role never holding production.approve.
  it("succeeds for an internal user and returns every contractor's pending receipts company-wide", async () => {
    vi.mocked(JobWorkReceiptRepository.findPendingForCompany).mockResolvedValue([{ id: "r-1" }] as never);

    const result = await listPendingJobWorkReceipts(actor);

    expect(PermissionService.assert).toHaveBeenCalledWith(actor.userId, "production", "approve");
    expect(JobWorkReceiptRepository.findPendingForCompany).toHaveBeenCalledWith(actor.companyId);
    expect(result).toEqual([{ id: "r-1" }]);
  });

  it("rejects outright for an external-unit login, even if it somehow held production.approve", async () => {
    vi.mocked(PermissionService.getAllowedContractorId).mockResolvedValue("con-1");

    await expect(listPendingJobWorkReceipts(actor)).rejects.toThrow(BusinessRuleError);
    expect(JobWorkReceiptRepository.findPendingForCompany).not.toHaveBeenCalled();
  });
});

describe("computeJobWorkOrderMetrics", () => {
  it("computes pendingQuantity as issued minus received/rejected/damaged", () => {
    const metrics = computeJobWorkOrderMetrics({
      status: "PARTIALLY_RECEIVED",
      issuedQuantity: 50,
      receivedQuantity: 20,
      rejectedQuantity: 5,
      damagedQuantity: 0,
      issueDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      expectedCompletionDate: null,
    });
    expect(metrics.pendingQuantity).toBe(25);
    expect(metrics.daysElapsed).toBe(3);
    expect(metrics.isOverdue).toBe(false);
  });

  it("flags overdue only while not yet fully done and past the expected completion date", () => {
    const overdue = computeJobWorkOrderMetrics({
      status: "PARTIALLY_RECEIVED",
      issuedQuantity: 50,
      receivedQuantity: 0,
      rejectedQuantity: 0,
      damagedQuantity: 0,
      issueDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      expectedCompletionDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    });
    expect(overdue.isOverdue).toBe(true);

    const doneButPastDue = computeJobWorkOrderMetrics({
      status: "FULLY_RECEIVED",
      issuedQuantity: 50,
      receivedQuantity: 50,
      rejectedQuantity: 0,
      damagedQuantity: 0,
      issueDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      expectedCompletionDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    });
    expect(doneButPastDue.isOverdue).toBe(false);
  });

  // Regression test for the P3 fix: a CANCELLED order's issued material is
  // reversed back to stock (see reverseIssuedMaterialsInTx) — nothing is
  // genuinely outstanding with the contractor, so the raw
  // issued-minus-received arithmetic must not be shown as "Pending".
  it("reports zero pending quantity for a CANCELLED order regardless of raw issued/received figures", () => {
    const metrics = computeJobWorkOrderMetrics({
      status: "CANCELLED",
      issuedQuantity: 50,
      receivedQuantity: 0,
      rejectedQuantity: 0,
      damagedQuantity: 0,
      issueDate: new Date(),
      expectedCompletionDate: null,
    });
    expect(metrics.pendingQuantity).toBe(0);
  });
});

describe("createJobWorkOrder — multi-stage job work + stage-wise cost sheet (2026-09-28)", () => {
  const base = {
    jobOrderId: "jo-1",
    contractorId: "con-1",
    issuedQuantity: 100,
    uomId: "uom-1",
    issueDate: "2026-09-28",
    expectedCompletionDate: "",
    remarks: "",
    materials: [],
    stageCosts: [],
    extraCharges: [],
  };

  beforeEach(() => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder() as never);
    vi.mocked(JobWorkOrderRepository.createWithMaterialsInTx).mockResolvedValue(jobWorkOrder() as never);
  });

  it("covers every stage from the job order's own stage through the chosen end stage, freezing each rate × qty", async () => {
    await createJobWorkOrder(actor, {
      ...base,
      throughStageId: "stage-fin",
      stageCosts: [{ productionStageId: "stage-fin", rate: 7 }],
      extraCharges: [{ costType: "Transportation", description: "", amount: 300 }],
    });

    const [, data] = vi.mocked(JobWorkOrderRepository.createWithMaterialsInTx).mock.calls[0];
    const covered = (data as { coveredStages: { create: Record<string, unknown>[] } }).coveredStages.create;
    expect(covered).toEqual([
      expect.objectContaining({ productionStageId: "stage-sew", sequence: 0, rate: 5, defaultRate: 5, defaultSource: "STYLE_DEFAULT", isOverridden: false, amount: 500 }),
      expect.objectContaining({ productionStageId: "stage-fin", sequence: 1, rate: 7, defaultRate: 5, isOverridden: true, amount: 700 }),
    ]);
    expect(data).toEqual(expect.objectContaining({ stageCostTotal: 1200, extraCostTotal: 300, totalCost: 1500 }));
  });

  it("covers only the job order's own stage when no end stage is chosen", async () => {
    await createJobWorkOrder(actor, base);
    const [, data] = vi.mocked(JobWorkOrderRepository.createWithMaterialsInTx).mock.calls[0];
    expect((data as { coveredStages: { create: unknown[] } }).coveredStages.create).toHaveLength(1);
  });

  it("rejects a contractor that doesn't perform one of the covered stages", async () => {
    vi.mocked(ContractorRepository.findById).mockResolvedValue({
      id: "con-1",
      name: "HP Cotton",
      isActive: true,
      stages: [{ productionStageId: "stage-sew" }],
    } as never);
    await expect(createJobWorkOrder(actor, { ...base, throughStageId: "stage-fin" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("does not perform Finishing"),
    });
    expect(JobWorkOrderRepository.createWithMaterialsInTx).not.toHaveBeenCalled();
  });

  it("rejects an inactive contractor", async () => {
    vi.mocked(ContractorRepository.findById).mockResolvedValue({ id: "con-1", name: "Old Co", isActive: false, stages: [] } as never);
    await expect(createJobWorkOrder(actor, base)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("never uses a silent 0 — a stage with no configured cost must be given a rate", async () => {
    vi.mocked(resolveEffectiveStageCosts).mockImplementation(
      async (_c, _co, params) => new Map(params.stageIds.map((id) => [id, { productionStageId: id, rate: null, source: "NOT_CONFIGURED" as const }]))
    );
    await expect(createJobWorkOrder(actor, base)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("enter a rate"),
    });
    await createJobWorkOrder(actor, { ...base, stageCosts: [{ productionStageId: "stage-sew", rate: 4 }] });
    const [, data] = vi.mocked(JobWorkOrderRepository.createWithMaterialsInTx).mock.calls[0];
    expect((data as { coveredStages: { create: Record<string, unknown>[] } }).coveredStages.create[0]).toEqual(
      expect.objectContaining({ rate: 4, defaultRate: null, defaultSource: "NOT_CONFIGURED", isOverridden: true })
    );
  });

  it("rejects a cost entered for a stage the job work doesn't cover", async () => {
    await expect(
      createJobWorkOrder(actor, { ...base, stageCosts: [{ productionStageId: "stage-pak", rate: 2 }] })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("requires a Finished Goods warehouse when the covered range ends at the final stage", async () => {
    await expect(createJobWorkOrder(actor, { ...base, throughStageId: "stage-pak" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("Finished Goods warehouse"),
    });
    await createJobWorkOrder(actor, { ...base, throughStageId: "stage-pak", finishedGoodsWarehouseId: "wh-fg" });
    const [, data] = vi.mocked(JobWorkOrderRepository.createWithMaterialsInTx).mock.calls[0];
    expect(data).toEqual(expect.objectContaining({ finishedGoodsWarehouseId: "wh-fg" }));
  });

  it("rejects an end stage that isn't at/after the job order's own stage", async () => {
    await expect(createJobWorkOrder(actor, { ...base, throughStageId: "stage-unknown" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("receiveJobWork — multi-stage cascade (2026-09-28)", () => {
  it("moves received good pieces through every further covered stage", async () => {
    const order = jobWorkOrder({
      coveredStages: [
        { productionStageId: "stage-sew", sequence: 0 },
        { productionStageId: "stage-fin", sequence: 1 },
      ],
      finishedGoodsWarehouseId: null,
    });
    vi.mocked(JobWorkOrderRepository.findAnyById).mockResolvedValue(order as never);
    vi.mocked(JobWorkOrderRepository.findForGuardedUpdateInTx).mockResolvedValue(order as never);
    vi.mocked(JobWorkReceiptRepository.createInTx).mockResolvedValue({ id: "rcpt-1" } as never);

    await receiveJobWork(actor, "jwo-1", { receivedDate: "2026-09-28", receivedQuantity: 40, rejectedQuantity: 2, damagedQuantity: 0, remarks: "" });

    expect(cascadeReceivedThroughStagesInTx).toHaveBeenCalledWith(
      mockTx,
      actor,
      expect.objectContaining({ sourceJobOrderId: "jo-1", downstreamStageIds: ["stage-fin"], quantity: 40 })
    );
  });

  // Job Work cascade variant-breakdown fix (2026-10-20, post-push audit
  // Medium finding): receiveJobWork's own cascade call never passed
  // variantBreakdown through before this fix, so a variant-bearing style
  // completed via an external Job Work receipt silently never created a
  // Finished Goods Reservation. cascadeReceivedThroughStagesInTx itself is
  // mocked in this file — resolveFinalStageVariantBreakdown's own real
  // validation is covered in job-order.service.test.ts, where that function
  // actually lives un-mocked. This test only proves the pass-through.
  it("passes the submitted variantBreakdown through to the cascade", async () => {
    const order = jobWorkOrder({
      coveredStages: [
        { productionStageId: "stage-sew", sequence: 0 },
        { productionStageId: "stage-pak", sequence: 1 },
      ],
      finishedGoodsWarehouseId: "wh-fg",
    });
    vi.mocked(JobWorkOrderRepository.findAnyById).mockResolvedValue(order as never);
    vi.mocked(JobWorkOrderRepository.findForGuardedUpdateInTx).mockResolvedValue(order as never);
    vi.mocked(JobWorkReceiptRepository.createInTx).mockResolvedValue({ id: "rcpt-1" } as never);

    await receiveJobWork(actor, "jwo-1", {
      receivedDate: "2026-10-20",
      receivedQuantity: 40,
      rejectedQuantity: 0,
      damagedQuantity: 0,
      remarks: "",
      variantBreakdown: [{ productVariantId: "var-1", quantity: 40 }],
    });

    expect(cascadeReceivedThroughStagesInTx).toHaveBeenCalledWith(
      mockTx,
      actor,
      expect.objectContaining({ variantBreakdown: [{ productVariantId: "var-1", quantity: 40 }] })
    );
  });

  it("blocks reversing a receipt whose pieces already cascaded to later stages", async () => {
    vi.mocked(JobWorkReceiptRepository.findAnyById).mockResolvedValue({
      id: "rcpt-1",
      jobWorkOrderId: "jwo-1",
      status: "COMPLETED",
      receivedQuantity: 10,
      rejectedQuantity: 0,
      damagedQuantity: 0,
    } as never);
    vi.mocked(JobWorkOrderRepository.findAnyById).mockResolvedValue(
      jobWorkOrder({ coveredStages: [{ productionStageId: "stage-sew", sequence: 0 }, { productionStageId: "stage-fin", sequence: 1 }] }) as never
    );
    await expect(reverseJobWorkReceipt(actor, "rcpt-1", "wrong count")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(applyJobOrderQuantityDelta).not.toHaveBeenCalled();
  });
});

// Job Work cascade variant-breakdown fix (2026-10-20) -- approveJobWorkReceipt
// is the Supervisor-decision counterpart to receiveJobWork for an external
// unit's PENDING submission: its own cascade call had the identical gap,
// closed the identical way (an optional 3rd `input` param, defaulted to {}
// so every pre-existing direct call with no third argument is unaffected).
describe("approveJobWorkReceipt — multi-stage cascade (2026-10-20)", () => {
  const receipt = {
    id: "rcpt-1",
    jobWorkOrderId: "jwo-1",
    approvalStatus: "PENDING" as const,
    submittedByUserId: "external-user-1",
    receivedQuantity: 40,
    rejectedQuantity: 0,
    damagedQuantity: 0,
  };

  beforeEach(() => {
    vi.mocked(JobWorkReceiptRepository.findAnyById).mockReset().mockResolvedValue(receipt as never);
    vi.mocked(JobWorkReceiptRepository.updateApprovalStatusConditionalInTx).mockReset().mockResolvedValue({ count: 1 } as never);
    mockTx.jobWorkReceipt.findUniqueOrThrow
      .mockReset()
      .mockResolvedValue({ id: "rcpt-1", approvalStatus: "APPROVED" } as never);
  });

  it("approves the receipt, applies its quantities, and passes variantBreakdown through to the cascade", async () => {
    const order = jobWorkOrder({
      coveredStages: [
        { productionStageId: "stage-sew", sequence: 0 },
        { productionStageId: "stage-pak", sequence: 1 },
      ],
      finishedGoodsWarehouseId: "wh-fg",
      issuedQuantity: 50,
    });
    vi.mocked(JobWorkOrderRepository.findForGuardedUpdateInTx).mockResolvedValue(order as never);
    vi.mocked(JobWorkOrderRepository.findAnyById).mockResolvedValue(order as never);

    const result = await approveJobWorkReceipt(actor, "rcpt-1", {
      variantBreakdown: [{ productVariantId: "var-1", quantity: 40 }],
    });

    expect(JobWorkReceiptRepository.updateApprovalStatusConditionalInTx).toHaveBeenCalledWith(
      mockTx,
      "rcpt-1",
      "PENDING",
      expect.objectContaining({ approvalStatus: "APPROVED", receivedByUserId: actor.userId })
    );
    expect(applyJobOrderQuantityDelta).toHaveBeenCalledWith(mockTx, "jo-1", { completed: 40, rejected: 0, damaged: 0 });
    expect(cascadeReceivedThroughStagesInTx).toHaveBeenCalledWith(
      mockTx,
      actor,
      expect.objectContaining({
        sourceJobOrderId: "jo-1",
        downstreamStageIds: ["stage-pak"],
        quantity: 40,
        variantBreakdown: [{ productVariantId: "var-1", quantity: 40 }],
      })
    );
    expect(result).toEqual({ id: "rcpt-1", approvalStatus: "APPROVED" });
  });

  it("defaults to no variantBreakdown when none is submitted — pre-existing call shape unaffected", async () => {
    const order = jobWorkOrder({
      coveredStages: [
        { productionStageId: "stage-sew", sequence: 0 },
        { productionStageId: "stage-fin", sequence: 1 },
      ],
      issuedQuantity: 50,
    });
    vi.mocked(JobWorkOrderRepository.findForGuardedUpdateInTx).mockResolvedValue(order as never);
    vi.mocked(JobWorkOrderRepository.findAnyById).mockResolvedValue(order as never);

    await approveJobWorkReceipt(actor, "rcpt-1");

    expect(cascadeReceivedThroughStagesInTx).toHaveBeenCalledWith(
      mockTx,
      actor,
      expect.objectContaining({ variantBreakdown: undefined })
    );
  });

  it("rejects approving a receipt that was already decided", async () => {
    vi.mocked(JobWorkReceiptRepository.findAnyById).mockResolvedValue({ ...receipt, approvalStatus: "APPROVED" } as never);
    await expect(approveJobWorkReceipt(actor, "rcpt-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(cascadeReceivedThroughStagesInTx).not.toHaveBeenCalled();
  });
});

describe("job-work visibility (P1)", () => {
  it("refuses an internal user without production.view_all (a worker)", async () => {
    vi.mocked(PermissionService.getAllowedContractorId).mockResolvedValueOnce(null);
    vi.mocked(PermissionService.can).mockResolvedValueOnce(false);
    await expect(
      listJobWorkOrders("co-1", { page: 1, pageSize: 20, skip: 0, take: 20, search: "", sortBy: "createdAt", sortOrder: "desc" } as never, "user-1")
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });
});
