import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/bom-mrp/bom.repository", () => ({
  BomRepository: { findApprovedVersionIdByProductId: vi.fn() },
}));
vi.mock("@/modules/sampling/sample.repository", () => ({
  SampleVersionRepository: { findLatest: vi.fn() },
}));
vi.mock("./sales-order-bom.repository", () => ({
  SalesOrderLineRepository: { findExistingForOrder: vi.fn() },
}));

const { BomRepository } = await import("@/modules/bom-mrp/bom.repository");
const { SampleVersionRepository } = await import("@/modules/sampling/sample.repository");
const { SalesOrderLineRepository } = await import("./sales-order-bom.repository");
const { resolveSnapshotSource, buildReconciledItemPlan, snapshotUnsnapshottedLinesInTx } = await import("./sales-order-bom.service");

const actor = { companyId: "co-1", userId: "user-1" };

beforeEach(() => {
  vi.mocked(BomRepository.findApprovedVersionIdByProductId).mockReset();
  vi.mocked(SampleVersionRepository.findLatest).mockReset();
  vi.mocked(SalesOrderLineRepository.findExistingForOrder).mockReset().mockResolvedValue([]);
});

describe("resolveSnapshotSource", () => {
  it("resolves STYLE_BOM from the style's currently approved BomVersion when no sample is linked", async () => {
    vi.mocked(BomRepository.findApprovedVersionIdByProductId).mockResolvedValue({ id: "bom-1", approvedVersionId: "bv-3" } as never);

    const result = await resolveSnapshotSource("co-1", { productId: "style-1", sampleRequestId: null });

    expect(result).toEqual({ sourceType: "STYLE_BOM", bomVersionId: "bv-3", sampleVersionId: null });
  });

  it("resolves NONE when the style has a Bom row but no approved version yet", async () => {
    vi.mocked(BomRepository.findApprovedVersionIdByProductId).mockResolvedValue({ id: "bom-1", approvedVersionId: null } as never);
    const result = await resolveSnapshotSource("co-1", { productId: "style-1", sampleRequestId: null });
    expect(result).toEqual({ sourceType: "NONE", bomVersionId: null, sampleVersionId: null });
  });

  it("resolves NONE when the style has no Bom row at all", async () => {
    vi.mocked(BomRepository.findApprovedVersionIdByProductId).mockResolvedValue(null);
    const result = await resolveSnapshotSource("co-1", { productId: "style-1", sampleRequestId: null });
    expect(result).toEqual({ sourceType: "NONE", bomVersionId: null, sampleVersionId: null });
  });

  it("resolves SAMPLE_MATERIALS from the linked sample's own currently-latest SampleVersion, never touching Bom at all", async () => {
    vi.mocked(SampleVersionRepository.findLatest).mockResolvedValue({ id: "sv-2", versionNumber: 2 } as never);

    const result = await resolveSnapshotSource("co-1", { productId: "style-1", sampleRequestId: "sam-1" });

    expect(result).toEqual({ sourceType: "SAMPLE_MATERIALS", bomVersionId: null, sampleVersionId: "sv-2" });
    expect(BomRepository.findApprovedVersionIdByProductId).not.toHaveBeenCalled();
  });

  it("resolves NONE when a sample is linked but has zero versions recorded", async () => {
    vi.mocked(SampleVersionRepository.findLatest).mockResolvedValue(null);
    const result = await resolveSnapshotSource("co-1", { productId: "style-1", sampleRequestId: "sam-1" });
    expect(result).toEqual({ sourceType: "NONE", bomVersionId: null, sampleVersionId: null });
  });
});

