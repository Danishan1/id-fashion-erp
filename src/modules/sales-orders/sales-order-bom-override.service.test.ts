import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { assert: vi.fn() } }));
vi.mock("@/modules/products/product.repository", () => ({ ProductRepository: { findMaterialById: vi.fn() } }));
vi.mock("./sales-order-bom.repository", () => ({
  SalesOrderBomOverrideRepository: { findManyForLine: vi.fn(), findById: vi.fn(), create: vi.fn(), deactivate: vi.fn() },
  SalesOrderLineRepository: { findByIdWithOrder: vi.fn(), updateSnapshot: vi.fn() },
}));
vi.mock("./sales-order-bom.service", () => ({ resolveSnapshotSource: vi.fn() }));

const { writeAuditLog } = await import("@/core/audit/AuditLogger");
const { ProductRepository } = await import("@/modules/products/product.repository");
const { SalesOrderBomOverrideRepository, SalesOrderLineRepository } = await import("./sales-order-bom.repository");
const { resolveSnapshotSource } = await import("./sales-order-bom.service");
const {
  listSalesOrderLineOverrides,
  proposeSalesOrderBomOverride,
  deactivateSalesOrderBomOverride,
  refreshSalesOrderLineBomSnapshot,
} = await import("./sales-order-bom-override.service");

const actor = { companyId: "co-1", userId: "user-1" };

const openLine = { id: "line-1", sourceType: "STYLE_BOM", bomVersionId: "bv-1", sampleVersionId: null, salesOrder: { status: "CONFIRMED" }, items: [{ id: "item-1", productId: "style-1", sampleRequestId: null }] };

beforeEach(() => {
  vi.mocked(writeAuditLog).mockReset();
  vi.mocked(ProductRepository.findMaterialById).mockReset().mockResolvedValue({ id: "mat-1" } as never);
  vi.mocked(SalesOrderLineRepository.findByIdWithOrder).mockReset().mockResolvedValue(openLine as never);
  vi.mocked(SalesOrderLineRepository.updateSnapshot).mockReset();
  vi.mocked(SalesOrderBomOverrideRepository.findManyForLine).mockReset().mockResolvedValue([]);
  vi.mocked(SalesOrderBomOverrideRepository.findById).mockReset();
  vi.mocked(SalesOrderBomOverrideRepository.create).mockReset().mockResolvedValue({ id: "ovr-1" } as never);
  vi.mocked(SalesOrderBomOverrideRepository.deactivate).mockReset();
  vi.mocked(resolveSnapshotSource).mockReset();
});

const validAddInput = {
  originalMaterialId: null,
  effectiveMaterialId: "mat-new",
  effectiveQuantityPerUnit: 1.5,
  wastagePercentage: 5,
  colorId: null,
  uomId: "uom-1",
  reason: "CUSTOMER_REQUIREMENT" as const,
  remarks: "Buyer asked for this trim instead",
};

