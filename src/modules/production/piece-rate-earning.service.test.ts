import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { assert: vi.fn() } }));
vi.mock("@/core/production-settings/ProductionSettingsService", () => ({ getProductionSettings: vi.fn() }));
vi.mock("./production.repository", () => ({
  QcInspectionRepository: { sumAcceptedByJobOrderIdInTx: vi.fn() },
  PieceRateEarningRepository: {
    createInTx: vi.fn(),
    sumPriorPayable: vi.fn(),
    findMany: vi.fn(),
    findAnyById: vi.fn(),
    update: vi.fn(),
  },
}));

const { PermissionService } = await import("@/core/rbac/PermissionService");
const { getProductionSettings } = await import("@/core/production-settings/ProductionSettingsService");
const { QcInspectionRepository, PieceRateEarningRepository } = await import("./production.repository");
const {
  generateEarningForJobOrderProgress,
  generateEarningsForQcAcceptance,
  generateEarningForJobWorkReceipt,
  approvePieceRateEarning,
  cancelPieceRateEarning,
} = await import("./piece-rate-earning.service");

const QC_ACCEPTED_SETTINGS = {
  supervisorApprovalRequired: false,
  externalEntryBy: "INTERNAL_SUPERVISOR",
  pieceRateTrackingEnabled: true,
  pieceRatePaymentQuantityRule: "QC_ACCEPTED_QTY",
  workersCanViewOwnRate: false,
};

function pieceRateAssignment(overrides: Record<string, unknown> = {}) {
  return {
    id: "assignment-1",
    employeeId: "emp-1",
    productionOperationId: "op-1",
    resolvedRate: "2.50",
    resolvedRateSource: "STYLE_OPERATION_DEFAULT",
    rateOverridden: false,
    overriddenRate: null,
    employee: { id: "emp-1", payType: "PIECE_RATE" },
    ...overrides,
  };
}

function makeTx(overrides: Record<string, unknown> = {}) {
  return {
    jobOrderAssignment: { findUnique: vi.fn(), findMany: vi.fn() },
    jobOrderProgressEntry: { groupBy: vi.fn() },
    jobOrder: { findUniqueOrThrow: vi.fn() },
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(PermissionService.assert).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(getProductionSettings).mockReset().mockResolvedValue(QC_ACCEPTED_SETTINGS as never);
  vi.mocked(QcInspectionRepository.sumAcceptedByJobOrderIdInTx).mockReset();
  vi.mocked(PieceRateEarningRepository.createInTx).mockReset().mockResolvedValue({ id: "earning-1" } as never);
  vi.mocked(PieceRateEarningRepository.sumPriorPayable).mockReset().mockResolvedValue(0);
  vi.mocked(PieceRateEarningRepository.findAnyById).mockReset();
  vi.mocked(PieceRateEarningRepository.update).mockReset();
});