describe("buildReconciledItemPlan — line reuse decisions", () => {
  const baseItem = { productId: "style-1", sampleRequestId: null, unitPrice: 100, notes: null, breakdown: [] };

  it("reuses an existing line when the submitted salesOrderLineId matches and productId/sampleRequestId are unchanged — an ordinary quantity/price-only edit", async () => {
    vi.mocked(SalesOrderLineRepository.findExistingForOrder).mockResolvedValue([
      { id: "line-1", lineNumber: 1, sourceType: "STYLE_BOM", bomVersionId: "bv-3", sampleVersionId: null, items: [{ productId: "style-1", sampleRequestId: null }] },
    ] as never);

    const plan = await buildReconciledItemPlan(actor, "so-1", true, [{ ...baseItem, salesOrderLineId: "line-1", unitPrice: 250 }]);

    expect(plan[0].lineLink).toEqual({ kind: "reuse", salesOrderLineId: "line-1" });
    // Reuse never re-resolves a snapshot, even though the order is CONFIRMED —
    // this is the "never silently move to a newer BOM version on an
    // ordinary edit" guarantee.
    expect(BomRepository.findApprovedVersionIdByProductId).not.toHaveBeenCalled();
  });

  it("treats a submitted item with no salesOrderLineId as a genuinely new line", async () => {
    vi.mocked(SalesOrderLineRepository.findExistingForOrder).mockResolvedValue([]);
    vi.mocked(BomRepository.findApprovedVersionIdByProductId).mockResolvedValue({ id: "bom-1", approvedVersionId: "bv-1" } as never);

    const plan = await buildReconciledItemPlan(actor, "so-1", true, [baseItem]);

    expect(plan[0].lineLink.kind).toBe("new");
  });

  it("re-evaluates as a new line when the submitted productId differs from the line's current one — never carries an override onto a line that now points at a different style", async () => {
    vi.mocked(SalesOrderLineRepository.findExistingForOrder).mockResolvedValue([
      { id: "line-1", lineNumber: 1, sourceType: "STYLE_BOM", bomVersionId: "bv-old", sampleVersionId: null, items: [{ productId: "style-OLD", sampleRequestId: null }] },
    ] as never);
    vi.mocked(BomRepository.findApprovedVersionIdByProductId).mockResolvedValue({ id: "bom-new", approvedVersionId: "bv-new" } as never);

    const plan = await buildReconciledItemPlan(actor, "so-1", true, [{ ...baseItem, productId: "style-NEW", salesOrderLineId: "line-1" }]);

    expect(plan[0].lineLink.kind).toBe("new");
    if (plan[0].lineLink.kind === "new") {
      expect(plan[0].lineLink.bomVersionId).toBe("bv-new");
    }
  });

  it("re-evaluates as a new line when the submitted sampleRequestId differs from the line's current one", async () => {
    vi.mocked(SalesOrderLineRepository.findExistingForOrder).mockResolvedValue([
      { id: "line-1", lineNumber: 1, sourceType: "NONE", bomVersionId: null, sampleVersionId: null, items: [{ productId: "style-1", sampleRequestId: null }] },
    ] as never);
    vi.mocked(SampleVersionRepository.findLatest).mockResolvedValue({ id: "sv-1" } as never);

    const plan = await buildReconciledItemPlan(actor, "so-1", true, [{ ...baseItem, sampleRequestId: "sam-1", salesOrderLineId: "line-1" }]);

    expect(plan[0].lineLink.kind).toBe("new");
  });

  it("re-evaluates as a new line when the submitted salesOrderLineId doesn't match any existing line", async () => {
    vi.mocked(SalesOrderLineRepository.findExistingForOrder).mockResolvedValue([]);
    vi.mocked(BomRepository.findApprovedVersionIdByProductId).mockResolvedValue(null);

    const plan = await buildReconciledItemPlan(actor, "so-1", true, [{ ...baseItem, salesOrderLineId: "line-does-not-exist" }]);

    expect(plan[0].lineLink.kind).toBe("new");
  });
});