describe("proposeSalesOrderBomOverride", () => {
  it("creates the override and writes an audit log entry", async () => {
    const result = await proposeSalesOrderBomOverride(actor, "line-1", validAddInput);

    expect(SalesOrderBomOverrideRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ salesOrderLineId: "line-1", effectiveMaterialId: "mat-new", changedByUserId: "user-1" })
    );
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ tableName: "sales_order_bom_overrides", action: "CREATE" }));
    expect(result).toEqual({ id: "ovr-1" });
  });

  it("rejects a cancelled order's line", async () => {
    vi.mocked(SalesOrderLineRepository.findByIdWithOrder).mockResolvedValue({ ...openLine, salesOrder: { status: "CANCELLED" } } as never);
    await expect(proposeSalesOrderBomOverride(actor, "line-1", validAddInput)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(SalesOrderBomOverrideRepository.create).not.toHaveBeenCalled();
  });

  it("rejects when the line doesn't exist for this company", async () => {
    vi.mocked(SalesOrderLineRepository.findByIdWithOrder).mockResolvedValue(null);
    await expect(proposeSalesOrderBomOverride(actor, "line-missing", validAddInput)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects when the target original material doesn't resolve for this company", async () => {
    vi.mocked(ProductRepository.findMaterialById).mockResolvedValue(null);
    await expect(
      proposeSalesOrderBomOverride(actor, "line-1", { ...validAddInput, originalMaterialId: "mat-old", effectiveMaterialId: null })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(SalesOrderBomOverrideRepository.create).not.toHaveBeenCalled();
  });
});

describe("deactivateSalesOrderBomOverride", () => {
  it("deactivates an active override and audit-logs it", async () => {
    vi.mocked(SalesOrderBomOverrideRepository.findById).mockResolvedValue({ id: "ovr-1", salesOrderLineId: "line-1", isActive: true } as never);
    vi.mocked(SalesOrderBomOverrideRepository.deactivate).mockResolvedValue({ id: "ovr-1", isActive: false } as never);

    const result = await deactivateSalesOrderBomOverride(actor, "ovr-1");

    expect(SalesOrderBomOverrideRepository.deactivate).toHaveBeenCalledWith("ovr-1", "user-1");
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "UPDATE" }));
    expect(result).toEqual({ id: "ovr-1", isActive: false });
  });

  it("rejects deactivating an already-deactivated override — never a silent no-op", async () => {
    vi.mocked(SalesOrderBomOverrideRepository.findById).mockResolvedValue({ id: "ovr-1", salesOrderLineId: "line-1", isActive: false } as never);
    await expect(deactivateSalesOrderBomOverride(actor, "ovr-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(SalesOrderBomOverrideRepository.deactivate).not.toHaveBeenCalled();
  });

  it("rejects when the override doesn't exist for this company", async () => {
    vi.mocked(SalesOrderBomOverrideRepository.findById).mockResolvedValue(null);
    await expect(deactivateSalesOrderBomOverride(actor, "ovr-missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("refreshSalesOrderLineBomSnapshot", () => {
  it("re-resolves the snapshot source and overwrites the line's snapshot pointer, stamping who/when", async () => {
    vi.mocked(resolveSnapshotSource).mockResolvedValue({ sourceType: "STYLE_BOM", bomVersionId: "bv-9", sampleVersionId: null });
    vi.mocked(SalesOrderLineRepository.updateSnapshot).mockResolvedValue({ id: "line-1", bomVersionId: "bv-9" } as never);

    const result = await refreshSalesOrderLineBomSnapshot(actor, "line-1");

    expect(resolveSnapshotSource).toHaveBeenCalledWith("co-1", { productId: "style-1", sampleRequestId: null });
    expect(SalesOrderLineRepository.updateSnapshot).toHaveBeenCalledWith(
      "line-1",
      expect.objectContaining({ sourceType: "STYLE_BOM", bomVersionId: "bv-9", snapshotTakenByUserId: "user-1" })
    );
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ tableName: "sales_order_lines", action: "UPDATE" }));
    expect(result).toEqual({ id: "line-1", bomVersionId: "bv-9" });
  });

  it("rejects refreshing a dormant line with no live item", async () => {
    vi.mocked(SalesOrderLineRepository.findByIdWithOrder).mockResolvedValue({ ...openLine, items: [] } as never);
    await expect(refreshSalesOrderLineBomSnapshot(actor, "line-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(resolveSnapshotSource).not.toHaveBeenCalled();
  });
});

describe("listSalesOrderLineOverrides", () => {
  it("returns every override for the line, active and deactivated alike", async () => {
    vi.mocked(SalesOrderBomOverrideRepository.findManyForLine).mockResolvedValue([{ id: "ovr-1", isActive: false }] as never);
    const result = await listSalesOrderLineOverrides(actor, "line-1");
    expect(result).toEqual([{ id: "ovr-1", isActive: false }]);
  });
});
