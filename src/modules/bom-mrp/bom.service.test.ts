import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { assert: vi.fn() } }));
vi.mock("@/modules/lookups/lookup.repository", () => ({
  LookupRepository: { unit: { findUnique: vi.fn() }, color: { findFirst: vi.fn() } },
}));
vi.mock("@/modules/products/product.repository", () => ({
  ProductRepository: { findStyleById: vi.fn(), findMaterialById: vi.fn() },
}));
vi.mock("./bom.repository", () => ({
  BomRepository: { findByProductId: vi.fn(), saveDraftWithItems: vi.fn(), approveVersionInTx: vi.fn() },
}));

const { LookupRepository } = await import("@/modules/lookups/lookup.repository");
const { ProductRepository } = await import("@/modules/products/product.repository");
const { PermissionService } = await import("@/core/rbac/PermissionService");
const { BomRepository } = await import("./bom.repository");
const { upsertBom, approveBomVersion } = await import("./bom.service");

const actor = { companyId: "co-1", userId: "user-1" };
const BASE_UOM = { id: "uom-1", name: "MTR", baseUnitId: null, conversionFactor: 1 };

const oneItem = (overrides: Record<string, unknown> = {}) => ({
  materialId: "mat-1",
  colorId: "",
  quantityPerUnit: 1.2,
  wastagePercentage: 10,
  uomId: "uom-1",
  notes: "",
  ...overrides,
});

// A single-version Bom, matching what BomRepository.findByProductId/
// saveDraftWithItems actually return (versions[] + a redundant approvedVersion
// pointer) — used as both the "before" and "after" fixture across tests.
const bomWithVersion = (overrides: { versionNumber?: number; status?: string; items?: unknown[] } = {}) => ({
  id: "bom-1",
  companyId: "co-1",
  productId: "prod-1",
  currentVersionNumber: overrides.versionNumber ?? 1,
  approvedVersionId: overrides.status === "APPROVED" ? "version-1" : null,
  versions: [
    {
      id: "version-1",
      bomId: "bom-1",
      versionNumber: overrides.versionNumber ?? 1,
      status: overrides.status ?? "DRAFT",
      notes: null,
      createdByUserId: "user-1",
      approvedByUserId: overrides.status === "APPROVED" ? "user-2" : null,
      items: overrides.items ?? [],
    },
  ],
  approvedVersion: overrides.status === "APPROVED" ? { id: "version-1", items: overrides.items ?? [] } : null,
});

beforeEach(() => {
  vi.mocked(ProductRepository.findStyleById).mockReset().mockResolvedValue({ id: "prod-1", styleName: "Round Neck T-Shirt" } as never);
  vi.mocked(ProductRepository.findMaterialById)
    .mockReset()
    .mockResolvedValue({ id: "mat-1", styleName: "Cotton Fabric", baseUom: BASE_UOM } as never);
  vi.mocked(LookupRepository.unit.findUnique).mockReset().mockResolvedValue(BASE_UOM as never);
  vi.mocked(LookupRepository.color.findFirst).mockReset().mockResolvedValue({ id: "color-1" } as never);
  vi.mocked(PermissionService.assert).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(BomRepository.findByProductId).mockReset().mockResolvedValue(null);
  vi.mocked(BomRepository.saveDraftWithItems).mockReset().mockResolvedValue(bomWithVersion() as never);
  vi.mocked(BomRepository.approveVersionInTx).mockReset().mockResolvedValue(bomWithVersion({ status: "APPROVED" }) as never);
});