describe("buildReconciledItemPlan — snapshot timing", () => {
  const baseItem = { productId: "style-1", sampleRequestId: null, unitPrice: 100, notes: null, breakdown: [] };

  it("never resolves a snapshot for a new line when the order is still DRAFT (isConfirmed: false) — snapshotting happens once, at confirm time", async () => {
    vi.mocked(SalesOrderLineRepository.findExistingForOrder).mockResolvedValue([]);

    const plan = await buildReconciledItemPlan(actor, "so-1", false, [baseItem]);

    expect(BomRepository.findApprovedVersionIdByProductId).not.toHaveBeenCalled();
    expect(plan[0].lineLink).toMatchObject({ kind: "new", sourceType: "NONE", bomVersionId: null, sampleVersionId: null, snapshotTakenAt: null });
  });

  it("resolves and stamps a real snapshot for a new line on an already-CONFIRMED order", async () => {
    vi.mocked(SalesOrderLineRepository.findExistingForOrder).mockResolvedValue([]);
    vi.mocked(BomRepository.findApprovedVersionIdByProductId).mockResolvedValue({ id: "bom-1", approvedVersionId: "bv-5" } as never);

    const plan = await buildReconciledItemPlan(actor, "so-1", true, [baseItem]);

    expect(plan[0].lineLink).toMatchObject({ kind: "new", sourceType: "STYLE_BOM", bomVersionId: "bv-5" });
    if (plan[0].lineLink.kind === "new") {
      expect(plan[0].lineLink.snapshotTakenAt).toBeInstanceOf(Date);
      expect(plan[0].lineLink.snapshotTakenByUserId).toBe("user-1");
    }
  });

  it("assigns sequential lineNumbers continuing from the existing max, not restarting at 1", async () => {
    vi.mocked(SalesOrderLineRepository.findExistingForOrder).mockResolvedValue([
      { id: "line-1", lineNumber: 1, sourceType: "NONE", bomVersionId: null, sampleVersionId: null, items: [{ productId: "style-X", sampleRequestId: null }] },
      { id: "line-2", lineNumber: 2, sourceType: "NONE", bomVersionId: null, sampleVersionId: null, items: [] }, // dormant — no live item
    ] as never);
    vi.mocked(BomRepository.findApprovedVersionIdByProductId).mockResolvedValue(null);

    const plan = await buildReconciledItemPlan(actor, "so-1", false, [baseItem, { ...baseItem, productId: "style-2" }]);

    expect(plan[0].lineLink).toMatchObject({ kind: "new", lineNumber: 3 });
    expect(plan[1].lineLink).toMatchObject({ kind: "new", lineNumber: 4 });
  });
});

describe("snapshotUnsnapshottedLinesInTx", () => {
  function makeTx(lines: unknown[]) {
    const update = vi.fn();
    const findMany = vi.fn().mockResolvedValue(lines);
    const tx = { salesOrderLine: { findMany, update } };
    return { tx, update, findMany };
  }

  it("skips a dormant line with no live item", async () => {
    const { tx, update } = makeTx([{ id: "line-1", items: [] }]);
    await snapshotUnsnapshottedLinesInTx(tx as never, actor, "so-1");
    expect(update).not.toHaveBeenCalled();
  });

  it("leaves a line honestly at NONE when there's still nothing to snapshot (no approved BOM, no sample versions)", async () => {
    vi.mocked(BomRepository.findApprovedVersionIdByProductId).mockResolvedValue(null);
    const { tx, update } = makeTx([{ id: "line-1", items: [{ productId: "style-1", sampleRequestId: null }] }]);

    await snapshotUnsnapshottedLinesInTx(tx as never, actor, "so-1");

    expect(update).not.toHaveBeenCalled();
  });

  it("backfills a real snapshot for a line that has something to capture", async () => {
    vi.mocked(BomRepository.findApprovedVersionIdByProductId).mockResolvedValue({ id: "bom-1", approvedVersionId: "bv-7" } as never);
    const { tx, update } = makeTx([{ id: "line-1", items: [{ productId: "style-1", sampleRequestId: null }] }]);

    await snapshotUnsnapshottedLinesInTx(tx as never, actor, "so-1");

    expect(update).toHaveBeenCalledWith({
      where: { id: "line-1" },
      data: expect.objectContaining({ sourceType: "STYLE_BOM", bomVersionId: "bv-7", snapshotTakenByUserId: "user-1" }),
    });
  });

  it("only queries lines with sourceType NONE — an already-snapshotted line is never touched by this backfill", async () => {
    const { tx, findMany } = makeTx([]);
    await snapshotUnsnapshottedLinesInTx(tx as never, actor, "so-1");
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { salesOrderId: "so-1", sourceType: "NONE" } }));
  });
});