describe("generateEarningForJobOrderProgress — single assignment", () => {
  it("computes payableQuantity/amount from the resolved rate and the fresh eligible quantity", async () => {
    const tx = makeTx();
    vi.mocked(tx.jobOrderAssignment.findUnique).mockResolvedValue(pieceRateAssignment() as never);
    vi.mocked(QcInspectionRepository.sumAcceptedByJobOrderIdInTx).mockResolvedValue(380);
    vi.mocked(PieceRateEarningRepository.sumPriorPayable).mockResolvedValue(0);

    await generateEarningForJobOrderProgress(tx as never, { companyId: "co-1", jobOrderId: "jo-a", jobOrderAssignmentId: "assignment-1" });

    expect(PieceRateEarningRepository.createInTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ payableQuantity: 380, rateApplied: 2.5, amount: 950, status: "PENDING" })
    );
  });

  // Regression (2026-09-18): a live QC-accept never produced an earning row, because the eligible-quantity
  // sum was read through the plain `prisma` client instead of the open transaction's own `tx` — under
  // Postgres READ COMMITTED, that meant it couldn't see the just-inserted QcInspection row still uncommitted
  // in this same transaction, so it silently read stale (pre-transaction) data. Asserting the sum is queried
  // through `tx`, not just that it's called, is what actually pins this fix down.
  it("reads the eligible quantity through the open transaction's own tx, not a separate connection", async () => {
    const tx = makeTx();
    vi.mocked(tx.jobOrderAssignment.findUnique).mockResolvedValue(pieceRateAssignment() as never);
    vi.mocked(QcInspectionRepository.sumAcceptedByJobOrderIdInTx).mockResolvedValue(5);
    vi.mocked(PieceRateEarningRepository.sumPriorPayable).mockResolvedValue(0);

    await generateEarningForJobOrderProgress(tx as never, { companyId: "co-1", jobOrderId: "jo-a", jobOrderAssignmentId: "assignment-1" });

    expect(QcInspectionRepository.sumAcceptedByJobOrderIdInTx).toHaveBeenCalledWith(tx, "jo-a");
  });

  it("skips a FIXED_SALARY assignment entirely — no earning row", async () => {
    const tx = makeTx();
    vi.mocked(tx.jobOrderAssignment.findUnique).mockResolvedValue(
      pieceRateAssignment({ employee: { id: "emp-1", payType: "FIXED_SALARY" } }) as never
    );
    vi.mocked(QcInspectionRepository.sumAcceptedByJobOrderIdInTx).mockResolvedValue(100);

    const result = await generateEarningForJobOrderProgress(tx as never, { companyId: "co-1", jobOrderId: "jo-a", jobOrderAssignmentId: "assignment-1" });

    expect(result).toBeNull();
    expect(PieceRateEarningRepository.createInTx).not.toHaveBeenCalled();
  });

  it("throws when no rate is on file — never silently pays 0", async () => {
    const tx = makeTx();
    vi.mocked(tx.jobOrderAssignment.findUnique).mockResolvedValue(pieceRateAssignment({ resolvedRate: null }) as never);
    vi.mocked(QcInspectionRepository.sumAcceptedByJobOrderIdInTx).mockResolvedValue(50);

    await expect(
      generateEarningForJobOrderProgress(tx as never, { companyId: "co-1", jobOrderId: "jo-a", jobOrderAssignmentId: "assignment-1" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(PieceRateEarningRepository.createInTx).not.toHaveBeenCalled();
  });

  it("uses the overridden rate, not the resolved rate, when rateOverridden is true", async () => {
    const tx = makeTx();
    vi.mocked(tx.jobOrderAssignment.findUnique).mockResolvedValue(
      pieceRateAssignment({ resolvedRate: "2.5", rateOverridden: true, overriddenRate: "4" }) as never
    );
    vi.mocked(QcInspectionRepository.sumAcceptedByJobOrderIdInTx).mockResolvedValue(10);

    await generateEarningForJobOrderProgress(tx as never, { companyId: "co-1", jobOrderId: "jo-a", jobOrderAssignmentId: "assignment-1" });

    expect(PieceRateEarningRepository.createInTx).toHaveBeenCalledWith(tx, expect.objectContaining({ rateApplied: 4, amount: 40 }));
  });

  it("is a no-op once the remainder is (near) zero — no duplicate earning for the same eligible quantity", async () => {
    const tx = makeTx();
    vi.mocked(tx.jobOrderAssignment.findUnique).mockResolvedValue(pieceRateAssignment() as never);
    vi.mocked(QcInspectionRepository.sumAcceptedByJobOrderIdInTx).mockResolvedValue(380);
    vi.mocked(PieceRateEarningRepository.sumPriorPayable).mockResolvedValue(380); // already fully paid

    const result = await generateEarningForJobOrderProgress(tx as never, { companyId: "co-1", jobOrderId: "jo-a", jobOrderAssignmentId: "assignment-1" });

    expect(result).toBeNull();
    expect(PieceRateEarningRepository.createInTx).not.toHaveBeenCalled();
  });
});

describe("the exact worked rework example from the spec", () => {
  it("pays 380x2.50=950 on the original JobOrder, then a separate, independent 12x2.50=30 on the rework-destination JobOrder — never a re-paid 950", async () => {
    // JO-A: 400 assigned, QC accepts 380 of it.
    const txA = makeTx();
    vi.mocked(tx_findUnique(txA)).mockResolvedValue(pieceRateAssignment({ id: "assignment-a" }) as never);
    vi.mocked(QcInspectionRepository.sumAcceptedByJobOrderIdInTx).mockResolvedValueOnce(380);
    vi.mocked(PieceRateEarningRepository.sumPriorPayable).mockResolvedValueOnce(0);

    await generateEarningForJobOrderProgress(txA as never, { companyId: "co-1", jobOrderId: "jo-a", jobOrderAssignmentId: "assignment-a" });
    expect(PieceRateEarningRepository.createInTx).toHaveBeenNthCalledWith(
      1,
      txA,
      expect.objectContaining({ jobOrderId: "jo-a", payableQuantity: 380, amount: 950 })
    );

    // Re-running against the SAME JobOrder with no new QC activity must be a
    // pure no-op — the exact "no duplicate payment" guarantee.
    vi.mocked(QcInspectionRepository.sumAcceptedByJobOrderIdInTx).mockResolvedValueOnce(380);
    vi.mocked(PieceRateEarningRepository.sumPriorPayable).mockResolvedValueOnce(380);
    const noop = await generateEarningForJobOrderProgress(txA as never, { companyId: "co-1", jobOrderId: "jo-a", jobOrderAssignmentId: "assignment-a" });
    expect(noop).toBeNull();
    expect(PieceRateEarningRepository.createInTx).toHaveBeenCalledTimes(1);

    // JO-B: the SEPARATE rework-destination JobOrder (a brand-new JobOrder
    // row, per postStageTransactionInTx) — its own 15 pcs get QC'd, 12 pass.
    const txB = makeTx();
    vi.mocked(tx_findUnique(txB)).mockResolvedValue(pieceRateAssignment({ id: "assignment-b" }) as never);
    vi.mocked(QcInspectionRepository.sumAcceptedByJobOrderIdInTx).mockResolvedValueOnce(12);
    vi.mocked(PieceRateEarningRepository.sumPriorPayable).mockResolvedValueOnce(0); // independent key — JO-A's own 380 never counted here

    await generateEarningForJobOrderProgress(txB as never, { companyId: "co-1", jobOrderId: "jo-b", jobOrderAssignmentId: "assignment-b" });
    expect(PieceRateEarningRepository.createInTx).toHaveBeenNthCalledWith(
      2,
      txB,
      expect.objectContaining({ jobOrderId: "jo-b", payableQuantity: 12, amount: 30 })
    );

    // Total lifetime earnings: 950 + 30 = 980, exactly matching the spec's
    // own worked example — but achieved via two independent, isolated rows,
    // never a single re-summed 980.
    expect(PieceRateEarningRepository.createInTx).toHaveBeenCalledTimes(2);
  });
});

function tx_findUnique(tx: ReturnType<typeof makeTx>) {
  return (tx as unknown as { jobOrderAssignment: { findUnique: ReturnType<typeof vi.fn> } }).jobOrderAssignment.findUnique;
}

describe("generateEarningsForQcAcceptance — multi-worker attribution", () => {
  it("degenerates to the simple case with exactly one active assignment", async () => {
    const tx = makeTx();
    vi.mocked(tx.jobOrderAssignment.findMany).mockResolvedValue([{ id: "assignment-1" }] as never);
    vi.mocked(tx.jobOrderAssignment.findUnique).mockResolvedValue(pieceRateAssignment() as never);
    vi.mocked(QcInspectionRepository.sumAcceptedByJobOrderIdInTx).mockResolvedValue(380);
    vi.mocked(PieceRateEarningRepository.sumPriorPayable).mockResolvedValue(0);

    await generateEarningsForQcAcceptance(tx as never, { companyId: "co-1", jobOrderId: "jo-a", generatedFromQcInspectionId: "qc-1" });

    expect(PieceRateEarningRepository.createInTx).toHaveBeenCalledTimes(1);
    expect(PieceRateEarningRepository.createInTx).toHaveBeenCalledWith(tx, expect.objectContaining({ payableQuantity: 380 }));
  });

  // Regression (2026-09-18): the exact real-world failure — a QC accept that just inserted its own
  // QcInspection row, in the same transaction, produced zero earnings because the total-accepted sum was
  // read via a separate, non-transactional connection that couldn't see that uncommitted insert yet.
  it("reads the total-accepted quantity through the open transaction's own tx, not a separate connection", async () => {
    const tx = makeTx();
    vi.mocked(tx.jobOrderAssignment.findMany).mockResolvedValue([{ id: "assignment-1" }] as never);
    vi.mocked(tx.jobOrderAssignment.findUnique).mockResolvedValue(pieceRateAssignment() as never);
    vi.mocked(QcInspectionRepository.sumAcceptedByJobOrderIdInTx).mockResolvedValue(5);
    vi.mocked(PieceRateEarningRepository.sumPriorPayable).mockResolvedValue(0);

    await generateEarningsForQcAcceptance(tx as never, { companyId: "co-1", jobOrderId: "jo-a", generatedFromQcInspectionId: "qc-1" });

    expect(QcInspectionRepository.sumAcceptedByJobOrderIdInTx).toHaveBeenCalledWith(tx, "jo-a");
  });

  it("splits pro-rata by logged completed-quantity share across two assignments, with the last absorbing rounding", async () => {
    const tx = makeTx();
    vi.mocked(tx.jobOrderAssignment.findMany).mockResolvedValue([{ id: "assignment-1" }, { id: "assignment-2" }] as never);
    vi.mocked(tx.jobOrderProgressEntry.groupBy).mockResolvedValue([
      { jobOrderAssignmentId: "assignment-1", _sum: { completedQuantity: "250" } },
      { jobOrderAssignmentId: "assignment-2", _sum: { completedQuantity: "150" } },
    ] as never);
    vi.mocked(tx.jobOrderAssignment.findUnique)
      .mockResolvedValueOnce(pieceRateAssignment({ id: "assignment-1" }) as never)
      .mockResolvedValueOnce(pieceRateAssignment({ id: "assignment-2" }) as never);
    vi.mocked(QcInspectionRepository.sumAcceptedByJobOrderIdInTx).mockResolvedValue(380);
    vi.mocked(PieceRateEarningRepository.sumPriorPayable).mockResolvedValue(0);

    await generateEarningsForQcAcceptance(tx as never, { companyId: "co-1", jobOrderId: "jo-a", generatedFromQcInspectionId: "qc-1" });

    expect(PieceRateEarningRepository.createInTx).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(PieceRateEarningRepository.createInTx).mock.calls;
    const qty1 = (calls[0][1] as { payableQuantity: number }).payableQuantity;
    const qty2 = (calls[1][1] as { payableQuantity: number }).payableQuantity;
    // 250/400 * 380 = 237.5 for the first; the second absorbs the remainder
    // so the two always sum EXACTLY to the real total (no rounding drift).
    expect(qty1).toBeCloseTo(237.5, 4);
    expect(qty1 + qty2).toBe(380);
  });

  it("generates nothing when the JobOrder has zero active assignments", async () => {
    const tx = makeTx();
    vi.mocked(tx.jobOrderAssignment.findMany).mockResolvedValue([] as never);

    await generateEarningsForQcAcceptance(tx as never, { companyId: "co-1", jobOrderId: "jo-a", generatedFromQcInspectionId: "qc-1" });

    expect(PieceRateEarningRepository.createInTx).not.toHaveBeenCalled();
  });

  it("is a no-op when the company's payment quantity rule is GOOD_COMPLETED_QTY, not QC_ACCEPTED_QTY", async () => {
    vi.mocked(getProductionSettings).mockResolvedValue({ ...QC_ACCEPTED_SETTINGS, pieceRatePaymentQuantityRule: "GOOD_COMPLETED_QTY" } as never);
    const tx = makeTx();

    await generateEarningsForQcAcceptance(tx as never, { companyId: "co-1", jobOrderId: "jo-a", generatedFromQcInspectionId: "qc-1" });

    expect(tx.jobOrderAssignment.findMany).not.toHaveBeenCalled();
    expect(PieceRateEarningRepository.createInTx).not.toHaveBeenCalled();
  });
});

describe("generateEarningForJobWorkReceipt — external Supplier earner", () => {
  it("pays only the genuinely received quantity, never rejected/damaged", async () => {
    const tx = makeTx();
    await generateEarningForJobWorkReceipt(tx as never, {
      companyId: "co-1",
      jobOrderId: "jo-1",
      jobWorkOrderId: "jwo-1",
      jobWorkReceiptId: "receipt-1",
      supplierId: "sup-1",
      productionOperationId: "op-1",
      resolvedRate: 6,
      receivedQuantityDelta: 580,
    });

    expect(PieceRateEarningRepository.createInTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ earnerType: "SUPPLIER", supplierId: "sup-1", payableQuantity: 580, rateApplied: 6, amount: 3480 })
    );
  });

  it("is a no-op when the JobWorkOrder has no resolved rate", async () => {
    const tx = makeTx();
    const result = await generateEarningForJobWorkReceipt(tx as never, {
      companyId: "co-1",
      jobOrderId: "jo-1",
      jobWorkOrderId: "jwo-1",
      jobWorkReceiptId: "receipt-1",
      supplierId: "sup-1",
      productionOperationId: "op-1",
      resolvedRate: null,
      receivedQuantityDelta: 580,
    });

    expect(result).toBeNull();
    expect(PieceRateEarningRepository.createInTx).not.toHaveBeenCalled();
  });
});

