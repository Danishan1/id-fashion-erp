import { beforeEach, describe, expect, it, vi } from "vitest";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/numbering/DocumentNumberingService", () => ({ generateDocumentNumber: vi.fn() }));
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
vi.mock("@/modules/suppliers/supplier.repository", () => ({
  SupplierRepository: { findById: vi.fn() },
}));
vi.mock("./job-order.service", () => ({ applyJobOrderQuantityDelta: vi.fn(), assertStageAccess: vi.fn() }));
vi.mock("./production.repository", () => ({ JobOrderRepository: { findAnyById: vi.fn() } }));
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
  },
}));

const mockTx = { jobWorkOrder: {}, jobWorkReceipt: {} };
vi.mock("@/core/db/client", () => ({
  prisma: { $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(mockTx)) },
}));

const { generateDocumentNumber } = await import("@/core/numbering/DocumentNumberingService");
const { recordInventoryTransaction, getAvailableQuantity } = await import("@/modules/inventory/inventory.service");
const { ProductRepository } = await import("@/modules/products/product.repository");
const { LookupRepository } = await import("@/modules/lookups/lookup.repository");
const { FabricRollRepository } = await import("@/modules/purchasing/fabric-roll.repository");
const { SupplierRepository } = await import("@/modules/suppliers/supplier.repository");
const { applyJobOrderQuantityDelta, assertStageAccess } = await import("./job-order.service");
const { JobOrderRepository } = await import("./production.repository");
const { JobWorkOrderRepository, JobWorkReceiptRepository } = await import("./job-work-order.repository");
const {
  createJobWorkOrder,
  receiveJobWork,
  reverseJobWorkReceipt,
  transitionJobWorkOrderStatus,
  resumeJobWorkOrderFromHold,
  computeJobWorkOrderMetrics,
} = await import("./job-work-order.service");

const actor = { companyId: "co-1", userId: "user-1" };

function jobOrder(overrides: Record<string, unknown> = {}) {
  return { id: "jo-1", companyId: "co-1", status: "IN_PROGRESS", plannedQuantity: 100, completedQuantity: 0, rejectedQuantity: 0, damagedQuantity: 0, ...overrides };
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
  vi.mocked(SupplierRepository.findById).mockReset().mockResolvedValue({ id: "sup-1" } as never);
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
  vi.mocked(assertStageAccess).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(JobOrderRepository.findAnyById).mockReset();
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
});

describe("createJobWorkOrder", () => {
  // supplierId was previously written straight from client input with zero
  // ownership check — a direct API call with another tenant's supplierId
  // would succeed and embed that tenant's name/code in every subsequent
  // read (confirmed cross-tenant disclosure risk, fixed).
  it("rejects a supplierId belonging to another company", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder({ plannedQuantity: 100 }) as never);
    vi.mocked(SupplierRepository.findById).mockResolvedValue(null);

    await expect(
      createJobWorkOrder(actor, {
        jobOrderId: "jo-1",
        supplierId: "sup-x",
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

    await createJobWorkOrder(actor, {
      jobOrderId: "jo-1",
      supplierId: "sup-1",
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
    vi.mocked(JobWorkOrderRepository.sumPendingByJobOrderId).mockResolvedValue(30);
    // unprocessed = 100-60 = 40; alreadyPendingElsewhere = 30; availableToIssue = 10

    await expect(
      createJobWorkOrder(actor, {
        jobOrderId: "jo-1",
        supplierId: "sup-1",
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
      createJobWorkOrder(actor, { jobOrderId: "jo-1", supplierId: "sup-1", issuedQuantity: 5, uomId: "uom-1", issueDate: "2026-08-24", expectedCompletionDate: "", remarks: "", materials: [] })
    ).rejects.toThrow(BusinessRuleError);
  });

  it("decrements the specified FabricRoll and rejects if the roll doesn't have enough remaining", async () => {
    vi.mocked(JobOrderRepository.findAnyById).mockResolvedValue(jobOrder({ plannedQuantity: 100 }) as never);
    vi.mocked(FabricRollRepository.findByIdWithContext).mockResolvedValue({ id: "roll-1" } as never);
    vi.mocked(FabricRollRepository.guardedDecrementRemaining).mockResolvedValue({ count: 0 } as never);
    vi.mocked(JobWorkOrderRepository.createWithMaterialsInTx).mockResolvedValue(jobWorkOrder() as never);

    await expect(
      createJobWorkOrder(actor, {
        jobOrderId: "jo-1",
        supplierId: "sup-1",
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
      createJobWorkOrder(actor, {
        jobOrderId: "jo-1",
        supplierId: "sup-1",
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

    await createJobWorkOrder(actor, {
      jobOrderId: "jo-1",
      supplierId: "sup-1",
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