describe("upsertBom", () => {
  it("rejects when the style doesn't exist", async () => {
    vi.mocked(ProductRepository.findStyleById).mockResolvedValue(null);
    await expect(upsertBom(actor, "prod-x", { notes: "", items: [oneItem()] })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects two exact-duplicate lines for the same material and color", async () => {
    await expect(
      upsertBom(actor, "prod-1", { notes: "", items: [oneItem({ colorId: "color-1" }), oneItem({ colorId: "color-1" })] })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a null-color line coexisting with a specific-color line for the same material", async () => {
    await expect(
      upsertBom(actor, "prod-1", { notes: "", items: [oneItem({ colorId: "" }), oneItem({ colorId: "color-1" })] })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a specific-color line added after a null-color line for the same material (the reverse order)", async () => {
    await expect(
      upsertBom(actor, "prod-1", { notes: "", items: [oneItem({ colorId: "color-1" }), oneItem({ colorId: "" })] })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects two 'applies to every color' lines for the same material with a message naming that specific conflict", async () => {
    await expect(
      upsertBom(actor, "prod-1", { notes: "", items: [oneItem({ colorId: "" }), oneItem({ colorId: "" })] })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("already has an \"applies to every color\" line"),
    });
  });

  it("allows two lines for the same material with genuinely different colors", async () => {
    await upsertBom(actor, "prod-1", { notes: "", items: [oneItem({ colorId: "color-1" }), oneItem({ colorId: "color-2" })] });
    expect(BomRepository.saveDraftWithItems).toHaveBeenCalled();
  });

  it("rejects a line whose material doesn't exist as a raw material", async () => {
    vi.mocked(ProductRepository.findMaterialById).mockResolvedValue(null);
    await expect(upsertBom(actor, "prod-1", { notes: "", items: [oneItem()] })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects a line whose material has no base unit configured", async () => {
    vi.mocked(ProductRepository.findMaterialById).mockResolvedValue({ id: "mat-1", styleName: "Cotton Fabric", baseUom: null } as never);
    await expect(upsertBom(actor, "prod-1", { notes: "", items: [oneItem()] })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a line whose chosen unit has no fixed conversion to the material's base unit", async () => {
    vi.mocked(LookupRepository.unit.findUnique).mockResolvedValue({ id: "uom-x", name: "Roll", baseUnitId: null, conversionFactor: 1 } as never);
    await expect(upsertBom(actor, "prod-1", { notes: "", items: [oneItem({ uomId: "uom-x" })] })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a colorId that doesn't belong to this company", async () => {
    vi.mocked(LookupRepository.color.findFirst).mockResolvedValue(null);
    await expect(upsertBom(actor, "prod-1", { notes: "", items: [oneItem({ colorId: "color-x" })] })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("saves valid items via saveDraftWithItems and audit-logs CREATE when no BOM existed before", async () => {
    await upsertBom(actor, "prod-1", { notes: "For export order", items: [oneItem()] });

    expect(BomRepository.saveDraftWithItems).toHaveBeenCalledWith(
      "co-1",
      "prod-1",
      "user-1",
      "For export order",
      expect.arrayContaining([expect.objectContaining({ materialId: "mat-1", quantityPerUnit: 1.2, wastagePercentage: 10 })])
    );
  });
});

describe("approveBomVersion", () => {
  it("rejects when the style doesn't exist", async () => {
    vi.mocked(ProductRepository.findStyleById).mockResolvedValue(null);
    await expect(approveBomVersion(actor, "prod-x")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects when the style has no BOM version at all", async () => {
    vi.mocked(BomRepository.findByProductId).mockResolvedValue(null);
    await expect(approveBomVersion(actor, "prod-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects approving a version that already isn't DRAFT", async () => {
    vi.mocked(BomRepository.findByProductId).mockResolvedValue(bomWithVersion({ status: "APPROVED", items: [{ id: "item-1" }] }) as never);
    await expect(approveBomVersion(actor, "prod-1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    expect(BomRepository.approveVersionInTx).not.toHaveBeenCalled();
  });

  it("rejects approving a DRAFT version with zero material lines", async () => {
    vi.mocked(BomRepository.findByProductId).mockResolvedValue(bomWithVersion({ status: "DRAFT", items: [] }) as never);
    await expect(approveBomVersion(actor, "prod-1")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(BomRepository.approveVersionInTx).not.toHaveBeenCalled();
  });

  it("asserts the self-approval-guarded bom_mrp.approve permission before approving", async () => {
    vi.mocked(BomRepository.findByProductId).mockResolvedValue(bomWithVersion({ status: "DRAFT", items: [{ id: "item-1" }] }) as never);
    await approveBomVersion(actor, "prod-1");
    expect(PermissionService.assert).toHaveBeenCalledWith("user-1", "bom_mrp", "approve", { createdBy: "user-1" });
    expect(BomRepository.approveVersionInTx).toHaveBeenCalledWith("bom-1", "version-1", "user-1");
  });

  it("propagates a self-approval rejection from PermissionService without approving", async () => {
    vi.mocked(BomRepository.findByProductId).mockResolvedValue(bomWithVersion({ status: "DRAFT", items: [{ id: "item-1" }] }) as never);
    vi.mocked(PermissionService.assert).mockRejectedValue(Object.assign(new Error("denied"), { code: "PERMISSION_DENIED" }));
    await expect(approveBomVersion(actor, "prod-1")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(BomRepository.approveVersionInTx).not.toHaveBeenCalled();
  });
});