describe("earning status transitions — RBAC gating", () => {
  it("asserts piece_rate.approve before approving an earning", async () => {
    vi.mocked(PieceRateEarningRepository.findAnyById).mockResolvedValue({ id: "earning-1", status: "PENDING" } as never);
    vi.mocked(PieceRateEarningRepository.update).mockResolvedValue({ id: "earning-1", status: "APPROVED" } as never);

    await approvePieceRateEarning({ companyId: "co-1", userId: "user-1" }, "earning-1");

    expect(PermissionService.assert).toHaveBeenCalledWith("user-1", "piece_rate", "approve");
  });

  it("rejects a caller without piece_rate.approve", async () => {
    vi.mocked(PermissionService.assert).mockRejectedValue(new Error("denied"));
    await expect(cancelPieceRateEarning({ companyId: "co-1", userId: "user-1" }, "earning-1")).rejects.toThrow();
    expect(PieceRateEarningRepository.findAnyById).not.toHaveBeenCalled();
  });

  it("rejects cancelling an earning that is already PAID", async () => {
    vi.mocked(PieceRateEarningRepository.findAnyById).mockResolvedValue({ id: "earning-1", status: "PAID" } as never);
    await expect(cancelPieceRateEarning({ companyId: "co-1", userId: "user-1" }, "earning-1")).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
    });
  });
});
